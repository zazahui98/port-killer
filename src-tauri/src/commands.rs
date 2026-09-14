//! Tauri 命令层 —— 前端与原生能力之间的唯一入口。
//!
//! 每个命令都遵循同一套防御流程：
//!   1. 校验参数（端口 1–65535 / PID > 0），非法直接拒绝
//!   2. 把阻塞的系统调用丢进 `spawn_blocking`，绝不占用 UI 线程
//!   3. 错误统一转成 `PortError`，前端按 `code` 决定 UI

use tauri::async_runtime::spawn_blocking;

use crate::error::{validate_pid, validate_port, PortError, PortResult};
use crate::platform;
use crate::process::{PortInfo, PortProcess};

/// 在阻塞线程池里执行一段原生操作，并把 JoinError 收敛成 PortError。
async fn blocking<T, F>(job: F) -> PortResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> PortResult<T> + Send + 'static,
{
    spawn_blocking(job).await.map_err(|e| PortError::Unknown {
        message: format!("原生任务执行失败：{e}"),
    })?
}

/// 检查端口占用情况，返回结构化结果（前端首页主流程使用）。
#[tauri::command]
pub async fn check_port(port: i64) -> PortResult<PortInfo> {
    let port = validate_port(port)?;
    blocking(move || {
        let processes = platform::provider().find_by_port(port)?;
        Ok(PortInfo::from_processes(port, processes))
    })
    .await
}

/// 终结进程。
///
/// `force = false`：礼貌终结（Unix 发 SIGTERM）
/// `force = true` ：强制终结（Unix 发 SIGKILL）
///
/// 调用方在终结成功后应当重新调用 `check_port` 确认端口真的释放了 ——
/// 系统调用返回成功不等于进程已经退出。
#[tauri::command]
pub async fn kill_process(pid: i64, force: bool) -> PortResult<()> {
    let pid = validate_pid(pid)?;
    blocking(move || {
        let provider = platform::provider();
        if force {
            provider.force_kill(pid)
        } else {
            provider.kill(pid)
        }
    })
    .await
}

/// 列出本机全部端口占用（「端口列表」视图使用）。
///
/// 返回**已聚合**的行：同一「协议 + 端口 + PID」的多条 socket
/// （1 个 LISTEN 加若干 ESTABLISHED）合并成一行。
/// 是否只看监听、要不要显示 UDP，由前端按 `state` 自行过滤 ——
/// 这样切换视图不需要重新发起系统调用。
#[tauri::command]
pub async fn list_ports() -> PortResult<Vec<PortProcess>> {
    blocking(|| platform::provider().list_ports()).await
}

/// 当前平台标识（windows / macos / linux），供设置面板展示。
#[tauri::command]
pub fn platform_info() -> String {
    platform::provider().platform().to_string()
}
