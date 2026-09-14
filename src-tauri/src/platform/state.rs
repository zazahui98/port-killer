//! TCP 连接状态的规范化映射。
//!
//! 三个平台的原始表示完全不同：
//! - Windows：`MIB_TCPROW_OWNER_PID.dwState`，数值枚举（2 = LISTEN）
//! - Linux：`/proc/net/tcp` 的 `st` 列，两位十六进制（`0A` = LISTEN）
//! - macOS：`lsof` 的 `TST=` 字段，直接是名字（`TST=LISTEN`）
//!
//! 这里统一成同一套大写名字，前端只认这一套。
//!
//! **本模块刻意不带 `#[cfg(target_os)]`**：它是纯函数，放在门控模块里会导致
//! 只有对应平台能编译到它，其它平台的测试根本跑不到（这个坑在
//! `lsof_parser` 上已经踩过一次）。

/// 规范化后的 TCP 状态。
///
/// 用 `&'static str` 而不是 enum，是为了让它能直接进 `PortProcess.state`
/// 并序列化成前端可直接展示的字符串，省掉一层转换。
pub type TcpState = &'static str;

pub const CLOSED: TcpState = "CLOSED";
pub const LISTEN: TcpState = "LISTEN";
pub const SYN_SENT: TcpState = "SYN_SENT";
pub const SYN_RECEIVED: TcpState = "SYN_RECEIVED";
pub const ESTABLISHED: TcpState = "ESTABLISHED";
pub const FIN_WAIT_1: TcpState = "FIN_WAIT_1";
pub const FIN_WAIT_2: TcpState = "FIN_WAIT_2";
pub const CLOSE_WAIT: TcpState = "CLOSE_WAIT";
pub const CLOSING: TcpState = "CLOSING";
pub const LAST_ACK: TcpState = "LAST_ACK";
pub const TIME_WAIT: TcpState = "TIME_WAIT";

/// 把 Windows `MIB_TCP_STATE_*` 的数值映射成规范名。
///
/// 常量值取自 `IPHLPAPI.H`（`MIB_TCP_STATE` 枚举）。
pub fn from_windows(code: u32) -> Option<TcpState> {
    Some(match code {
        1 => CLOSED,
        2 => LISTEN,
        3 => SYN_SENT,
        4 => SYN_RECEIVED,
        5 => ESTABLISHED,
        6 => FIN_WAIT_1,
        7 => FIN_WAIT_2,
        8 => CLOSE_WAIT,
        9 => CLOSING,
        10 => LAST_ACK,
        11 => TIME_WAIT,
        // 12 = DELETE_TCB：内核正在回收，对外没有可展示的语义
        _ => return None,
    })
}

/// 把 Linux `/proc/net/tcp` 的 `st` 列（两位十六进制）映射成规范名。
///
/// 常量值取自内核 `include/net/tcp_states.h`。
pub fn from_linux_hex(raw: &str) -> Option<TcpState> {
    let code = u8::from_str_radix(raw.trim(), 16).ok()?;
    Some(match code {
        1 => ESTABLISHED,
        2 => SYN_SENT,
        3 => SYN_RECEIVED,
        4 => FIN_WAIT_1,
        5 => FIN_WAIT_2,
        6 => TIME_WAIT,
        7 => CLOSED,
        8 => CLOSE_WAIT,
        9 => LAST_ACK,
        10 => LISTEN,
        11 => CLOSING,
        // 12 = NEW_SYN_RECV
        _ => return None,
    })
}

/// 把 `lsof` 的 `T` 字段映射成规范名。
///
/// 注意 lsof 的字段标识符本身就是 `T`，所以 `-F T` 输出的是
/// `TST=LISTEN` —— 去掉标识符之后**内容是 `ST=LISTEN`**。
/// 这里两种写法都接受，调用方传整行或传内容都不会出错。
///
/// lsof 只会输出 `ST=<大写名>`；兼容 `FIN_WAIT1` / `FIN_WAIT_1` 两种写法。
pub fn from_lsof(field: &str) -> Option<TcpState> {
    let value = field
        .strip_prefix("ST=")
        .or_else(|| field.strip_prefix("TST="))?
        .trim()
        .to_ascii_uppercase();

    Some(match value.as_str() {
        "CLOSED" => CLOSED,
        "LISTEN" => LISTEN,
        "SYN_SENT" => SYN_SENT,
        "SYN_RECV" | "SYN_RECEIVED" => SYN_RECEIVED,
        "ESTABLISHED" => ESTABLISHED,
        "FIN_WAIT1" | "FIN_WAIT_1" => FIN_WAIT_1,
        "FIN_WAIT2" | "FIN_WAIT_2" => FIN_WAIT_2,
        "CLOSE_WAIT" => CLOSE_WAIT,
        "CLOSING" => CLOSING,
        "LAST_ACK" => LAST_ACK,
        "TIME_WAIT" => TIME_WAIT,
        _ => return None,
    })
}

