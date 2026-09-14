//! Windows 平台实现。
//!
//! 端口 → PID 的映射通过 IP Helper API 完成：
//!   * `GetExtendedTcpTable(TCP_TABLE_OWNER_PID_ALL)`
//!   * `GetExtendedUdpTable(UDP_TABLE_OWNER_PID)`
//!
//! 终结进程通过 `OpenProcess` + `TerminateProcess` 完成。
//!
//! 整个模块不产生任何子进程、不拼接任何命令行字符串，
//! 因此不存在命令注入面。

use std::ffi::c_void;
use std::net::{Ipv4Addr, Ipv6Addr};

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID,
    MIB_UDP6ROW_OWNER_PID, MIB_UDPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

use super::aggregate::{self, RawSocket};
use super::{state, ProcessProvider};
use crate::error::{PortError, PortResult};
use crate::process::PortProcess;

/// 缓冲区初始大小（16KB 足够覆盖绝大多数机器的连接表）
const INITIAL_BUFFER: u32 = 16 * 1024;
/// 缓冲区重试上限，防御性地避免极端情况下的死循环
const MAX_RETRIES: usize = 8;

pub struct WindowsProcessProvider;

impl WindowsProcessProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WindowsProcessProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessProvider for WindowsProcessProvider {
    fn platform(&self) -> &'static str {
        "windows"
    }

    fn find_by_port(&self, port: u16) -> PortResult<Vec<PortProcess>> {
        let mut entries = Vec::new();

        // ---- TCP ----
        // 只看 LISTEN。一个端口「被占用」的语义就是有人在这里监听；
        // 若把 ESTABLISHED 也算进来，浏览器与 dev server 之间的连接
        // 会造成重复甚至误报。
        for (protocol, rows) in [
            ("tcp", tcp_v4_rows(&query_tcp(AF_INET)?)),
            ("tcp6", tcp_v6_rows(&query_tcp(AF_INET6)?)),
        ] {
            entries.extend(
                rows.into_iter()
                    .filter(|row| row.state == Some(state::LISTEN) && row.port == port)
                    .map(|row| with_protocol(row, protocol)),
            );
        }

        // ---- UDP ----
        // UDP 没有 LISTEN 状态，本地端口匹配即视为占用。
        for (protocol, rows) in [
            ("udp", udp_v4_rows(&query_udp(AF_INET)?)),
            ("udp6", udp_v6_rows(&query_udp(AF_INET6)?)),
        ] {
            entries.extend(
                rows.into_iter()
                    .filter(|row| row.port == port)
                    .map(|row| with_protocol(row, protocol)),
            );
        }

        Ok(aggregate::build_processes(entries))
    }

    fn list_ports(&self) -> PortResult<Vec<PortProcess>> {
        let mut entries = Vec::new();

        for (protocol, rows) in [
            ("tcp", tcp_v4_rows(&query_tcp(AF_INET)?)),
            ("tcp6", tcp_v6_rows(&query_tcp(AF_INET6)?)),
            ("udp", udp_v4_rows(&query_udp(AF_INET)?)),
            ("udp6", udp_v6_rows(&query_udp(AF_INET6)?)),
        ] {
            entries.extend(rows.into_iter().map(|row| with_protocol(row, protocol)));
        }

        Ok(aggregate::build_processes(entries))
    }

    fn kill(&self, pid: u32) -> PortResult<()> {
        terminate(pid)
    }

    fn force_kill(&self, pid: u32) -> PortResult<()> {
        // Windows 上 TerminateProcess 本身就是强制的。
        // 「普通终结 / 强制终结」在 Windows 上的差别体现在用户确认的强度，
        // 而不是系统调用 —— 这一点在 UI 文案里如实体现。
        terminate(pid)
    }
}

/// 给原始记录打上协议标记（表来源决定协议，行本身不带）。
fn with_protocol(mut row: RawSocket, protocol: &str) -> RawSocket {
    row.protocol = protocol.to_string();
    row
}

/// 查询 TCP 表。`family` 取 `AF_INET` / `AF_INET6`。
fn query_tcp(family: u16) -> PortResult<Vec<u8>> {
    query_table(|ptr, size| unsafe {
        GetExtendedTcpTable(ptr, size, 0, family as u32, TCP_TABLE_OWNER_PID_ALL, 0)
    })
}

/// 查询 UDP 表。`family` 取 `AF_INET` / `AF_INET6`。
fn query_udp(family: u16) -> PortResult<Vec<u8>> {
    query_table(|ptr, size| unsafe {
        GetExtendedUdpTable(ptr, size, 0, family as u32, UDP_TABLE_OWNER_PID, 0)
    })
}

