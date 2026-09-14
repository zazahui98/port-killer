//! Linux 平台实现。
//!
//! 全部通过 `/proc` 文件系统完成，不调用 `ss` / `lsof` / `netstat`：
//!   1. `/proc/net/{tcp,tcp6,udp,udp6}` 给出「本地端口 → socket inode」
//!   2. `/proc/<pid>/fd/*` 的符号链接给出「socket inode → PID」
//!
//! 这样做没有子进程开销，也不存在解析本地化输出的问题。
//! 读取其它用户的 `/proc/<pid>/fd` 需要 root —— 拿不到就跳过，
//! 普通用户依然能查到自己启动的开发服务（主要场景）。
//!
//! 行解析与地址还原在 `platform::proc_net`（不带平台门控，测试在任何平台都跑）。
//!
//! 注意 inode 是 Linux 独有的中间概念，**刻意不放进共享的 `RawSocket`** ——
//! 它只在本模块内部用来把 socket 归属到进程，之后再产出中立的记录。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use super::aggregate::{self, RawSocket};
use super::proc_net::{self, NetRow};
use super::state;
use super::ProcessProvider;
use crate::error::{PortError, PortResult};
use crate::process::PortProcess;

pub struct LinuxProcessProvider;

impl LinuxProcessProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LinuxProcessProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessProvider for LinuxProcessProvider {
    fn platform(&self) -> &'static str {
        "linux"
    }

    fn find_by_port(&self, port: u16) -> PortResult<Vec<PortProcess>> {
        let mut sockets: Vec<(NetRow, &'static str)> = Vec::new();

        // TCP 只看 LISTEN：端口「被占用」= 有人监听
        for (path, proto) in [("/proc/net/tcp", "tcp"), ("/proc/net/tcp6", "tcp6")] {
            sockets.extend(
                read_proc_net(path)
                    .into_iter()
                    .filter(|row| row.state == Some(state::LISTEN) && row.port == port)
                    .map(|row| (row, proto)),
            );
        }

        // UDP 无 LISTEN 状态，本地端口匹配即占用
        for (path, proto) in [("/proc/net/udp", "udp"), ("/proc/net/udp6", "udp6")] {
            sockets.extend(
                read_proc_net(path)
                    .into_iter()
                    .filter(|row| row.port == port)
                    .map(|row| (row, proto)),
            );
        }

        resolve(sockets)
    }

    fn list_ports(&self) -> PortResult<Vec<PortProcess>> {
        let mut sockets: Vec<(NetRow, &'static str)> = Vec::new();

        for (path, proto) in [
            ("/proc/net/tcp", "tcp"),
            ("/proc/net/tcp6", "tcp6"),
            ("/proc/net/udp", "udp"),
            ("/proc/net/udp6", "udp6"),
        ] {
            sockets.extend(read_proc_net(path).into_iter().map(|row| (row, proto)));
        }

        resolve(sockets)
    }

    fn kill(&self, pid: u32) -> PortResult<()> {
        // SIGTERM：先礼后兵，给进程清理资源的机会
        signal(pid, libc::SIGTERM)
    }

    fn force_kill(&self, pid: u32) -> PortResult<()> {
        // SIGKILL：进程无法拦截，立即终止
        signal(pid, libc::SIGKILL)
    }
}

/// 读取 `/proc/net/` 下的一个文件。
///
/// 文件不存在（例如内核未启用 IPv6）不是错误，直接返回空。
fn read_proc_net(path: &str) -> Vec<NetRow> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };

    content
        .lines()
        .skip(1) // 跳过表头
        .filter_map(proc_net::parse_net_line)
        .collect()
}

/* ------------------------------------------------------------------
inode → PID → 进程
------------------------------------------------------------------ */

