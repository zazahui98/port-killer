//! `lsof -F` 字段输出的解析。
//!
//! macOS 没有 `/proc`，端口 → 进程的映射依赖系统自带的 `lsof`。
//! 用 `-F`（field output）而不是默认表格输出，避免解析本地化 / 对齐后的文本。
//!
//! **本模块刻意不带 `#[cfg(target_os = "macos")]`。**
//! 它是纯字符串处理，放在门控模块里会导致测试只在 macOS 上被编译 ——
//! 而本项目的主力验证平台是 Windows，等于这些测试从来没跑过。
//! （这个坑真实发生过：解析器里一个「重复产出 PID」的 bug 就是这样漏掉的。）
//!
//! 字段输出是**分层**的：`p` 开启一个进程块，`c` 给出命令名，
//! 随后每个 `f` 开启一个文件块，`n` / `P` / `T` 描述这个文件。
//!
//! ```text
//! p1234            <- 进程块开始
//! cnode
//! f42              <- 文件块开始
//! PTCP
//! n*:3000          <- 端点
//! TST=LISTEN       <- TCP 状态（在 n 之后）
//! ```

use super::state::{self, TcpState};

/// lsof 输出里的一条网络文件记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LsofEntry {
    pub pid: u32,
    /// `c` 字段：命令名（如 node、java）
    pub command: String,
    /// `n` 字段：端点，如 `*:3000` / `127.0.0.1:8080` / `[::1]:3000`，
    /// 或带对端的 `127.0.0.1:5000->127.0.0.1:60000`
    pub name: String,
    /// `P` 字段：协议（TCP / UDP）
    pub protocol: String,
    /// `T` 字段里的 `TST=`：TCP 状态
    pub state: Option<TcpState>,
}

/// 解析 `lsof -FpcPnT` 的输出。
///
/// 只有同时具备 PID 与端点的记录才会被产出 —— 没有 `n` 的块
/// （例如其它类型的 fd）对端口查询没有意义。
pub fn parse_lsof_fields(stdout: &str) -> Vec<LsofEntry> {
    let mut result: Vec<LsofEntry> = Vec::new();

    let mut current_pid: Option<u32> = None;
    let mut current_command = String::new();
    let mut current_protocol = String::new();
    let mut current_state: Option<TcpState> = None;
    // 当前文件块里刚产出的那条记录的下标。
    // lsof 的顺序是**先 `n` 后 `T`**，所以在读到 `n` 时状态还不知道，
    // 必须等 `T` 到了再回填到这条记录上。
    let mut current_index: Option<usize> = None;

    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }

        // `split_at_checked` 稳定在 Rust 1.80；这里手写空检查 + `split_at`
        // 以免触发 clippy 的 `incompatible_msrv`（项目 MSRV 是 1.77）。
        let (tag, value) = line.split_at(1);

        match tag {
            "p" => {
                current_pid = value.trim().parse::<u32>().ok();
                // 换进程意味着上一个文件块结束
                current_command.clear();
                current_protocol.clear();
                current_state = None;
                current_index = None;
            }
            "c" => current_command = value.to_string(),
            "f" => {
                // 新的文件块：上一个文件的状态不能带到这个文件上
                current_state = None;
                current_index = None;
            }
            "P" => current_protocol = value.to_string(),
            "T" => {
                if let Some(state) = state::from_lsof(value) {
                    current_state = Some(state);
                    // 回填到本文件块已产出的那条记录（lsof 把 T 放在 n 之后）
                    if let Some(i) = current_index {
                        result[i].state = Some(state);
                    }
                }
            }
            "n" => {
                let Some(pid) = current_pid else {
                    continue; // 没有进程上下文的端点无法归属
                };
                result.push(LsofEntry {
                    pid,
                    command: current_command.clone(),
                    name: value.to_string(),
                    protocol: current_protocol.clone(),
                    state: current_state,
                });
                current_index = Some(result.len() - 1);
            }
            _ => {}
        }
    }

    // PID 0 不是有效进程；lsof 偶尔会输出解析失败的块
    result.retain(|e| e.pid > 0);
    result
}

