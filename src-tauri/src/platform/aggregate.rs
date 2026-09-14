//! 原始 socket 记录 → `PortProcess` 列表的公共管线。
//!
//! 三个平台拿到的原始数据形状不同（Win32 表 / `/proc/net` 文本 / `lsof` 字段），
//! 但「怎么聚合、怎么补进程信息、怎么排序」是完全一样的。
//! 放在这里而不是各平台各写一份，避免三份实现慢慢跑偏。
//!
//! **不带 `#[cfg(target_os)]`** —— 纯逻辑，测试在任何平台都能跑。

use std::collections::HashMap;

use super::state::{self, TcpState};
use crate::process::{inspect, PortProcess};

/// 平台层产出的一条原始 socket 记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawSocket {
    pub pid: u32,
    pub port: u16,
    /// tcp / tcp6 / udp / udp6
    pub protocol: String,
    /// 本地绑定地址，已还原成可读形式
    pub address: String,
    /// TCP 状态；UDP 或平台未提供时为 `None`
    pub state: Option<TcpState>,
    /// 平台自带的进程名提示（目前只有 macOS 的 lsof 会给）。
    /// 仅作为 sysinfo 拿不到进程名时的兜底。
    pub name_hint: Option<String>,
}

impl RawSocket {
    pub fn new(pid: u32, port: u16, protocol: &str, address: impl Into<String>) -> Self {
        Self {
            pid,
            port,
            protocol: protocol.to_string(),
            address: address.into(),
            state: None,
            name_hint: None,
        }
    }

    pub fn with_state(mut self, state: Option<TcpState>) -> Self {
        self.state = state;
        self
    }

    pub fn with_name_hint(mut self, name: Option<String>) -> Self {
        self.name_hint = name.filter(|n| !n.trim().is_empty());
        self
    }
}

/// 聚合后的一行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aggregated {
    pub pid: u32,
    pub port: u16,
    /// 同一进程可能同时监听 IPv4 与 IPv6，合并成 `tcp+tcp6`
    pub protocol: String,
    pub address: String,
    pub state: Option<TcpState>,
    /// 这条记录背后有多少条 socket（1 个 LISTEN 加若干 ESTABLISHED）
    pub connections: u32,
    /// 平台给的进程名提示，作为 sysinfo 拿不到时的兜底
    pub name_hint: Option<String>,
}

/// 按「端口 + PID」聚合。
///
/// 同一端口上会同时存在 1 条 LISTEN 和若干条 ESTABLISHED，
/// 不聚合的话列表会被同一进程的连接刷屏。
/// 代表状态取 `state::rank()` 最靠前的那条 —— LISTEN 才是
/// 「谁占着这个端口」的答案，不该被某条 ESTABLISHED 覆盖掉。
pub fn aggregate(entries: Vec<RawSocket>) -> Vec<Aggregated> {
    let mut map: HashMap<(u16, u32), Aggregated> = HashMap::with_capacity(entries.len());

    for entry in entries {
        match map.get_mut(&(entry.port, entry.pid)) {
            Some(existing) => {
                existing.connections += 1;
                if !existing.protocol.split('+').any(|p| p == entry.protocol) {
                    existing.protocol = format!("{}+{}", existing.protocol, entry.protocol);
                }
                if state::rank(entry.state) < state::rank(existing.state) {
                    existing.state = entry.state;
                    existing.address = entry.address;
                }
                if existing.name_hint.is_none() {
                    existing.name_hint = entry.name_hint;
                }
            }
            None => {
                map.insert(
                    (entry.port, entry.pid),
                    Aggregated {
                        pid: entry.pid,
                        port: entry.port,
                        protocol: entry.protocol,
                        address: entry.address,
                        state: entry.state,
                        connections: 1,
                        name_hint: entry.name_hint,
                    },
                );
            }
        }
    }

    map.into_values().collect()
}