/* ------------------------------------------------------------------
表解析
------------------------------------------------------------------
四个表的布局都是「u32 行数 + 紧跟着的定长行数组」。缓冲区由 `query_table`
从系统 API 拿到，类型是 `Vec<u8>` —— **对齐只有 1 字节**。因此所有结构体
一律用 `read_unaligned` 读取，绝不把缓冲区转成 `&MIB_TCPTABLE_OWNER_PID`
之类的引用：分配器这次恰好给了对齐地址，不代表那个转换在语义上合法
（那是 UB，Miri 会直接报错）。
------------------------------------------------------------------ */

/// 表头字节数：四个表的第一个字段都是 `u32` 行数。
const HEADER_LEN: usize = size_of::<u32>();

/// 读出「第一行的起始地址 + 行数」，并确认整个行数组都落在缓冲区内。
///
/// 缓冲区过短、或行数与缓冲区长度对不上时返回 `None`。
fn table_rows<Row>(buffer: &[u8]) -> Option<(*const u8, usize)> {
    let row_size = size_of::<Row>();
    if buffer.len() < HEADER_LEN {
        return None;
    }

    // SAFETY: 上面已确认至少有 HEADER_LEN 字节，足够容纳一个 u32。
    let count = unsafe { (buffer.as_ptr() as *const u32).read_unaligned() } as usize;

    // 行数是系统给的，缓冲区却是我们自己分配的 —— 两边对不上就放弃，绝不越界读。
    // 安全软件与 VPN 驱动会挂钩这些 IP Helper API，不能假设返回值永远自洽。
    let need = HEADER_LEN.checked_add(count.checked_mul(row_size)?)?;
    if buffer.len() < need {
        return None;
    }

    // SAFETY: 已确认 need <= buffer.len()，第 0..count 行全部在缓冲区内。
    Some((unsafe { buffer.as_ptr().add(HEADER_LEN) }, count))
}

/// 读出第 `i` 行。
///
/// # Safety
/// `head` 必须来自 `table_rows::<Row>`，且 `i < count`。
#[inline]
unsafe fn row_at<Row: Copy>(head: *const u8, i: usize) -> Row {
    (head.add(i * size_of::<Row>()) as *const Row).read_unaligned()
}

/// `dwLocalPort` 的高 16 位为 0，端口以大端存放在低 16 位。
#[inline]
fn port_of(raw: u32) -> u16 {
    u16::from_be(raw as u16)
}

/// 从缓冲区读出所有 IPv4 TCP 端点
fn tcp_v4_rows(buffer: &[u8]) -> Vec<RawSocket> {
    let Some((head, count)) = table_rows::<MIB_TCPROW_OWNER_PID>(buffer) else {
        return Vec::new();
    };

    (0..count)
        .map(|i| {
            // SAFETY: head / count 来自 table_rows，且 i < count。
            let row: MIB_TCPROW_OWNER_PID = unsafe { row_at(head, i) };
            // protocol 由调用方按表来源填充
            RawSocket::new(
                row.dwOwningPid,
                port_of(row.dwLocalPort),
                "",
                ipv4_of(row.dwLocalAddr),
            )
            .with_state(state::from_windows(row.dwState))
        })
        .collect()
}

/// 从缓冲区读出所有 IPv6 TCP 端点
fn tcp_v6_rows(buffer: &[u8]) -> Vec<RawSocket> {
    let Some((head, count)) = table_rows::<MIB_TCP6ROW_OWNER_PID>(buffer) else {
        return Vec::new();
    };

    (0..count)
        .map(|i| {
            // SAFETY: head / count 来自 table_rows，且 i < count。
            let row: MIB_TCP6ROW_OWNER_PID = unsafe { row_at(head, i) };
            RawSocket::new(
                row.dwOwningPid,
                port_of(row.dwLocalPort),
                "",
                ipv6_of(&row.ucLocalAddr),
            )
            .with_state(state::from_windows(row.dwState))
        })
        .collect()
}

fn udp_v4_rows(buffer: &[u8]) -> Vec<RawSocket> {
    let Some((head, count)) = table_rows::<MIB_UDPROW_OWNER_PID>(buffer) else {
        return Vec::new();
    };

    (0..count)
        .map(|i| {
            // SAFETY: head / count 来自 table_rows，且 i < count。
            let row: MIB_UDPROW_OWNER_PID = unsafe { row_at(head, i) };
            // UDP 是无连接的，没有 TCP 那种状态
            RawSocket::new(
                row.dwOwningPid,
                port_of(row.dwLocalPort),
                "",
                ipv4_of(row.dwLocalAddr),
            )
        })
        .collect()
}

