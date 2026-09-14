//! Tauri 命令层的集成测试。
//!
//! 为什么单独测这一层：`commands` 是前端唯一能触达原生能力的边界，
//! 它自己也有逻辑（参数校验、`spawn_blocking` 调度、错误转换），
//! 而且这些逻辑出错的后果很直接 —— 校验漏了就是安全问题，
//! 调度错了就是界面卡死。原生能力本身由 `port_lookup.rs` 覆盖。
//!
//! 全部使用真实系统资源，没有任何 mock。

use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use port_killer_lib::commands;
use port_killer_lib::PortError;
use tauri::async_runtime::block_on;

/// 子进程角色标记（与 `port_lookup.rs` 分开命名，避免并行执行时互相干扰）
const CHILD_PORT_ENV: &str = "PORT_KILLER_CMD_CHILD_PORT";

const WAIT_STEP: Duration = Duration::from_millis(100);
const WAIT_TIMEOUT: Duration = Duration::from_secs(10);

/* ------------------------------------------------------------------
1. 参数校验：必须在进入原生调用之前就被拒绝
------------------------------------------------------------------ */

#[test]
fn check_port_rejects_out_of_range_ports() {
    for bad in [0i64, -1, 65536, 100_000, i64::MIN, i64::MAX] {
        let result = block_on(commands::check_port(bad));
        assert!(
            matches!(result, Err(PortError::InvalidPort { port }) if port == bad),
            "端口 {bad} 应当在命令层被拒绝，实际 {result:?}"
        );
    }
}

#[test]
fn kill_process_rejects_non_positive_pids() {
    for bad in [0i64, -1, i64::MIN] {
        let result = block_on(commands::kill_process(bad, false));
        assert!(
            matches!(result, Err(PortError::ProcessNotFound { .. })),
            "PID {bad} 应当在命令层被拒绝，实际 {result:?}"
        );
    }
}

/* ------------------------------------------------------------------
2. 正常路径：异步外壳没有把返回值搞丢
------------------------------------------------------------------ */

#[test]
fn platform_info_reports_a_known_platform() {
    let info = commands::platform_info();
    assert!(
        ["windows", "macos", "linux", "unsupported"].contains(&info.as_str()),
        "平台标识应当在已知集合内，实际 {info:?}"
    );
    #[cfg(windows)]
    assert_eq!(info, "windows");
    #[cfg(target_os = "macos")]
    assert_eq!(info, "macos");
    #[cfg(target_os = "linux")]
    assert_eq!(info, "linux");
}

#[test]
fn check_port_reports_a_free_port_as_available() {
    let port = free_port();
    let info = block_on(commands::check_port(i64::from(port))).expect("查询端口失败");

    assert_eq!(info.port, port);
    assert!(
        !info.processes.iter().any(|p| p.pid == std::process::id()),
        "刚释放的端口不应再出现本进程"
    );
}

#[test]
fn killing_a_nonexistent_pid_is_reported_as_process_not_found() {
    // 这个 PID 不可能被分配（Windows / Linux 的 PID 上限远低于此）
    let bogus = (u32::MAX - 16) as i64;
    let result = block_on(commands::kill_process(bogus, false));

    assert!(
        matches!(result, Err(PortError::ProcessNotFound { .. })),
        "不存在的 PID 应当报 PROCESS_NOT_FOUND，实际 {result:?}"
    );
}

/* ------------------------------------------------------------------
3. 验收主链路：输入端口 → 看到进程 → 一键终结 → 端口释放
------------------------------------------------------------------
这条路径就是需求文档里的验收标准，这里让它完整地走一遍命令层 ——
前端点一次按钮，实际发生的就是这一串调用。
------------------------------------------------------------------ */

#[test]
fn acceptance_flow_through_the_command_layer() {
    // --- 子进程角色：绑定端口并一直挂着，直到被父进程终结 ---
    if let Ok(port_str) = std::env::var(CHILD_PORT_ENV) {
        let port: u16 = port_str.parse().expect("子进程端口号非法");
        let _listener = TcpListener::bind(("127.0.0.1", port)).expect("子进程绑定端口失败");
        std::thread::sleep(Duration::from_secs(120));
        return;
    }

    // --- 父进程角色 ---
    let port = free_port();
    let child = spawn_port_holder(port);
    let child_pid = child.id();

    // 步骤 1：输入端口 → 查到占用它的进程
    let occupied = wait_until(|| {
        block_on(commands::check_port(i64::from(port)))
            .map(|info| info.processes.iter().any(|p| p.pid == child_pid))
            .unwrap_or(false)
    });
    assert!(
        occupied,
        "子进程 {child_pid} 应当出现在端口 {port} 的占用列表中"
    );

    // 查到的进程信息必须足够展示给用户（PID / 端口 / 名字 / 协议）
    let info = block_on(commands::check_port(i64::from(port))).expect("查询端口失败");
    let target = info
        .processes
        .iter()
        .find(|p| p.pid == child_pid)
        .expect("占用列表里应当有子进程");
    assert_eq!(target.port, port, "进程卡片上的端口应当与查询端口一致");
    assert!(!target.process_name.is_empty(), "进程名不应为空");
    assert!(target.protocol.is_some(), "应当标注协议类型");

    // 步骤 2：一键终结（这里走的是普通终结，不是强制）
    block_on(commands::kill_process(i64::from(child_pid), false)).expect("终结进程失败");

    // 步骤 3：重新检查 → 端口已释放
    let released = wait_until(|| {
        block_on(commands::check_port(i64::from(port)))
            .map(|info| !info.processes.iter().any(|p| p.pid == child_pid))
            .unwrap_or(false)
    });

    let mut child = child;
    let _ = child.wait();

    assert!(released, "终结后端口 {port} 应当被释放");
}

