# 贡献指南

[**English**](./CONTRIBUTING.md) · **简体中文**

感谢愿意花时间改进 Port Killer。下面是这个项目的一些约定，先读一遍能省下不少来回。

## 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22 | 前端构建 |
| Rust | ≥ 1.77 | 原生层；项目 MSRV 以此为准 |
| 系统依赖 | — | 见 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/) |

Linux 额外需要：

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev libgtk-3-dev libxdo-dev libssl-dev patchelf
```

## 开发

```bash
npm ci
npm run tauri:dev        # 启动桌面应用（热更新）
npm run dev              # 只跑前端（浏览器里调 UI，原生功能会报错）
```

## 提交前必须跑通

CI 会执行同一套检查，本地先跑一遍能省一轮往返：

```bash
npm run typecheck                        # tsc --noEmit，0 error
npm run lint                             # eslint，0 error / 0 warning
npm run format:check                     # prettier 格式检查
npx vite build                           # 前端生产构建

cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run tauri:build` 用于产出安装包，需要能访问 `github.com`（Tauri 会下载打包工具链）。
网络受限时用 `npm run tauri:build -- --no-bundle` 只出可执行文件。

### 中国大陆网络

仓库内**不放**镜像源配置 —— 镜像属于机器 / 网络环境相关的设置，
写进仓库会把所有贡献者都指向第三方源。如果你在国内，请配在**用户级**配置里：

`~/.cargo/config.toml`：

```toml
[source.crates-io]
replace-with = "rsproxy"

[source.rsproxy]
registry = "sparse+https://rsproxy.cn/index/"
```

npm：

```bash
npm config set registry https://registry.npmmirror.com
```

另外，如果 `tauri build` 卡在下载 NSIS 打包工具链（`github.com` 不可达），
可以用 `scripts/build-installer.sh` 从其它可达源拉取并校验哈希后放到 `.cache/`，
详见该脚本头部注释。

## 项目约定（重要）

这些不是风格偏好，是踩过坑之后定下来的硬约束。改代码前请先理解为什么。

### 1. 前端不碰系统调用

所有端口查询与进程终结都必须走 `src/services/portService.ts` 的 IPC，
由 Rust 原生层实现。前端不允许出现任何形式的系统命令调用。

### 2. 不拼接命令行字符串

全项目禁止把用户输入拼进命令行。

- Windows：直接调 Win32 IP Helper API（`GetExtendedTcpTable`）+ `OpenProcess` / `TerminateProcess`
- Linux：读 `/proc`，不产生子进程
- macOS：`Command::args` 直接 execve `lsof`，**不经过 shell**

新增平台时请沿用同样的原则。

### 3. 数据契约以 Rust 侧为准

Rust 结构体统一 `#[serde(rename_all = "camelCase")]`，
可选字段用 `skip_serializing_if = "Option::is_none"`（**不输出 `null`**，
也不用空字符串冒充「未知」）。前端 `src/types/port.ts` 必须与之一致。

### 4. 端口与 PID 两侧都校验

前端 `parsePortInput` 与 Rust `validate_port` / `validate_pid` 互不信任，
各自独立校验一遍。

### 5. 终结后必须回系统复查

不允许凭终结调用的返回值宣称成功。必须重新查询端口，
只有真的没进程占用了才算释放。

### 6. 强制终结永远不是默认动作

普通终结失败后才出现「强制终结」入口，并且需要独立的二次确认。

### 7. 不留死代码

不留 TODO、不留未使用的导出、不用 mock 冒充真实实现。
新增平台时实现 `ProcessProvider` 并在 `platform/mod.rs` 注册，同时补集成测试。

### 8. 平台相关测试要能被所有平台跑到

Rust 的块注释是**可嵌套**的，`#[cfg(target_os = "linux")]` 门控的模块在别的平台上
连语法错误都不会被发现。纯解析逻辑请抽到不带 `cfg` 的模块里（参考
`src-tauri/src/platform/lsof_parser.rs`），让测试在所有平台都能执行。

## 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 支持按进程名过滤端口列表
fix: 终结失败后不再错误宣称端口已释放
docs: 补充 macOS 未实机验证的说明
refactor: 把 lsof 解析抽到跨平台模块
test: 补 Windows 表解析的越界用例
chore: 升级 tauri 到 2.9
```

## 新增语言

界面文案在 `src/i18n/locales/`。新增语言只需：

1. 复制 `zh-CN.ts` 为新语言文件并翻译
2. 在 `src/i18n/index.ts` 的 `SUPPORTED_LOCALES` 里注册

Rust 侧返回的 `message` 只是兜底文本，界面文案由前端按错误码渲染，
因此新增语言不需要改 Rust。

## 提交 PR

- 一个 PR 只做一件事，便于 review
- 说明**为什么**要改，而不只是改了什么
- 涉及行为变化的，附上验证方式（命令输出、截图）
- 修 bug 请尽量补一个能复现的测试

## 报告问题

请用 Issue 模板，并附上：

- 操作系统与版本
- 应用版本
- 复现步骤
- 期望行为与实际行为

涉及「终结失败」的，请说明是否以管理员 / root 运行 —— 普通权限只能终结自己的进程。
