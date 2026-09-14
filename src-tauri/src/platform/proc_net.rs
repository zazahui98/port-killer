//! Linux `/proc/net/{tcp,tcp6,udp,udp6}` 的纯解析逻辑。
//!
//! **本模块刻意不带 `#[cfg(target_os = "linux")]`。**
//! 这些是纯字符串处理，放在门控模块里会导致它们的单元测试
//! 只在 Linux 上被编译 —— 而本项目的主力开发与验证平台是 Windows，
//! 等于这些测试从来没跑过。抽出来之后所有平台都能验证。
//! （同样的教训在 `lsof_parser` 上踩过一次。）
//!
//! 只负责解析，不碰文件系统 —— IO 留在 `linux.rs`。

use std::net::{Ipv4Addr, Ipv6Addr};

use super::state::{self, TcpState};

/// `/proc/net/*` 里的一行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetRow {
    pub port: u16,
    /// 本地绑定地址，已还原成可读形式（`0.0.0.0` / `127.0.0.1` / `::1` …）
    pub address: String,
    pub state: Option<TcpState>,
    pub inode: u64,
}

/// 解析 `/proc/net/tcp` 这类文件的一行。
///
/// 列格式（空白分隔）：
/// ```text
/// 0: 0100007F:1F90 00000000:0000 0A ... 1000 0 123456 1 ...
///    ^local_addr   ^rem_addr     ^st     ^uid ^to ^inode
/// ```
pub fn parse_net_line(line: &str) -> Option<NetRow> {
    let mut fields = line.split_whitespace();

    let _slot = fields.next()?;
    let local = fields.next()?; // 0100007F:1F90
    let _remote = fields.next()?;
    let state_hex = fields.next()?;

    // 跳过 tx/rx 队列、tr:tm->when、retrnsmt、uid、timeout
    for _ in 0..5 {
        fields.next()?;
    }
    let inode = fields.next()?.parse::<u64>().ok()?;

    let (address, port) = parse_local_endpoint(local)?;

    Some(NetRow {
        port,
        address,
        state: state::from_linux_hex(state_hex),
        inode,
    })
}

/// 解析 `ADDR:PORT` 形式的本地端点。
///
/// 地址部分是十六进制：IPv4 为 8 个字符，IPv6 为 32 个字符。
/// 端口是**主机字节序**的十六进制（与地址不同，这里不需要反转）。
pub fn parse_local_endpoint(spec: &str) -> Option<(String, u16)> {
    let (addr_hex, port_hex) = spec.rsplit_once(':')?;
    let port = u16::from_str_radix(port_hex, 16).ok()?;

    let address = match addr_hex.len() {
        8 => parse_ipv4_hex(addr_hex)?,
        32 => parse_ipv6_hex(addr_hex)?,
        _ => return None,
    };

    Some((address, port))
}

/// `/proc/net/tcp` 里的 IPv4 地址是**小端**存放的 u32 十六进制，
/// 因此按字节反转后才是有意义的点分十进制。
///
/// 例：`0100007F` → 字节 `[01,00,00,7F]` → 反转 `[7F,00,00,01]` → `127.0.0.1`
pub fn parse_ipv4_hex(hex: &str) -> Option<String> {
    if hex.len() != 8 {
        return None;
    }

    let mut bytes = [0u8; 4];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    bytes.reverse();

    Some(Ipv4Addr::from(bytes).to_string())
}

/// `/proc/net/tcp6` 里的 IPv6 地址是 16 字节，但**每个 32 位字**单独小端存放，
/// 所以要按 4 字节一组分别反转。
///
/// 例：`::1` 在文件里写作 `00000000000000000000000001000000`
/// （最后一组 `01000000` 反转成 `00000001`）
pub fn parse_ipv6_hex(hex: &str) -> Option<String> {
    if hex.len() != 32 {
        return None;
    }

    let mut bytes = [0u8; 16];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    for word in bytes.chunks_exact_mut(4) {
        word.reverse();
    }

    Some(Ipv6Addr::from(bytes).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tcp_listen_line() {
        // 127.0.0.1:3000 LISTEN，inode 98765
        let line = "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 \
                    00:00000000 00000000  1000        0 98765 1 0000000000000000 100 0 0 10 0";
        let row = parse_net_line(line).expect("应当解析成功");
        assert_eq!(row.port, 3000);
        assert_eq!(row.address, "127.0.0.1");
        assert_eq!(row.state, Some(state::LISTEN));
        assert_eq!(row.inode, 98765);
    }

    #[test]
    fn parses_udp_line() {
        let line = "   5: 00000000:0035 00000000:0000 07 00000000:00000000 \
                    00:00000000 00000000     0        0 4242 2 0000000000000000 0";
        let row = parse_net_line(line).expect("应当解析成功");
        assert_eq!(row.port, 53);
        assert_eq!(row.address, "0.0.0.0");
        assert_eq!(row.inode, 4242);
    }

    #[test]
    fn wildcard_and_loopback_are_distinguished() {
        // 0.0.0.0 与 127.0.0.1 是完全不同的语义（对外可访问 / 仅本机），
        // 必须能区分出来
        assert_eq!(parse_ipv4_hex("00000000").as_deref(), Some("0.0.0.0"));
        assert_eq!(parse_ipv4_hex("0100007F").as_deref(), Some("127.0.0.1"));
        assert_eq!(parse_ipv4_hex("0101A8C0").as_deref(), Some("192.168.1.1"));
    }

    #[test]
    fn parses_ipv6_with_per_word_byte_order() {
        // ::1
        assert_eq!(
            parse_ipv6_hex("00000000000000000000000001000000").as_deref(),
            Some("::1")
        );
        // ::  —— 全通配
        assert_eq!(
            parse_ipv6_hex("00000000000000000000000000000000").as_deref(),
            Some("::")
        );
        // ::ffff:127.0.0.1 —— IPv4 映射地址
        assert_eq!(
            parse_ipv6_hex("0000000000000000FFFF00000100007F").as_deref(),
            Some("::ffff:127.0.0.1")
        );
    }

    #[test]
    fn endpoint_requires_a_colon_and_known_address_length() {
        assert!(parse_local_endpoint("0100007F").is_none()); // 缺端口
        assert!(parse_local_endpoint("0100007F:ZZZZ").is_none()); // 端口非十六进制
        assert!(parse_local_endpoint("0100:1F90").is_none()); // 地址长度不合法
        assert_eq!(
            parse_local_endpoint("0100007F:0BB8"),
            Some(("127.0.0.1".to_string(), 3000))
        );
    }

    #[test]
    fn rejects_malformed_lines() {
        assert!(parse_net_line("").is_none());
        assert!(parse_net_line("garbage").is_none());
        assert!(parse_net_line("0: zzzz:zzzz 00000000:0000 0A").is_none());
    }

    #[test]
    fn unknown_state_code_keeps_the_row() {
        // 状态码不认识（例如内核新增了状态）时不该丢掉整行 ——
        // 端口占用信息本身仍然有效，只是状态显示为空。
        let line = "   0: 0100007F:0BB8 00000000:0000 FF 00000000:00000000 \
                    00:00000000 00000000  1000        0 12345 1 0000000000000000 100 0 0 10 0";
        let row = parse_net_line(line).expect("应当解析成功");
        assert_eq!(row.port, 3000);
        assert_eq!(row.state, None);
    }
}