fn udp_v6_rows(buffer: &[u8]) -> Vec<RawSocket> {
    let Some((head, count)) = table_rows::<MIB_UDP6ROW_OWNER_PID>(buffer) else {
        return Vec::new();
    };

    (0..count)
        .map(|i| {
            // SAFETY: head / count 来自 table_rows，且 i < count。
            let row: MIB_UDP6ROW_OWNER_PID = unsafe { row_at(head, i) };
            RawSocket::new(
                row.dwOwningPid,
                port_of(row.dwLocalPort),
                "",
                ipv6_of(&row.ucLocalAddr),
            )
        })
        .collect()
}

/// IPv4 地址在 API 返回的 DWORD 里是**网络字节序**（与端口一致），
/// 因此按内存顺序取字节就是正确的点分十进制顺序。
fn ipv4_of(raw: u32) -> String {
    Ipv4Addr::from(raw.to_ne_bytes()).to_string()
}

/// IPv6 地址已经是 16 个字节的原始形式，直接转换。
fn ipv6_of(bytes: &[u8; 16]) -> String {
    Ipv6Addr::from(*bytes).to_string()
}

/// 反复调用 Win32 表查询函数，直到缓冲区足够大。
fn query_table<F>(mut call: F) -> PortResult<Vec<u8>>
where
    F: FnMut(*mut c_void, *mut u32) -> u32,
{
    let mut size = INITIAL_BUFFER;

    for _ in 0..MAX_RETRIES {
        let mut buffer = vec![0u8; size as usize];
        let status = call(buffer.as_mut_ptr() as *mut c_void, &mut size);

        if status == NO_ERROR {
            buffer.truncate(size as usize);
            return Ok(buffer);
        }

        if status == ERROR_INSUFFICIENT_BUFFER {
            if size == 0 {
                return Err(PortError::Unknown {
                    message: "系统返回的缓冲区大小无效".into(),
                });
            }
            continue; // size 已被填充为所需大小，重新分配后重试
        }

        return Err(PortError::Unknown {
            message: format!("读取系统端口表失败（Win32 错误码 {status}）"),
        });
    }

    Err(PortError::Unknown {
        message: "读取系统端口表失败：缓冲区多次不足".into(),
    })
}

