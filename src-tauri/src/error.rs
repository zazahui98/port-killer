use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// 结构化错误。
///
/// 前端只依赖 `code` 决定 UI，`message` 是给人看的兜底文案。
/// 底层系统错误（errno / Win32 error code）会被翻译成这里的语义化变体，
/// 不会原样透出给用户。
#[derive(Debug, thiserror::Error)]
pub enum PortError {
    #[error("请输入 1–65535 之间的端口")]
    InvalidPort { port: i64 },

    #[error("权限不足，无法终结该进程（PID {pid}）")]
    PermissionDenied { pid: u32 },

    #[error("进程已不存在（PID {pid}）")]
    ProcessNotFound { pid: u32 },

    #[error("无法终结该进程（PID {pid}）：{reason}")]
    KillFailed { pid: u32, reason: String },

    #[error("当前平台不受支持：{platform}")]
    PlatformUnsupported { platform: String },

    #[error("{message}")]
    Unknown { message: String },
}

impl PortError {
    pub fn code(&self) -> &'static str {
        match self {
            PortError::InvalidPort { .. } => "INVALID_PORT",
            PortError::PermissionDenied { .. } => "PERMISSION_DENIED",
            PortError::ProcessNotFound { .. } => "PROCESS_NOT_FOUND",
            PortError::KillFailed { .. } => "KILL_FAILED",
            PortError::PlatformUnsupported { .. } => "PLATFORM_UNSUPPORTED",
            PortError::Unknown { .. } => "UNKNOWN",
        }
    }
}

/// 序列化成 `{ "code": "...", "message": "..." }`，与前端 `PortError` 对应。
impl Serialize for PortError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("PortError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type PortResult<T> = Result<T, PortError>;

/// 端口合法性校验 —— 前端与原生层都会执行，两侧互不信任。
pub fn validate_port(port: i64) -> PortResult<u16> {
    if (1..=65535).contains(&port) {
        Ok(port as u16)
    } else {
        Err(PortError::InvalidPort { port })
    }
}

/// PID 合法性校验：0 与负数在 POSIX / Windows 上都不是有效进程号。
pub fn validate_pid(pid: i64) -> PortResult<u32> {
    if pid > 0 && pid <= u32::MAX as i64 {
        Ok(pid as u32)
    } else {
        Err(PortError::ProcessNotFound {
            pid: pid.max(0) as u32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_ports() {
        assert_eq!(validate_port(1).unwrap(), 1);
        assert_eq!(validate_port(3000).unwrap(), 3000);
        assert_eq!(validate_port(65535).unwrap(), 65535);
    }

    #[test]
    fn rejects_out_of_range_ports() {
        for bad in [-1, 0, 65536, 100_000, i64::MIN, i64::MAX] {
            assert!(
                matches!(validate_port(bad), Err(PortError::InvalidPort { .. })),
                "端口 {bad} 应当被拒绝"
            );
        }
    }

    #[test]
    fn rejects_invalid_pids() {
        assert!(validate_pid(0).is_err());
        assert!(validate_pid(-5).is_err());
        assert_eq!(validate_pid(4242).unwrap(), 4242);
    }

    #[test]
    fn error_serializes_to_code_and_message() {
        let err = PortError::PermissionDenied { pid: 42 };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "PERMISSION_DENIED");
        assert!(json["message"].as_str().unwrap().contains("42"));
    }
}
