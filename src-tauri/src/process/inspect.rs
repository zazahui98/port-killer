use std::collections::HashMap;
use std::ffi::OsString;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind, Users};

/// 进程的补充信息。
///
/// 这些字段都可能是 `None`：以低权限运行时，系统会拒绝读取
/// 其它用户的进程命令行，此时应优雅降级而不是报错。
#[derive(Debug, Clone, Default)]
pub struct ProcessMeta {
    pub name: Option<String>,
    pub command: Option<String>,
    pub user: Option<String>,
    /// 可执行文件完整路径。
    ///
    /// 与 `command` 互补：`command` 回答「它是被怎么启动的」，
    /// `exe` 回答「这个程序装在哪」。两者都拿不到时前端会优雅降级。
    pub exe: Option<String>,
}

/// 批量查询进程信息。
///
/// 只对目标 PID 做「富化」（命令行 / 用户），不对全系统进程逐个读取
/// 命令行 —— 那在 Windows 上会带来几十毫秒到数百毫秒的无谓开销。
pub fn lookup_many(pids: &[u32]) -> HashMap<u32, ProcessMeta> {
    let mut result = HashMap::new();
    if pids.is_empty() {
        return result;
    }

    let targets: Vec<Pid> = pids.iter().copied().map(Pid::from_u32).collect();

    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&targets),
        true,
        // 只取需要的三项：命令行、可执行文件路径、属主。
        // 刻意不用 everything()——那会连带读取 environ / cwd，明显更慢。
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_user(UpdateKind::OnlyIfNotSet),
    );

    // 用户名表只在真的需要时才构建（枚举系统用户本身有开销）
    let needs_user = targets
        .iter()
        .any(|pid| system.process(*pid).and_then(|p| p.user_id()).is_some());
    let users = if needs_user {
        Some(Users::new_with_refreshed_list())
    } else {
        None
    };

    for pid in targets {
        let Some(proc_) = system.process(pid) else {
            continue; // 进程在查询过程中退出了
        };

        let name = non_empty(proc_.name().to_string_lossy().into_owned());
        let command = join_command(proc_.cmd());
        let exe = proc_
            .exe()
            .map(|p| p.to_string_lossy().into_owned())
            .and_then(non_empty);
        let user = users
            .as_ref()
            .and_then(|u| proc_.user_id().and_then(|uid| u.get_user_by_id(uid)))
            .map(|u| u.name().to_string())
            .and_then(non_empty);

        result.insert(
            pid.as_u32(),
            ProcessMeta {
                name,
                command,
                user,
                exe,
            },
        );
    }

    result
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 把 `["node", "/app/server.js"]` 还原成可读的 `node /app/server.js`。
///
/// 含空格的参数会被引号包裹，避免显示成两个参数。
fn join_command(parts: &[OsString]) -> Option<String> {
    if parts.is_empty() {
        return None;
    }

    let rendered: Vec<String> = parts
        .iter()
        .map(|p| {
            let s = p.to_string_lossy().into_owned();
            if s.contains(' ') && !s.starts_with('"') {
                format!("\"{s}\"")
            } else {
                s
            }
        })
        .collect();

    non_empty(rendered.join(" "))
}
