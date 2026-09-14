use std::sync::OnceLock;

use crate::error::PortResult;
use crate::process::PortProcess;

/// `lsof -Fpc` 的字段解析器 —— 不依赖任何平台 API，因此放成独立模块，
/// 让 macOS 之外也能跑它的单元测试（参见 `lsof_parser::tests`）。
pub mod lsof_parser;

/// TCP 状态规范化 —— 同样是纯逻辑，三平台共用且在任何平台都能被测试。
pub mod state;

/// Linux `/proc/net/*` 的纯解析逻辑 —— 不带平台门控，测试在任何平台都能跑。
pub mod proc_net;

/// 「原始 socket → 聚合后的 PortProcess 列表」的公共管线，三平台共用。
pub mod aggregate;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "linux")]
pub mod linux;

/// 平台能力接口。
///
/// 上层（commands）只依赖这个 trait，不关心底层是 Win32 API、
/// /proc 文件系统还是 lsof。新增平台只需实现它并在这里注册。
///
/// 约定：
/// - `find_by_port` 只返回**占用/监听**该端口的进程，不做全端口扫描
/// - `list_ports` 返回本机全部端口占用（已按 协议+端口+PID 聚合），
///   供「端口列表」视图使用；调用方按 `state` 自行决定展示范围
/// - `kill` 是「礼貌」的终结（Unix 发 SIGTERM），允许进程自行收尾
/// - `force_kill` 是「强制」终结（Unix 发 SIGKILL），不给进程收尾机会
pub trait ProcessProvider: Send + Sync {
    /// 平台标识，用于设置面板展示
    fn platform(&self) -> &'static str;

    /// 查询占用指定端口的进程（TCP 与 UDP 均包含）
    fn find_by_port(&self, port: u16) -> PortResult<Vec<PortProcess>>;

    /// 列出本机全部端口占用。
    ///
    /// 返回的是**聚合后**的行：同一 `协议 + 端口 + PID` 的多条 socket
    /// （1 个 LISTEN 加若干 ESTABLISHED）会合并成一行，
    /// 并以 `rank()` 最靠前的状态作为代表，避免列表被连接数刷屏。
    fn list_ports(&self) -> PortResult<Vec<PortProcess>>;

    /// 终结进程
    fn kill(&self, pid: u32) -> PortResult<()>;

    /// 强制终结进程
    fn force_kill(&self, pid: u32) -> PortResult<()>;
}

/// 全局唯一的 provider 实例。
pub fn provider() -> &'static dyn ProcessProvider {
    static INSTANCE: OnceLock<Box<dyn ProcessProvider>> = OnceLock::new();

    INSTANCE
        .get_or_init(|| {
            #[cfg(target_os = "windows")]
            {
                Box::new(windows::WindowsProcessProvider::new())
            }
            #[cfg(target_os = "macos")]
            {
                Box::new(macos::MacProcessProvider::new())
            }
            #[cfg(target_os = "linux")]
            {
                Box::new(linux::LinuxProcessProvider::new())
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
            {
                Box::new(UnsupportedProvider)
            }
        })
        .as_ref()
}

/// 兜底实现：在不支持的平台上给出明确错误，而不是编译失败或崩溃。
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub struct UnsupportedProvider;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
impl ProcessProvider for UnsupportedProvider {
    fn platform(&self) -> &'static str {
        std::env::consts::OS
    }

    fn find_by_port(&self, _port: u16) -> PortResult<Vec<PortProcess>> {
        Err(crate::error::PortError::PlatformUnsupported {
            platform: std::env::consts::OS.to_string(),
        })
    }

    fn list_ports(&self) -> PortResult<Vec<PortProcess>> {
        Err(crate::error::PortError::PlatformUnsupported {
            platform: std::env::consts::OS.to_string(),
        })
    }

    fn kill(&self, _pid: u32) -> PortResult<()> {
        Err(crate::error::PortError::PlatformUnsupported {
            platform: std::env::consts::OS.to_string(),
        })
    }

    fn force_kill(&self, _pid: u32) -> PortResult<()> {
        Err(crate::error::PortError::PlatformUnsupported {
            platform: std::env::consts::OS.to_string(),
        })
    }
}
