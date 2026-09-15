# 架构说明

[**English**](./ARCHITECTURE.md) · **简体中文**

本文讲的是端口终结者是怎么搭起来的，以及更有用的部分 —— **为什么**要这么搭。
下面这些约束不是风格偏好，每一条都在规避一类具体的失效模式；
规则与理由一并写出，便于你判断而不是照单全收。

## 分层

```text
┌──────────────────────────────────────────────────────────┐
│  React 前端                                              │
│    components / hooks / i18n                             │
│    ── 完全不碰系统调用 ──                                 │
└───────────────────────────┬──────────────────────────────┘
                            │  Tauri IPC（唯一的通道）
┌───────────────────────────▼──────────────────────────────┐
│  src/services/portService.ts                             │
│    参数在跨过边界之前先校验一遍                            │
└───────────────────────────┬──────────────────────────────┘
┌───────────────────────────▼──────────────────────────────┐
│  src-tauri/src/commands.rs                               │
│    再校验一遍 · spawn_blocking · 错误转换                  │
└───────────────────────────┬──────────────────────────────┘
┌───────────────────────────▼──────────────────────────────┐
│  platform::ProcessProvider  (trait)                      │
│    ├ windows.rs   IP Helper API + TerminateProcess       │
│    ├ linux.rs     /proc 解析 + kill(2)                    │
│    └ macos.rs     lsof（execve）+ kill(2)                 │
│                                                          │
│  process/   数据模型 + 进程信息补全                        │
│  error.rs   结构化错误                                    │
└──────────────────────────────────────────────────────────┘
```

前端不知道操作系统的存在，命令层不知道平台的存在。
新增一个平台 = 实现一个 trait + 在 `platform/mod.rs` 注册，上层一行都不用改。

## 数据契约

以 Rust 侧为准，前端在 `src/types/port.ts` 里镜像一份。

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProcess {
    pub pid: u32,
    pub process_name: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")] pub protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub local_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub user: Option<String>,
}
```

两条要紧的规则：

1. **可选字段直接不参与序列化，而不是输出 `null`。** 前端拿到的是真正的可选属性，
   不必到处判空。
2. **绝不用空字符串表示「未知」。** 那会把「权限不足读不到」和「本来就是空」混为一谈。
   空值在进入模型的入口处就被规范成 `None`。

### 错误

```rust
pub enum PortError {
    InvalidPort, PermissionDenied, ProcessNotFound,
    KillFailed, PlatformUnsupported, Unknown,
}
```

序列化成 `{ "code": "...", "message": "..." }`。前端**只按 `code` 分支**，
从不解析系统错误文本。`message` 是给人看的兜底，只在 `UNKNOWN` 时展示。

六个错误码在前端的 `PortErrorCode` 里逐一对应，每个都配了 i18n key。
**新增一门语言完全不用动 Rust** —— 界面文案由前端按错误码自己决定。

## 为什么不用 shell

这是整个项目最重要的一条设计决策。

想查端口被谁占用，最直观的做法是调外部命令：

```rust
// 千万别这么写。
Command::new("sh").args(["-c", &format!("lsof -i:{port}")])
```

即便 `port` 已经过 `u16` 校验，这依然很糟：它会产生子进程、依赖外部二进制存在且
在 `$PATH` 里、还得解析随语言环境变化的文本输出。而命令注入面距离出现只差一次重构。

端口终结者的做法：

| 平台 | 端口查询 | 终结 |
| --- | --- | --- |
| Windows | `GetExtendedTcpTable` / `GetExtendedUdpTable` —— 原生 FFI，不产生子进程 | `OpenProcess` + `TerminateProcess` |
| Linux | 读 `/proc/net/*`，经 `/proc/<pid>/fd` 把 inode 映射到 PID | `kill(2)` |
| macOS | `Command::new("lsof").args([...])` —— 直接 `execve`，**不经过 shell**，参数全是固定字面量 | `kill(2)` |

macOS 是唯一会执行外部二进制的平台，而且是直接执行、参数全是字面量。
`-iTCP:<port>` 由已经校验过范围的 `u16` 拼成，能出现在那里的只可能是一个十进制数字。

## unsafe 代码

Windows 的 FFI 需要 `unsafe`。那里遵守的规则：

- **绝不把字节缓冲区转成结构体引用。** `Vec<u8>` 的对齐是 1，而 `MIB_*` 结构体要求
  对齐 4。分配器这次恰好给了对齐地址，不代表那个转换合法 —— 那是 UB，Miri 会直接报错。
  所有读取一律走 `read_unaligned`。
- **行数必须与缓冲区长度交叉校验。** 行数是系统给的，缓冲区是我们自己分配的。
  安全软件与 VPN 驱动会挂钩这些 API，不能假设两边永远自洽。校验用
  `checked_add` / `checked_mul`，对不上就放弃，绝不越界读。
- **每条路径都要关句柄。** 无论 `TerminateProcess` 成功与否都要 `CloseHandle`，
  否则会泄漏内核对象。

有几个单元测试专门手工构造畸形表 —— 其中一个在只有表头的缓冲区里声称有 100 行 ——
断言它们被拒绝，而不是被读出去。

## 为什么解析器要放在 `#[cfg(target_os)]` 之外

平台代码里纯逻辑的部分被抽成了**不带平台门控**的模块：

```
platform/state.rs        TCP 状态映射（Windows 数值 / Linux 十六进制 / lsof 名称）
platform/proc_net.rs     /proc/net 行解析与 IPv4/IPv6 地址还原
platform/lsof_parser.rs  lsof 字段输出解析
platform/aggregate.rs    socket 记录 → 聚合后的进程行
```

**为什么重要**：Rust 只编译 `cfg` 允许的部分。`#[cfg(target_os = "macos")]`
模块（以及它内部的 `#[cfg(test)]`）在 Linux / Windows 上**完全不参与编译** ——
那些测试不是「失败」，而是根本没跑。

本项目主力开发与验证平台是 Windows，因此任何只存在于 macOS / Linux 门控内的测试，
在日常开发中都等于没跑过。把纯逻辑抽到无门控模块，同一批测试就会在每个平台执行，
macOS 解析器的回归会立刻让 Windows 构建失败。

出于同样的原因，CI 会在 **Linux 与 Windows 两个平台**上构建并测试：
只用 Windows 无法发现 `platform/linux.rs` 编译不过。

顺带一个值得知道的语言细节：**Rust 的块注释是可嵌套的**。
块注释正文里出现的 `/*` 会再开一层，随后的 `*/` 只关闭内层，
文件剩余部分会被当成注释吞掉。因此注释里的路径示例不要用通配符写法。

## 终结流程

```
用户点「终结进程」
      │
      ▼