/// 聚合 + 补充进程信息，产出最终结果。
pub fn build_processes(entries: Vec<RawSocket>) -> Vec<PortProcess> {
    let aggregated = aggregate(entries);

    // 同一个进程可能占着多个端口，先去重再查，避免重复的富化开销
    let mut pids: Vec<u32> = aggregated.iter().map(|e| e.pid).collect();
    pids.sort_unstable();
    pids.dedup();
    let metas = inspect::lookup_many(&pids);

    let mut result: Vec<PortProcess> = aggregated
        .into_iter()
        .map(|entry| {
            let meta = metas.get(&entry.pid).cloned().unwrap_or_default();
            // 进程名优先级：sysinfo → 平台提示（macOS 的 lsof 命令名）→ PID 兜底
            let process_name = meta
                .name
                .or(entry.name_hint)
                .unwrap_or_else(|| format!("PID {}", entry.pid));

            PortProcess::new(entry.pid, process_name, entry.port)
                .with_protocol(entry.protocol)
                .with_local_address(Some(entry.address))
                .with_state(entry.state.map(str::to_string))
                .with_command(meta.command)
                .with_executable_path(meta.exe)
                .with_user(meta.user)
        })
        .collect();

    // 稳定输出：端口升序，同端口按 PID 升序，保证多次查询顺序一致
    result.sort_by_key(|p| (p.port, p.pid));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sock(pid: u32, port: u16, protocol: &str) -> RawSocket {
        RawSocket::new(pid, port, protocol, "0.0.0.0")
    }

    #[test]
    fn same_port_and_pid_collapse_into_one_row() {
        let result = aggregate(vec![
            sock(10, 3000, "tcp").with_state(Some(state::ESTABLISHED)),
            sock(10, 3000, "tcp").with_state(Some(state::ESTABLISHED)),
            sock(10, 3000, "tcp").with_state(Some(state::LISTEN)),
        ]);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].connections, 3);
        // LISTEN 必须胜出，它才是「谁占着这个端口」的答案
        assert_eq!(result[0].state, Some(state::LISTEN));
    }

    #[test]
    fn listen_wins_regardless_of_input_order() {
        let listen_first = aggregate(vec![
            sock(1, 80, "tcp").with_state(Some(state::LISTEN)),
            sock(1, 80, "tcp").with_state(Some(state::TIME_WAIT)),
        ]);
        let listen_last = aggregate(vec![
            sock(1, 80, "tcp").with_state(Some(state::TIME_WAIT)),
            sock(1, 80, "tcp").with_state(Some(state::LISTEN)),
        ]);
        assert_eq!(listen_first, listen_last);
        assert_eq!(listen_first[0].state, Some(state::LISTEN));
    }

    #[test]
    fn ipv4_and_ipv6_listeners_merge_their_protocols() {
        let result = aggregate(vec![sock(10, 3000, "tcp"), sock(10, 3000, "tcp6")]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].protocol, "tcp+tcp6");
    }

    #[test]
    fn protocol_labels_are_not_duplicated() {
        let result = aggregate(vec![sock(10, 3000, "tcp"), sock(10, 3000, "tcp")]);
        assert_eq!(result[0].protocol, "tcp");
    }

    #[test]
    fn same_pid_on_different_ports_stays_separate() {
        let result = aggregate(vec![sock(10, 3000, "tcp"), sock(10, 8080, "tcp")]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn same_port_different_pids_stays_separate() {
        // 两个进程可以同时监听不同地址上的同一端口（SO_REUSEPORT / 不同网卡）
        let result = aggregate(vec![sock(10, 3000, "tcp"), sock(20, 3000, "tcp")]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn representative_address_follows_the_representative_state() {
        let listen = RawSocket::new(10, 3000, "tcp", "0.0.0.0").with_state(Some(state::LISTEN));
        let estab =
            RawSocket::new(10, 3000, "tcp", "192.168.1.5").with_state(Some(state::ESTABLISHED));

        let result = aggregate(vec![estab, listen]);
        // 代表是 LISTEN，地址就应当取 LISTEN 那条的
        assert_eq!(result[0].address, "0.0.0.0");
    }

    #[test]
    fn output_is_sorted_by_port_then_pid() {
        let result = build_processes(vec![
            sock(30, 8080, "tcp"),
            sock(20, 3000, "tcp"),
            sock(10, 3000, "tcp"),
        ]);
        let keys: Vec<(u16, u32)> = result.iter().map(|p| (p.port, p.pid)).collect();
        assert_eq!(keys, vec![(3000, 10), (3000, 20), (8080, 30)]);
    }

    #[test]
    fn udp_rows_keep_a_missing_state() {
        // UDP 没有 TCP 状态，聚合后也不该凭空长出一个
        let result = aggregate(vec![sock(10, 5353, "udp")]);
        assert_eq!(result[0].state, None);
    }

    #[test]
    fn name_hint_is_kept_and_blank_ones_are_dropped() {
        let hinted = aggregate(vec![
            sock(10, 3000, "tcp").with_name_hint(Some("node".into()))
        ]);
        assert_eq!(hinted[0].name_hint.as_deref(), Some("node"));

        let blank = aggregate(vec![sock(10, 3000, "tcp").with_name_hint(Some("  ".into()))]);
        assert_eq!(blank[0].name_hint, None);
    }

    #[test]
    fn name_hint_survives_aggregation() {
        // 只有一条带提示时，聚合结果仍要保留它，否则 macOS 上会退化成 "PID x"
        let result = aggregate(vec![
            sock(10, 3000, "tcp"),
            sock(10, 3000, "tcp").with_name_hint(Some("node".into())),
        ]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name_hint.as_deref(), Some("node"));
    }
}
