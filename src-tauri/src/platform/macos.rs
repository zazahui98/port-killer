//! macOS 平台实现。
//!
//! macOS 没有 `/proc`，端口 → PID 的映射依赖 `lsof`（系统自带）。
//!
//! 关于「不调用 shell」这条安全约束：
//! 这里**不经过任何 shell**，而是用 `Command::new("lsof").args([...])` 直接
//! execve。所有参数都是固定字面量，端口号经过 `u16` 类型与范围校验后
//! 以十进制拼进 `-iTCP:<port>`，因此不可能出现 `;`、`|`、`$()` 之类的注入。
//! 这与 `sh -c "lsof -i:3000"` 是完全不同的安全等级。
//!
//! 使用 `-F`（field output）而不是默认表格输出，避免解析本地化文本；
//! 解析逻辑在 `platform::lsof_parser`（不带平台门控，任何平台都能测）。

use std::process::Command;

use super::aggregate::{self, RawSocket};
use super::lsof_parser::{parse_lsof_endpoint, parse_lsof_fields, LsofEntry};
use super::ProcessProvider;
use crate::error::{PortError, PortResult};
use crate::process::PortProcess;

/// lsof 的字段集合：进程号 / 命令名 / 协议 / 端点 / TCP 状态
const LSOF_FIELDS: &str = "-FpcPnT";

pub struct MacProcessProvider;

impl MacProcessProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacProcessProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessProvider for MacProcessProvider {
    fn platform(&self) -> &'static str {
        "macos"
    }

    fn find_by_port(&self, port: u16) -> PortResult<Vec<PortProcess>> {
        // TCP 只取 LISTEN 状态的套接字（`-sTCP:LISTEN`）
        let tcp = run_lsof(&[
            "-iTCP:".to_string() + &port.to_string(),
            "-sTCP:LISTEN".to_string(),
        ])?;
        // UDP 没有 LISTEN 状态
        let udp = run_lsof(&["-iUDP:".to_string() + &port.to_string()])?;

        let entries = tcp
            .into_iter()
            .chain(udp)
            .filter_map(to_socket)
            .collect::<Vec<_>>();

        Ok(aggregate::build_processes(entries))
    }

    fn list_ports(&self) -> PortResult<Vec<PortProcess>> {
        // `-i` 不带参数即「所有网络文件」。
        // 非 root 运行时 lsof 只能看到自己的进程，这是平台限制，不额外报错。
        let entries = run_lsof(&[])
            .unwrap_or_default()
            .into_iter()
            .filter_map(to_socket)
            .collect::<Vec<_>>();

        Ok(aggregate::build_processes(entries))
    }

    fn kill(&self, pid: u32) -> PortResult<()> {
        signal(pid, libc::SIGTERM)
    }

    fn force_kill(&self, pid: u32) -> PortResult<()> {
        signal(pid, libc::SIGKILL)
    }
}

/// 把一条 lsof 记录转成原始 socket。
///
/// 端点解析不出来（例如畸形输入）时返回 `None`，整条丢弃。
/// lsof 的 `c` 字段作为进程名提示带上 —— sysinfo 拿不到进程名时用它兜底
/// （例如权限受限读不到目标进程信息）。
fn to_socket(entry: LsofEntry) -> Option<RawSocket> {
    let (address, port) = parse_lsof_endpoint(&entry.name)?;

    // lsof 的 P 字段是 `TCP` / `UDP`（大写）；缺失时按 TCP 处理
    let protocol = entry.protocol.to_ascii_lowercase();
    let protocol = if protocol.is_empty() {
        "tcp"
    } else {
        protocol.as_str()
    };

    Some(
        RawSocket::new(entry.pid, port, protocol, address)
            .with_state(entry.state)
            .with_name_hint(Some(entry.command)),
    )
}

/// 执行 lsof 并解析字段输出。
///
/// `filters` 是附加的位置参数（如 `-iTCP:3000`）。不带过滤条件时
/// 查询所有网络文件。
fn run_lsof(filters: &[String]) -> PortResult<Vec<LsofEntry>> {
    let mut args: Vec<&str> = vec![
        "-nP", // 不解析主机名与端口名（避免 DNS 查询、保持数字形式）
        LSOF_FIELDS,
    ];
    if filters.is_empty() {
        args.push("-i");
    } else {
        args.extend(filters.iter().map(String::as_str));
    }

    let output = Command::new("lsof")
        .args(&args)
        .output()
        .map_err(|e| PortError::Unknown {
            message: format!("无法执行 lsof：{e}"),
        })?;

    // lsof 在「没有匹配结果」时返回 1，这是正常情况而非错误
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(PortError::Unknown {
            message: format!(
                "lsof 执行失败（退出码 {:?}）",
                output.status.code().unwrap_or(-1)
            ),
        });
    }

    Ok(parse_lsof_fields(&String::from_utf8_lossy(&output.stdout)))
}

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
    use crate::platform::state;

    fn entry(pid: u32, name: &str, protocol: &str) -> LsofEntry {
        LsofEntry {
            pid,
            command: "node".to_string(),
            name: name.to_string(),
            protocol: protocol.to_string(),
            state: None,
        }
    }

    #[test]
    fn converts_a_tcp_listener() {
        let socket = to_socket(entry(1234, "*:3000", "TCP")).expect("应当转换成功");
        assert_eq!(socket.pid, 1234);
        assert_eq!(socket.port, 3000);
        assert_eq!(socket.protocol, "tcp");
        assert_eq!(socket.address, "*");
    }

    #[test]
    fn protocol_is_lowercased_for_the_shared_contract() {
        let socket = to_socket(entry(1, "*:53", "UDP")).unwrap();
        assert_eq!(socket.protocol, "udp");
    }

    #[test]
    fn state_is_carried_through() {
        let mut e = entry(1, "*:3000", "TCP");
        e.state = Some(state::LISTEN);
        assert_eq!(to_socket(e).unwrap().state, Some(state::LISTEN));
    }

    #[test]
    fn unparsable_endpoints_are_dropped_not_fatal() {
        assert!(to_socket(entry(1, "garbage", "TCP")).is_none());
        assert!(to_socket(entry(1, "127.0.0.1:99999", "TCP")).is_none());
    }
}