/// 状态的「活跃度」排序 —— 数值越小越能代表这个端口。
///
/// 同一个端口会同时存在多条 socket：1 个 LISTEN 加若干 ESTABLISHED。
/// 聚合展示时应当用 LISTEN 作为代表（那才是「谁占着这个端口」的答案），
/// 而不是被某条 ESTABLISHED 覆盖掉。
pub fn rank(state: Option<&str>) -> u8 {
    match state {
        Some(LISTEN) => 0,
        Some(ESTABLISHED) => 1,
        Some(SYN_SENT) | Some(SYN_RECEIVED) => 2,
        Some(CLOSE_WAIT) | Some(CLOSING) | Some(LAST_ACK) => 3,
        Some(FIN_WAIT_1) | Some(FIN_WAIT_2) => 4,
        Some(TIME_WAIT) => 5,
        Some(CLOSED) => 6,
        Some(_) => 7,
        // 无状态（UDP，或平台没给出）排在中间偏后：有状态的总归更具体
        None => 8,
    }
}

/// 判断某个状态是否属于「有人在监听」。
///
/// 默认视图只保留这类行 —— 它才是「端口被占用」的答案。
/// UDP 没有监听概念，`None` 也算在内。
pub fn is_listening(state: Option<&str>) -> bool {
    matches!(state, Some(LISTEN) | None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_codes_map_to_canonical_names() {
        assert_eq!(from_windows(2), Some(LISTEN));
        assert_eq!(from_windows(5), Some(ESTABLISHED));
        assert_eq!(from_windows(11), Some(TIME_WAIT));
        assert_eq!(from_windows(8), Some(CLOSE_WAIT));
    }

    #[test]
    fn windows_delete_tcb_is_not_a_displayable_state() {
        // 12 = DELETE_TCB，内核内部状态，不该展示给用户
        assert_eq!(from_windows(12), None);
        assert_eq!(from_windows(0), None);
        assert_eq!(from_windows(999), None);
    }

    #[test]
    fn linux_hex_maps_to_canonical_names() {
        assert_eq!(from_linux_hex("0A"), Some(LISTEN));
        assert_eq!(from_linux_hex("01"), Some(ESTABLISHED));
        assert_eq!(from_linux_hex("06"), Some(TIME_WAIT));
        // 内核输出可能带前后空白
        assert_eq!(from_linux_hex(" 0a "), Some(LISTEN));
    }

    #[test]
    fn linux_unknown_or_garbage_yields_none() {
        assert_eq!(from_linux_hex("0C"), None); // NEW_SYN_RECV
        assert_eq!(from_linux_hex("FF"), None);
        assert_eq!(from_linux_hex("zz"), None);
        assert_eq!(from_linux_hex(""), None);
    }

    #[test]
    fn lsof_fields_map_to_canonical_names() {
        // lsof -F T 输出的整行是 TST=LISTEN；解析器拿到的内容是 ST=LISTEN
        assert_eq!(from_lsof("ST=LISTEN"), Some(LISTEN));
        assert_eq!(from_lsof("ST=ESTABLISHED"), Some(ESTABLISHED));
        // 传整行也必须能用（容错）
        assert_eq!(from_lsof("TST=LISTEN"), Some(LISTEN));
        // lsof 用 FIN_WAIT1（无下划线），也兼容带下划线的写法
        assert_eq!(from_lsof("ST=FIN_WAIT1"), Some(FIN_WAIT_1));
        assert_eq!(from_lsof("ST=FIN_WAIT_1"), Some(FIN_WAIT_1));
    }

    #[test]
    fn lsof_non_state_fields_are_ignored() {
        // T 字段还可能带队列长度等信息（如 TQR=0），非 ST= 前缀一律忽略
        assert_eq!(from_lsof("QR=0"), None);
        assert_eq!(from_lsof("TQR=0"), None);
        assert_eq!(from_lsof(""), None);
        assert_eq!(from_lsof("ST="), None);
    }

    #[test]
    fn listen_outranks_everything_else() {
        let mut states = [
            Some(TIME_WAIT),
            Some(ESTABLISHED),
            Some(LISTEN),
            Some(CLOSE_WAIT),
            None,
        ];
        states.sort_by_key(|s| rank(*s));
        // LISTEN 必须排最前 —— 它才是「谁占着这个端口」的答案
        assert_eq!(states[0], Some(LISTEN));
        assert_eq!(states[1], Some(ESTABLISHED));
        assert_eq!(*states.last().unwrap(), None);
    }

    #[test]
    fn is_listening_covers_tcp_listen_and_udp() {
        assert!(is_listening(Some(LISTEN)));
        assert!(is_listening(None)); // UDP 无状态，视为占用
        assert!(!is_listening(Some(ESTABLISHED)));
        assert!(!is_listening(Some(TIME_WAIT)));
    }
}
