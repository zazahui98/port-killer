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
        .setup(|app| {
            // 窗口是 `visible: false` 创建的，由前端在首帧画完后调用 `show()`，
            // 这样用户不会看到一个还没画内容的空窗口（「开屏黑屏」）。
            //
            // 但前端一旦加载失败，窗口就永远不会出现 —— 那比黑屏更糟。
            // 所以这里加一道兜底：超时后无条件显示窗口，
            // 此时用户至少能看到 index.html 里的启动占位界面。
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_port,
            commands::list_ports,
            commands::kill_process,
            commands::platform_info,
        ])
        .run(tauri::generate_context!())
        .expect("端口终结者启动失败");
}