/* ------------------------------------------------------------------
4. 端口列表：本机真实监听必须能被列出来
------------------------------------------------------------------ */

#[test]
fn list_ports_returns_the_real_listener() {
    // 真起一个监听，再确认它出现在全量列表里 —— 不做任何 mock
    let listener = TcpListener::bind("127.0.0.1:0").expect("无法绑定测试端口");
    let port = listener.local_addr().expect("无法读取本地地址").port();
    let self_pid = std::process::id();

    let found = wait_until(|| {
        block_on(commands::list_ports())
            .map(|rows| rows.iter().any(|r| r.port == port && r.pid == self_pid))
            .unwrap_or(false)
    });

    assert!(found, "本进程监听的端口 {port} 应当出现在端口列表里");

    let rows = block_on(commands::list_ports()).expect("列出端口失败");
    let row = rows
        .iter()
        .find(|r| r.port == port && r.pid == self_pid)
        .expect("列表里应当有这条记录");

    assert_eq!(row.port, port);
    assert_eq!(row.pid, self_pid);
    assert!(!row.process_name.is_empty(), "进程名不应为空");
    assert!(row.protocol.is_some(), "应当标注协议类型");
    assert!(row.local_address.is_some(), "应当给出本地绑定地址");
    // 监听中的 socket 必须带 LISTEN 状态，前端靠它做「只看监听」过滤
    assert_eq!(
        row.state.as_deref(),
        Some("LISTEN"),
        "监听中的端口状态应当是 LISTEN"
    );
}

#[test]
fn list_ports_is_sorted_and_free_of_duplicates() {
    let rows = block_on(commands::list_ports()).expect("列出端口失败");

    // 同一「端口 + PID」只应出现一次（聚合的保证）
    let mut keys: Vec<(u16, u32)> = rows.iter().map(|r| (r.port, r.pid)).collect();
    let before = keys.len();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(before, keys.len(), "端口 + PID 不应重复");

    // 输出必须稳定排序，否则界面每次刷新都会跳
    let actual: Vec<(u16, u32)> = rows.iter().map(|r| (r.port, r.pid)).collect();
    assert!(actual.is_sorted(), "端口列表应当按 端口 → PID 升序");
}

#[test]
fn list_ports_never_fails_and_every_row_is_displayable() {
    // 端口列表允许为空（极简环境），但绝不能 panic 或返回 Err
    let rows = block_on(commands::list_ports()).expect("列出端口不应失败");

    for row in &rows {
        // 每一行都要能展示：进程名不能是空串，否则界面会出现空白行
        assert!(
            !row.process_name.is_empty(),
            "端口 {} 的进程名不应为空",
            row.port
        );
        // PID 0 是合法的 —— 那是「无主连接」（TIME_WAIT 残留 / 内核持有的
        // socket），没有进程可以终结。前端据此标注为「无主」并默认隐藏，
        // 而不是给一个点了没反应的终结按钮。
        if row.pid == 0 {
            let is_tcp = row
                .protocol
                .as_deref()
                .is_some_and(|p| p.starts_with("tcp"));
            if is_tcp {
                assert!(
                    row.state.is_some(),
                    "无主 TCP 连接应当带状态，便于用户判断是不是 TIME_WAIT 残留"
                );
            }
        }
    }
}

/* ------------------------------------------------------------------
辅助
------------------------------------------------------------------ */

/// 挑一个当前空闲的端口。
///
/// 注意这里必然存在「释放后又被抢占」的微小窗口，因此断言都写成
/// 「本进程 / 目标进程不在结果里」，而不是「结果一定为空」。
fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("无法挑选空闲端口");
    listener.local_addr().expect("无法读取本地地址").port()
}

/// 以「端口占用者」的身份重新启动本测试二进制。
fn spawn_port_holder(port: u16) -> Child {
    let exe = std::env::current_exe().expect("无法定位测试二进制");
    Command::new(exe)
        .args([
            "acceptance_flow_through_the_command_layer",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_PORT_ENV, port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("无法启动占用端口的子进程")
}

/// 轮询等待某个条件成立
fn wait_until(mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + WAIT_TIMEOUT;
    while Instant::now() < deadline {
        if predicate() {
            return true;
        }
        std::thread::sleep(WAIT_STEP);
    }
    false
}