/// 把 socket 归属到具体进程，再交给公共聚合管线。
fn resolve(sockets: Vec<(NetRow, &'static str)>) -> PortResult<Vec<PortProcess>> {
    if sockets.is_empty() {
        return Ok(Vec::new());
    }

    let targets: HashSet<u64> = sockets.iter().map(|(row, _)| row.inode).collect();
    let pid_by_inode = pids_for_inodes(&targets);

    // 一个 socket inode 可能被多个进程共享（fork 之后继承了 fd），逐个展开
    let mut entries: Vec<RawSocket> = Vec::new();
    for (row, proto) in sockets {
        let Some(pids) = pid_by_inode.get(&row.inode) else {
            continue; // 没有权限读取该进程的 fd
        };
        for pid in pids {
            entries.push(
                RawSocket::new(*pid, row.port, proto, row.address.clone()).with_state(row.state),
            );
        }
    }

    if entries.is_empty() {
        // 找到了监听 socket，但无法归属到任何进程 —— 通常是权限不足。
        // 这不算「端口可用」，必须如实报错，否则会误导用户。
        return Err(PortError::PermissionDenied { pid: 0 });
    }

    Ok(aggregate::build_processes(entries))
}

/// 扫描 `/proc/<pid>/fd/*`，把目标 inode 映射到进程号。
fn pids_for_inodes(targets: &HashSet<u64>) -> HashMap<u64, Vec<u32>> {
    let mut found: HashMap<u64, Vec<u32>> = HashMap::new();

    let Ok(entries) = fs::read_dir("/proc") else {
        return found;
    };

    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue; // 非进程目录（/proc 下还有各种子系统目录）
        };

        let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else {
            continue; // 其它用户的进程：权限不足，跳过
        };

        for fd in fds.flatten() {
            let Ok(link) = fs::read_link(fd.path()) else {
                continue; // fd 可能在读取瞬间被关闭
            };
            let Some(inode) = parse_socket_inode(&link) else {
                continue; // 不是 socket
            };
            if targets.contains(&inode) {
                found.entry(inode).or_default().push(pid);
            }
        }

        if found.len() == targets.len() {
            break; // 目标 socket 全部定位完成
        }
    }

    found
}

/// 解析 `socket:[123456]` 形式的符号链接目标
fn parse_socket_inode(target: &Path) -> Option<u64> {
    let text = target.to_str()?;
    let inner = text.strip_prefix("socket:[")?.strip_suffix(']')?;
    inner.parse().ok()
}

/* ------------------------------------------------------------------
信号
------------------------------------------------------------------ */

fn signal(pid: u32, sig: i32) -> PortResult<()> {
    // SAFETY: kill(2) 对任意 pid 都是内存安全的；pid 已经过范围校验。
    let rc = unsafe { libc::kill(pid as libc::pid_t, sig) };

    if rc == 0 {
        return Ok(());
    }

    let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    Err(match errno {
        libc::ESRCH => PortError::ProcessNotFound { pid },
        libc::EPERM => PortError::PermissionDenied { pid },
        _ => PortError::KillFailed {
            pid,
            reason: format!("kill(2) 失败（errno {errno}）"),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_socket_inode_symlink() {
        assert_eq!(
            parse_socket_inode(&PathBuf::from("socket:[123456]")),
            Some(123456)
        );
        assert_eq!(parse_socket_inode(&PathBuf::from("/dev/null")), None);
        assert_eq!(parse_socket_inode(&PathBuf::from("socket:[abc]")), None);
    }

    #[test]
    fn resolving_nothing_is_not_an_error() {
        // 一条 socket 都没有（例如 IPv6 未启用）应当返回空列表，而不是报错
        assert_eq!(resolve(Vec::new()).unwrap(), Vec::new());
    }

    #[test]
    fn unreadable_sockets_are_reported_as_permission_denied() {
        // 找到了监听 socket 却归属不到任何进程：必须如实报错，
        // 不能静默返回空列表让界面以为「端口可用」
        let row = NetRow {
            port: 3000,
            address: "0.0.0.0".to_string(),
            state: Some(state::LISTEN),
            inode: u64::MAX, // 这个 inode 不可能存在
        };
        assert!(matches!(
            resolve(vec![(row, "tcp")]),
            Err(PortError::PermissionDenied { .. })
        ));
    }
}
