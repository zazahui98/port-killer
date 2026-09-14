pub mod inspect;

use serde::{Deserialize, Serialize};

/// 占用某个端口的进程。
///
/// 字段与前端 `src/types/port.ts` 中的 `PortProcess` 逐字对应。
/// `None` 的字段直接不参与序列化（而不是输出 `null`），
/// 这样前端拿到的就是真正的「可选属性」。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortProcess {
    pub pid: u32,
    /// 进程名（如 node、java、python3）
    pub process_name: String,
    pub port: u16,
    /// tcp / tcp6 / udp / udp6
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    /// 本地绑定地址：`0.0.0.0`（所有网卡）/ `127.0.0.1`（仅本机）/ `::` / `::1`。
    /// 区分「对外可访问」与「仅本机」时很有用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_address: Option<String>,
    /// 规范化后的 TCP 状态（LISTEN / ESTABLISHED / TIME_WAIT …）。
    /// UDP 没有连接状态，为 `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// 完整启动命令行；权限不足时可能缺失
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// 可执行文件完整路径；权限不足时可能缺失
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    /// 进程所属用户；权限不足时可能缺失
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

impl PortProcess {
    pub fn new(pid: u32, process_name: impl Into<String>, port: u16) -> Self {
        Self {
            pid,
            process_name: process_name.into(),
            port,
            protocol: None,
            local_address: None,
            state: None,
            command: None,
            executable_path: None,
            user: None,
        }
    }

    pub fn with_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.protocol = Some(protocol.into());
        self
    }

    pub fn with_local_address(mut self, address: Option<String>) -> Self {
        self.local_address = address.filter(|a| !a.trim().is_empty());
        self
    }

    pub fn with_state(mut self, state: Option<String>) -> Self {
        self.state = state.filter(|s| !s.trim().is_empty());
        self
    }

    pub fn with_command(mut self, command: Option<String>) -> Self {
        self.command = command.filter(|c| !c.trim().is_empty());
        self
    }

    pub fn with_executable_path(mut self, path: Option<String>) -> Self {
        self.executable_path = path.filter(|p| !p.trim().is_empty());
        self
    }

    pub fn with_user(mut self, user: Option<String>) -> Self {
        self.user = user.filter(|u| !u.trim().is_empty());
        self
    }
}

/// 端口占用状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PortStatus {
    Available,
    Occupied,
    Unknown,
}

/// 一次端口检查的完整结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    pub status: PortStatus,
    pub processes: Vec<PortProcess>,
}

impl PortInfo {
    pub fn from_processes(port: u16, processes: Vec<PortProcess>) -> Self {
        let status = if processes.is_empty() {
            PortStatus::Available
        } else {
            PortStatus::Occupied
        };
        Self {
            port,
            status,
            processes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_fields_are_omitted_not_null() {
        let p = PortProcess::new(1234, "node", 3000);
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["pid"], 1234);
        assert_eq!(json["processName"], "node");
        assert_eq!(json["port"], 3000);
        // 可选字段不应出现
        assert!(json.get("command").is_none());
        assert!(json.get("user").is_none());
        assert!(json.get("protocol").is_none());
        assert!(json.get("localAddress").is_none());
        assert!(json.get("state").is_none());
        assert!(json.get("executablePath").is_none());
    }

    #[test]
    fn blank_optional_fields_are_normalized_to_none() {
        // 空字符串必须被规范成 None —— 否则会以 "protocol": "" 的形式
        // 输出到前端，把「未知」和「空」混为一谈。
        let p = PortProcess::new(1, "x", 80)
            .with_local_address(Some("  ".to_string()))
            .with_state(Some(String::new()))
            .with_executable_path(Some("\t".to_string()));
        assert!(p.local_address.is_none());
        assert!(p.state.is_none());
        assert!(p.executable_path.is_none());
    }

    #[test]
    fn new_fields_serialize_in_camel_case() {
        let p = PortProcess::new(7, "node", 3000)
            .with_local_address(Some("127.0.0.1".to_string()))
            .with_state(Some("LISTEN".to_string()))
            .with_executable_path(Some("/usr/bin/node".to_string()));
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["localAddress"], "127.0.0.1");
        assert_eq!(json["state"], "LISTEN");
        assert_eq!(json["executablePath"], "/usr/bin/node");
    }

    #[test]
    fn empty_command_is_normalized_to_none() {
        let p = PortProcess::new(1, "x", 80).with_command(Some("   ".to_string()));
        assert!(p.command.is_none());
    }

    #[test]
    fn status_follows_process_count() {
        assert_eq!(
            PortInfo::from_processes(3000, vec![]).status,
            PortStatus::Available
        );
        assert_eq!(
            PortInfo::from_processes(3000, vec![PortProcess::new(1, "node", 3000)]).status,
            PortStatus::Occupied
        );
    }

    #[test]
    fn status_serializes_lowercase() {
        let info = PortInfo::from_processes(80, vec![]);
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["status"], "available");
    }
}
