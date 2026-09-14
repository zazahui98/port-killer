//! 端口终结者 / Port Killer —— 原生层入口。
//!
//! 分层：
//! ```text
//! commands       Tauri 命令边界（参数校验 + 线程调度 + 错误转换）
//!   └ platform   ProcessProvider 抽象，按平台分派
//!       ├ windows  Win32 IP Helper API + TerminateProcess
//!       ├ macos    lsof（直接 execve，不经 shell）+ kill(2)
//!       └ linux    /proc 解析 + kill(2)
//!   └ process    数据模型与进程信息补全
//!   └ error      结构化错误
//! ```

mod error;

// commands / platform / process 对外公开：集成测试需要直接驱动命令层与原生层，
// 才能验证「前端实际调用的那条路径」而不只是内部实现。
pub mod commands;
pub mod platform;
pub mod process;

pub use error::{PortError, PortResult};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::check_port,
            commands::list_ports,
            commands::kill_process,
            commands::platform_info,
        ])
        .run(tauri::generate_context!())
        .expect("端口终结者启动失败");
}
