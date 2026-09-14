//! 原生层的端到端集成测试 —— 全部使用真实的系统资源，没有任何 mock。
//!
//! 覆盖产品的主链路：
//! ```text
//! 绑定端口 → 查到占用它的进程 → 终结该进程 → 确认端口已释放
//! ```
//!
//! 这些测试会真的启动进程、真的发信号，因此能验证「原生实现是否真的可用」，
//! 而不只是「代码能编译」。

use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use port_killer_lib::platform::provider;
use port_killer_lib::PortError;

/// 子进程角色标记：带上这个环境变量启动测试二进制时，它会变成一个「端口占用者」
const CHILD_PORT_ENV: &str = "PORT_KILLER_CHILD_PORT";

const WAIT_STEP: Duration = Duration::from_millis(100);
const WAIT_TIMEOUT: Duration = Duration::from_secs(10);

/* ------------------------------------------------------------------
1. 端口查询：必须真的找到正在监听的进程
------------------------------------------------------------------ */

#[test]
fn finds_the_process_listening_on_an_ephemeral_port() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("无法绑定临时端口");
    let port = listener.local_addr().expect("无法读取本地地址").port();
    let my_pid = std::process::id();

    let found = provider().find_by_port(port).expect("查询端口失败");

    assert!(
        found.iter().any(|p| p.pid == my_pid),
        "端口 {port} 上应当找到当前测试进程 {my_pid}，实际找到 {:?}",
        found
            .iter()
            .map(|p| (p.pid, p.process_name.clone()))
            .collect::<Vec<_>>()
    );

    // 进程名与命令行应当被填充（否则 UI 上没有可读信息）
    let me = found.iter().find(|p| p.pid == my_pid).unwrap();
    assert!(
        !me.process_name.is_empty(),
        "进程名不应为空（回退值也不该是空串）"
    );
}

#[test]
fn port_is_reported_free_after_the_listener_closes() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("无法绑定临时端口");
    let port = listener.local_addr().expect("无法读取本地地址").port();
    let my_pid = std::process::id();

    assert!(
        provider()
            .find_by_port(port)
            .expect("查询端口失败")
            .iter()
            .any(|p| p.pid == my_pid),
        "监听期间应当找到本进程"
    );

    drop(listener);

    let after = provider().find_by_port(port).expect("释放后查询端口失败");
    assert!(
        !after.iter().any(|p| p.pid == my_pid),
        "监听关闭后不应再找到本进程，实际 {:?}",
        after.iter().map(|p| p.pid).collect::<Vec<_>>()
    );
}

#[test]
fn reports_nothing_for_a_port_that_nobody_listens_on() {
    // 取一个刚释放的端口，并允许极小的抢占概率：
    // 断言的是「本进程不再出现在结果里」，而不是「结果一定为空」。
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").expect("无法绑定临时端口");
        l.local_addr().expect("无法读取本地地址").port()
    };

    let found = provider().find_by_port(port).expect("查询端口失败");
    assert!(
        !found.iter().any(|p| p.pid == std::process::id()),
        "端口 {port} 已释放，不应再找到本进程"
    );
}

/* ------------------------------------------------------------------
2. 进程终结：真的终结一个真实进程
------------------------------------------------------------------ */

#[test]
fn terminates_a_real_process() {
    let mut victim = spawn_idle_process();
    let pid = victim.id();

    provider().kill(pid).expect("终结进程应当成功");

    assert!(
        wait_for_exit(&mut victim, WAIT_TIMEOUT),
        "进程 {pid} 在终结后应当在 {WAIT_TIMEOUT:?} 内退出"
    );
}

#[test]
fn force_terminates_a_real_process() {
    let mut victim = spawn_idle_process();
    let pid = victim.id();

    provider().force_kill(pid).expect("强制终结应当成功");

    assert!(
        wait_for_exit(&mut victim, WAIT_TIMEOUT),
        "进程 {pid} 在强制终结后应当在 {WAIT_TIMEOUT:?} 内退出"
    );
}

#[test]
fn killing_a_nonexistent_pid_is_reported_as_process_not_found() {
    // 这个 PID 不可能被分配（Windows/Linux 的 PID 上限远低于此）
    let bogus = u32::MAX - 16;
    let result = provider().kill(bogus);

    assert!(
        matches!(result, Err(PortError::ProcessNotFound { .. })),
        "不存在的 PID 应当报 PROCESS_NOT_FOUND，实际 {result:?}"
    );
}

/* ------------------------------------------------------------------
3. 主链路：查占用 → 终结 → 确认释放
------------------------------------------------------------------ */

#[test]
fn end_to_end_release_flow() {
    // --- 子进程角色：绑定端口并一直挂着，直到被父进程终结 ---
    if let Ok(port_str) = std::env::var(CHILD_PORT_ENV) {
        let port: u16 = port_str.parse().expect("子进程端口号非法");
        let _listener = TcpListener::bind(("127.0.0.1", port)).expect("子进程绑定端口失败");
        std::thread::sleep(Duration::from_secs(120));
        return;
    }

    // --- 父进程角色 ---
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").expect("无法挑选空闲端口");
        l.local_addr().expect("无法读取本地地址").port()
    };

    let exe = std::env::current_exe().expect("无法定位测试二进制");
    let mut child = Command::new(exe)
        .args([
            "end_to_end_release_flow",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_PORT_ENV, port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("无法启动占用端口的子进程");

    let child_pid = child.id();

    // 等子进程真正绑定上端口
    let occupied = wait_until(|| {
        provider()
            .find_by_port(port)
            .unwrap_or_default()
            .iter()
            .any(|p| p.pid == child_pid)
    });

    assert!(
        occupied,
        "子进程 {child_pid} 应当出现在端口 {port} 的占用列表中"
    );

    // 终结它
    provider().kill(child_pid).expect("终结子进程失败");

    // 确认端口真的释放了（这才是用户看到的结果）
    let released = wait_until(|| {
        !provider()
            .find_by_port(port)
            .unwrap_or_default()
            .iter()
            .any(|p| p.pid == child_pid)
    });

    let _ = child.wait();

    assert!(released, "终结后端口 {port} 应当被释放");
}

/* ------------------------------------------------------------------
辅助
------------------------------------------------------------------ */

/// 启动一个「什么都不做、一直挂着」的真实进程，用于验证终结能力。
///
/// 刻意选择单进程形态（Windows 的 `pause`、Unix 的 `sleep` 都是 shell 内建
/// 或单进程命令），避免终结父进程后残留子进程。
fn spawn_idle_process() -> Child {
    #[cfg(windows)]
    let child = Command::new("cmd")
        .args(["/C", "pause"])
        .stdin(Stdio::piped()) // 保持 stdin 打开，pause 才会一直等下去
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    #[cfg(not(windows))]
    let child = Command::new("sleep")
        .arg("120")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    child.expect("无法启动测试用空闲进程")
}

/// 轮询等待子进程退出
fn wait_for_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => std::thread::sleep(WAIT_STEP),
            Err(_) => return false,
        }
    }
    false
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