/// 从 lsof 的 `n` 字段解析出「本地地址 + 端口」。
///
/// 支持的形态：
/// - `*:3000` —— 通配地址，lsof 原样保留（不臆造成 `0.0.0.0`，
///   因为同一个 `*` 也可能是 IPv6 的通配）
/// - `127.0.0.1:8080`
/// - `[::1]:3000`
/// - `127.0.0.1:5000->127.0.0.1:60000` —— 只取 `->` 之前的本地端
///
/// 端口非法（非数字 / 超出 u16）时返回 `None`。
pub fn parse_lsof_endpoint(name: &str) -> Option<(String, u16)> {
    let local = name.split("->").next()?;

    // IPv6 用方括号包住地址，端口在最后一个 `:` 之后
    let (address, port) = local.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;

    let address = address
        .strip_prefix('[')
        .and_then(|a| a.strip_suffix(']'))
        .unwrap_or(address);

    Some((address.to_string(), port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_listening_socket() {
        let out = "p1234\ncnode\nf42\nPTCP\nn*:3000\nTST=LISTEN\n";
        let entries = parse_lsof_fields(out);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].pid, 1234);
        assert_eq!(entries[0].command, "node");
        assert_eq!(entries[0].name, "*:3000");
        assert_eq!(entries[0].protocol, "TCP");
        assert_eq!(entries[0].state, Some(state::LISTEN));
    }

    #[test]
    fn tcp_state_applies_to_its_own_file_block() {
        // 同一个进程先有一个 LISTEN，再有若干 ESTABLISHED。
        // 状态必须跟着各自的文件块，不能串。
        let out = "p1234\ncnode\nf42\nPTCP\nn*:3000\nTST=LISTEN\n\
                   f43\nPTCP\nn127.0.0.1:3000->127.0.0.1:55000\nTST=ESTABLISHED\n";
        let entries = parse_lsof_fields(out);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].state, Some(state::LISTEN));
        assert_eq!(entries[1].state, Some(state::ESTABLISHED));
        assert_eq!(entries[1].name, "127.0.0.1:3000->127.0.0.1:55000");
    }

    #[test]
    fn state_before_the_endpoint_is_also_accepted() {
        // lsof 实际顺序是 n 然后 T，但解析器不该依赖这个顺序
        let out = "p1234\ncnode\nf42\nPTCP\nTST=LISTEN\nn*:3000\n";
        let entries = parse_lsof_fields(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].state, Some(state::LISTEN));
    }

    #[test]
    fn state_does_not_leak_into_the_next_file_block() {
        // 上一个文件有状态，下一个文件没给 T 字段 —— 不能沿用
        let out = "p1234\ncnode\nf42\nPTCP\nn*:3000\nTST=LISTEN\nf43\nPUDP\nn*:5353\n";
        let entries = parse_lsof_fields(out);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].state, Some(state::LISTEN));
        assert_eq!(entries[1].state, None);
    }

    #[test]
    fn command_does_not_leak_across_processes() {
        let out = "p1234\ncnode\nf42\nPTCP\nn*:3000\nTST=LISTEN\n\
                   p5678\nf50\nPTCP\nn*:8080\nTST=LISTEN\n";
        let entries = parse_lsof_fields(out);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].command, "node");
        // 第二个进程没有 c 字段，命令名必须是空的而不是沿用上一个进程的
        assert_eq!(entries[1].command, "");
    }

    #[test]
    fn pid_without_endpoint_yields_nothing() {
        // 只有进程信息、没有 n 字段的块对端口查询没有意义
        let out = "p1234\ncnode\nf42\nPTCP\n";
        assert!(parse_lsof_fields(out).is_empty());
    }

    #[test]
    fn multiple_pids_are_all_kept() {
        let out = "p1234\ncnode\nf42\nPTCP\nn*:3000\nTST=LISTEN\n\
                   p5678\ncjava\nf43\nPTCP\nn*:3000\nTST=LISTEN\n";
        let entries = parse_lsof_fields(out);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].pid, 1234);
        assert_eq!(entries[1].pid, 5678);
    }

    #[test]
    fn ignores_unknown_fields_and_garbage() {
        let out = "p1234\ncnode\nZwhatever\nf42\nPTCP\nn*:3000\nTST=LISTEN\n";
        let entries = parse_lsof_fields(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].pid, 1234);
    }

    #[test]
    fn empty_output_yields_nothing() {
        assert!(parse_lsof_fields("").is_empty());
        assert!(parse_lsof_fields("\n\n").is_empty());
    }

    #[test]
    fn pid_zero_is_dropped() {
        let out = "p0\ncnode\nf42\nPTCP\nn*:3000\nTST=LISTEN\n";
        assert!(parse_lsof_fields(out).is_empty());
    }

    #[test]
    fn endpoint_without_process_context_is_dropped() {
        // 先出现 n 再出现 p：这条 n 无法归属，必须丢弃
        let out = "n*:3000\nTST=LISTEN\np1234\ncnode\n";
        assert!(parse_lsof_fields(out).is_empty());
    }

    #[test]
    fn parses_wildcard_and_loopback_endpoints() {
        assert_eq!(parse_lsof_endpoint("*:3000"), Some(("*".to_string(), 3000)));
        assert_eq!(
            parse_lsof_endpoint("127.0.0.1:8080"),
            Some(("127.0.0.1".to_string(), 8080))
        );
    }

    #[test]
    fn parses_bracketed_ipv6_endpoints() {
        assert_eq!(
            parse_lsof_endpoint("[::1]:3000"),
            Some(("::1".to_string(), 3000))
        );
        assert_eq!(
            parse_lsof_endpoint("[fe80::1]:5353"),
            Some(("fe80::1".to_string(), 5353))
        );
    }

    #[test]
    fn only_the_local_side_of_a_connection_is_used() {
        // ESTABLISHED 的 n 字段是 `本地->对端`，端口必须取本地那个
        assert_eq!(
            parse_lsof_endpoint("127.0.0.1:5000->127.0.0.1:60000"),
            Some(("127.0.0.1".to_string(), 5000))
        );
    }

    #[test]
    fn malformed_endpoints_are_rejected() {
        assert_eq!(parse_lsof_endpoint(""), None);
        assert_eq!(parse_lsof_endpoint("127.0.0.1"), None); // 缺端口
        assert_eq!(parse_lsof_endpoint("127.0.0.1:notaport"), None);
        assert_eq!(parse_lsof_endpoint("127.0.0.1:99999"), None); // 超出 u16
    }
}