确认弹窗（明确列出进程名 + PID + 端口）
      │
      ▼
kill_process(pid, force=false)          ← 普通终结：Unix 发 SIGTERM
      │
      ├── 出错 ──▶ 说明原因；只在「强制真有可能奏效」时提供强制入口
      │            （权限不足 / 进程拒绝终止），「进程已不存在」绝不给
      ▼
重新查询端口                             ← 关键的一步
      │
      ├── 没有进程 ──▶ 「Port N 已释放」
      ├── 仍被占用 ──▶ 「Port N 仍有 M 个进程占用」（如实报告部分成功）
      └── 查询失败 ──▶ 报告的是**查询**失败，而不是终结失败
```

**系统调用返回成功不等于端口被释放了。** 进程可能自己退出了，也可能同一端口上
还有别的进程占着。仅凭返回值宣称成功，会做出一个对你撒谎的工具 ——
那比一个会大声失败的工具糟糕得多。

注意最后一条分支：如果复查本身失败，会被报告成*查询*失败并清空进程列表。
如果报成终结失败，界面就会留着那份陈旧的进程列表，断言「端口仍被占用」——
而这是个支撑不了的结论。

## 强制终结

`force_kill` 是存在的，但界面绝不让你轻易按到：

- 第一个确认弹窗里**没有**这个选项。
- 只有在普通终结真的失败之后才出现。
- 需要独立的第二次确认，并明确说明可能丢失数据。

在 Windows 上 `TerminateProcess` 本身就是强制的，所以「普通」与「强制」的差别
只体现在界面劝阻的力度上。文案如实反映了这一点，而不是假装还有一个更温和的选项。

## 端口列表的聚合

一个端口会产生很多 socket：1 条 `LISTEN` 加任意多条 `ESTABLISHED`。
原样列出来会把界面刷屏。

Rust 在返回之前就按 `(port, pid)` 聚合好了：

- `connections` 记录底层 socket 条数
- **代表状态**取排序最靠前的那个 —— `LISTEN` 胜出，因为它才是「谁占着这个端口」的答案
- 协议合并（同一进程同时监听 v4/v6 时显示 `tcp+tcp6`）
- 代表地址跟随代表状态

默认视图再过滤成只看 `LISTEN`（外加无状态的 UDP），另有开关查看全部连接与无主连接。

**无主连接**（PID 0，通常是 `TIME_WAIT` 残留）会被展示但明确标注，且不给终结按钮。
没有进程可杀，给一个点了没反应的按钮就是撒谎。

过滤在客户端完成：一次扫描把结果拿全，切换视图是瞬时的，
不需要重新发起系统调用（Windows 上要遍历四张表，macOS 上要起 `lsof` 进程）。

## 自绘标题栏

窗口是 `decorations: false`，标题栏用 HTML 自绘。理由按重要性排序：

1. **系统标题栏跟随操作系统外观，不跟随应用主题。** 应用切到浅色而系统是深色时，
   标题栏会保持深色 —— 这种不一致用户一眼就能看出来。
2. **竖向空间。** 系统标题栏（约 32px）加上应用自己的 Header（约 60px）是约 92px，
   占掉 480×620 窗口的 15%，而且两处都在显示应用名。合并成 40px 一行是净赚。
3. 应用级入口（端口列表 / 置顶 / 设置）本来就该放在这里。

接受的代价：失去系统贴边与快照；拖拽与窗口控制改由前端实现。

**边缘缩放依然可用。** tao 为「无边框但可缩放」的窗口实现了 `WM_NCHITTEST`，
所以 `resizable` 与 `minWidth` / `minHeight` 表现如常。

窗口 API 的调用一律经过一层保护，句柄不可用时静默降级而不是抛错。
`getCurrentWindow()` 在拿不到 Tauri 运行时是**同步抛异常**（而不是返回 rejected
promise），因此未加保护的 `useEffect` 调用会把整棵 React 组件树卸载。
缺少某项 capability 应当只让对应的可选功能失效，不能拖垮整个应用。

## 启动：填补首次绘制前的空档

任何基于 WebView 的桌面应用，在「窗口创建」到「首次绘制」之间都有空档：
WebView 要初始化、HTML 要加载、JS 要解析执行。这个空档在本应用里约 300–600ms，
而一个在这段时间里可见的窗口只能显示自己的底色。

采用的缓解手段是 **`index.html` 里的内联占位**：

```html
<div id="root"><div class="pk-launch">端口终结者</div></div>
```

它属于 HTML 本身，在文档解析时就会绘制 —— 远早于 React 挂载。
于是这段时间看上去像一次短暂的启动画面，而不是一个空白窗口。
它自带 `<style>` 与 `prefers-color-scheme` 分支，因此不必等 `styles.css` 就能匹配主题。
由于它位于 `#root` 内部，React 挂载时会清空容器，不需要任何清理代码。