/// 打开进程并终止它。
fn terminate(pid: u32) -> PortResult<()> {
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);

        if handle.is_null() {
            let code = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return Err(match code {
                // ERROR_ACCESS_DENIED
                5 => PortError::PermissionDenied { pid },
                // ERROR_INVALID_PARAMETER —— 目标进程不存在
                87 => PortError::ProcessNotFound { pid },
                _ => PortError::KillFailed {
                    pid,
                    reason: format!("无法打开进程句柄（Win32 错误码 {code}）"),
                },
            });
        }

        let ok = TerminateProcess(handle, 1);
        // 句柄无论成败都必须关闭，否则会泄漏内核对象
        CloseHandle(handle);

        if ok == 0 {
            let code = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return Err(match code {
                5 => PortError::PermissionDenied { pid },
                _ => PortError::KillFailed {
                    pid,
                    reason: format!("系统拒绝终止该进程（Win32 错误码 {code}）"),
                },
            });
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // 只在测试里用到（构造伪表），放在测试模块内导入，避免非测试构建出现 unused import。
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        MIB_TCP_STATE_ESTAB, MIB_TCP_STATE_LISTEN,
    };

    #[test]
    fn port_of_decodes_network_byte_order() {
        // dwLocalPort 的取值推导（以小端 x86 为例）：
        //   端口 3000 = 0x0BB8，以「网络字节序」存放在 DWORD 的低 16 位，
        //   于是 DWORD 的数值是 0x0000_B80B，内存里是 [0B, B8, 00, 00]。
        //   取低 16 位得 0xB80B，from_be 交换字节后还原为 0x0BB8 = 3000。
        assert_eq!(port_of(0x0000_B80B), 3000);

        // 80 = 0x0050 -> DWORD 0x0000_5000
        assert_eq!(port_of(0x0000_5000), 80);

        // 65535 = 0xFFFF -> DWORD 0x0000_FFFF（字节对称，交换后不变）
        assert_eq!(port_of(0x0000_FFFF), 65535);

        // 1 = 0x0001 -> DWORD 0x0000_0100
        assert_eq!(port_of(0x0000_0100), 1);

        // 高 16 位是保留位，必须被忽略
        assert_eq!(port_of(0xFFFF_B80B), 3000);
    }

    #[test]
    fn provider_reports_windows() {
        assert_eq!(WindowsProcessProvider::new().platform(), "windows");
    }

    #[test]
    fn short_buffer_is_ignored_not_panicking() {
        assert!(tcp_v4_rows(&[]).is_empty());
        assert!(tcp_v6_rows(&[0u8; 4]).is_empty());
        assert!(udp_v4_rows(&[0u8; 4]).is_empty());
        assert!(udp_v6_rows(&[0u8; 4]).is_empty());
    }

    /// 伪造「声称有很多行、实际只有表头」的缓冲区：必须被拒绝而不是越界读。
    #[test]
    fn row_count_beyond_the_buffer_is_rejected() {
        let mut buffer = vec![0u8; HEADER_LEN];
        buffer[0..4].copy_from_slice(&100u32.to_le_bytes()); // dwNumEntries = 100

        assert!(tcp_v4_rows(&buffer).is_empty());
        assert!(tcp_v6_rows(&buffer).is_empty());
        assert!(udp_v4_rows(&buffer).is_empty());
        assert!(udp_v6_rows(&buffer).is_empty());
    }

    /// 走一遍完整的解析路径：表头 → 行 → 状态 → 端口字节序还原 → 地址还原。
    /// 缓冲区手工按 Win32 的内存布局构造，字节序写错这里就会失败。
    #[test]
    fn reads_a_well_formed_tcp_table() {
        let buffer = tcp_v4_buffer(MIB_TCP_STATE_LISTEN, 3000, 4242, 0x0100_007F); // 127.0.0.1

        let rows = tcp_v4_rows(&buffer);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].port, 3000);
        assert_eq!(rows[0].pid, 4242);
        assert_eq!(rows[0].address, "127.0.0.1");
        assert_eq!(rows[0].state, Some(super::state::LISTEN));
    }

    /// 非 LISTEN 的连接（例如 ESTABLISHED）要保留下来并带上正确的状态 ——
    /// 「端口列表」视图需要看到它们，「单端口查询」则自行过滤。
    #[test]
    fn established_connections_keep_their_state() {
        let buffer = tcp_v4_buffer(MIB_TCP_STATE_ESTAB, 3000, 4242, 0);

        let rows = tcp_v4_rows(&buffer);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state, Some(super::state::ESTABLISHED));
    }

    /// 通配地址必须显示成 0.0.0.0，而不是被当成「空」丢掉 ——
    /// 它恰恰是「这个端口对外可访问」的关键信息。
    #[test]
    fn wildcard_address_is_preserved() {
        let buffer = tcp_v4_buffer(MIB_TCP_STATE_LISTEN, 8080, 1, 0);
        assert_eq!(tcp_v4_rows(&buffer)[0].address, "0.0.0.0");
    }

    /// UDP 没有 TCP 状态，`state` 必须是 None 而不是硬塞一个假状态。
    #[test]
    fn udp_rows_have_no_state() {
        const ROW: usize = size_of::<MIB_UDPROW_OWNER_PID>();
        let mut buffer = vec![0u8; HEADER_LEN + ROW];

        buffer[0..4].copy_from_slice(&1u32.to_le_bytes());
        let row = &mut buffer[HEADER_LEN..];
        // dwLocalPort（行内偏移 4，占 4 字节）：端口在低 16 位，大端存放
        row[4..6].copy_from_slice(&5353u16.to_be_bytes());
        row[8..12].copy_from_slice(&99u32.to_le_bytes()); // dwOwningPid（行内偏移 8）

        let rows = udp_v4_rows(&buffer);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].port, 5353);
        assert_eq!(rows[0].pid, 99);
        assert_eq!(rows[0].state, None);
    }

    /// 按 Win32 的内存布局手工构造一张单行 TCP 表
    fn tcp_v4_buffer(state_code: i32, port: u16, pid: u32, address: u32) -> Vec<u8> {
        const ROW: usize = size_of::<MIB_TCPROW_OWNER_PID>();
        let mut buffer = vec![0u8; HEADER_LEN + ROW];

        buffer[0..4].copy_from_slice(&1u32.to_le_bytes()); // dwNumEntries = 1
        let row = &mut buffer[HEADER_LEN..];
        // dwState（行内偏移 0）
        row[0..4].copy_from_slice(&(state_code as u32).to_le_bytes());
        // dwLocalAddr（行内偏移 4）：同样是网络字节序
        row[4..8].copy_from_slice(&address.to_le_bytes());
        // dwLocalPort（行内偏移 8，占 4 字节）：端口以大端存放在**低 16 位**，
        // 也就是前两个字节；高 16 位是保留位，保持 0。
        row[8..10].copy_from_slice(&port.to_be_bytes());
        // dwOwningPid（行内偏移 20）
        row[20..24].copy_from_slice(&pid.to_le_bytes());

        buffer
    }
}