**没有采用「窗口以 `visible: false` 创建、由前端调用 `show()` 显示」的方案。**
该方案理论上能完全消除空档，但它依赖「显示」这一步可靠发生：
一旦 `show()` 未生效，结果是一个永远不出现的窗口 —— 比闪一下严重得多；
而且它让应用的首个可见画面取决于前端能否加载成功。
占位方案没有这类失效模式：窗口从一开始就是可见的，
最坏情况也只是占位多停留一小会儿。

## 验证范围

把「真的跑过」和「只是写完了」分清楚：

| 平台 | 状态 |
| --- | --- |
| **Windows** | 实机端到端验证：原生测试、生产构建、真实启动 |
| **Linux** | 实现完整；CI 里能编译能测试，**尚未在实机运行** |
| **macOS** | 实现完整；解析器在所有平台都有测试，**尚未在实机运行** |

Linux 与 macOS 的 `ProcessProvider` 是照着 `/proc` 与 `lsof` 的文档行为写的，
它们的纯逻辑部分有覆盖所有平台的测试。但「解析器是对的」不等于「在真 Mac 上能用」，
这份文档不会含糊其辞地说它能用。

如果你能在 Linux 或 macOS 上跑一遍，那是目前最有价值的贡献 ——
详见 [CONTRIBUTING.zh-CN.md](../CONTRIBUTING.zh-CN.md)。

## 质量基线

每次改动都要保持以下全部为绿：

```bash
npx tsc --noEmit                              # 0 error
npx eslint .                                  # 0 error / 0 warning
npx prettier --check "src/**/*.{ts,tsx,css}"  # 格式一致
npm run i18n:check                            # 语言 key 与插值变量一致
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings     # 0 warning
cargo test                                    # 75 passed
```

CI 除了前端任务，还会在 **Ubuntu 和 Windows 两个平台**上跑 Rust。
把 Linux 放进去，正是因为 `platform/linux.rs` 在 Windows 上完全不参与编译 ——
只用 Windows 无法发现它编译不过。
