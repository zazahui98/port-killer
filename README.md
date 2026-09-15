<div align="center">

# Port Killer

**English** · [简体中文](./README.zh-CN.md)

**Stop hunting for the process that stole your port.**

Type a port → see what's holding it → kill it → get back to work.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#install)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-1.77%2B-orange.svg)](https://www.rust-lang.org/)
[![Offline](https://img.shields.io/badge/network-none-success.svg)](./SECURITY.md)

<img src="./docs/screenshot-main.png" width="380" alt="Port Killer — port occupied, showing the process holding it">

</div>

---

## Why

`Address already in use.`

Every developer hits this. The usual fix is a chain of commands you have to look up
every time — `netstat` / `lsof` to find the PID, then `taskkill` / `kill` to end it,
then check again to make sure it actually worked. It's 30 seconds of friction,
several times a day.

Port Killer turns that into one input box and one button.

## Features

| | |
| --- | --- |
| **Port lookup** | Enter a port, see the process holding it — name, PID, protocol, bind address, TCP state, and how it was launched |
| **One-click kill** | Confirm the target (name + PID + port are spelled out), kill it, then **re-check the port** before claiming success |
| **Force kill** | Only offered *after* a normal kill fails, and it requires a **separate second confirmation**. Never the default button |
| **Port list** | A full-window drawer listing every port in use. Defaults to **listening sockets only** — that's what "in use" means — with toggles for all connections and ownerless sockets |
| **Always on top** | Keep it above your terminal, since that's where you read the error |
| **Configurable home screen** | Hide the common-ports row if you'd rather have just the input box. Always-on-top lives on the title bar instead of in settings |
| **No startup flash** | The window stays hidden until there's something to show, so you never see an empty frame |
| **Bilingual** | English and 简体中文, follows your system language, switchable in settings |
| **Themes** | System / Dark / Light. The window chrome follows the app theme, not the OS |
| **Keyboard** | <kbd>Enter</kbd> to check · <kbd>Esc</kbd> to dismiss · <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> to focus the input |

<div align="center">
<img src="./docs/screenshot-list.png" width="380" alt="Port Killer — port list drawer">
</div>

### What it is not

Not a system monitor or a task manager. There is no polling, no dashboard, no history.
It does one thing: **free the port you're stuck on.**

## Install

### Prebuilt binaries

Grab the installer for your platform from
[**Releases**](https://github.com/zazahui98/port-killer/releases).

| Platform | Artifact |
| --- | --- |
| Windows | `.exe` (NSIS installer, per-user) |
| macOS | `.dmg` |
| Linux | `.deb` / `.AppImage` |

> No releases published yet? Build from source — it takes a few minutes.

### Build from source

Requires **Node.js ≥ 22** and **Rust ≥ 1.77**, plus the
[Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/zazahui98/port-killer.git
cd port-killer
npm ci
npm run tauri:build
```

Artifacts land in `src-tauri/target/release/bundle/`.

Just want the executable, no installer?

```bash
npm run tauri:build -- --no-bundle
```

## Usage

1. Type a port — say `3000` — and press <kbd>Enter</kbd>.
2. If something is listening, you'll see the process card.
3. Hit **Kill process**, confirm, done.

**Permissions:** running as a normal user only lets you kill **your own** processes.
To kill a process owned by another user or by the system, run Port Killer as
administrator / root. When a kill fails for this reason, the app says so explicitly
and points at the fix — it never fails silently.

## How it works

The port-to-process mapping is done in Rust, and **no shell is ever spawned**:

| Platform | Mechanism |
| --- | --- |
| Windows | `GetExtendedTcpTable` / `GetExtendedUdpTable` (IP Helper API), then `OpenProcess` + `TerminateProcess` |
| Linux | `/proc/net/{tcp,tcp6,udp,udp6}` → socket inode → `/proc/<pid>/fd`, then `kill(2)` |
| macOS | `lsof` executed directly via `execve` (no `sh -c`), then `kill(2)` |

No command strings are built from user input, so there is no injection surface.
See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full design.

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell | **Tauri 2** — small bundles, real Rust backend |
| Frontend | **React 19 + TypeScript** (`strict`, `noUncheckedIndexedAccess`) |
| Build | **Vite 8** (rolldown) |
| Styles | **Tailwind CSS 4** — design tokens in `src/styles.css` |
| Icons | **Lucide** |
| State | React `useReducer` — deliberately no Zustand at this size |
| i18n | **i18next** + **react-i18next** |
| Backend | **Rust** — `sysinfo`, `windows-sys`, `libc` |

Runtime dependencies are kept deliberately small: 4 direct Rust crates,
6 frontend packages.

## Project structure

```text
port-killer/
├── src/                        React frontend
│   ├── components/             TitleBar, PortInput, ProcessCard, PortListDrawer, …
│   ├── hooks/                  state machine, port list, window chrome, theme, i18n
│   ├── i18n/locales/           en.ts · zh-CN.ts
│   ├── services/portService.ts the only IPC channel
│   └── types/port.ts           data contract shared with Rust
├── src-tauri/                  Rust backend
│   ├── src/commands.rs         Tauri command boundary
│   ├── src/platform/           ProcessProvider per OS
│   │   ├── windows.rs          IP Helper API + TerminateProcess
│   │   ├── linux.rs            /proc parsing
│   │   ├── macos.rs            lsof (direct execve)
│   │   ├── state.rs            TCP state mapping  ─┐ platform-independent,
│   │   ├── proc_net.rs         /proc/net parsing    │ tested on every platform
│   │   ├── lsof_parser.rs      lsof field parsing   │
│   │   └── aggregate.rs        socket → process    ─┘
│   └── tests/                  real listeners, real kills, real re-checks
├── docs/                       architecture, screenshots
├── scripts/                    i18n key check, icon generation, offline installer helper
└── .github/                    CI + release workflows, issue templates
```

## Development

```bash
npm ci
npm run tauri:dev          # desktop app with hot reload
npm run dev                # frontend only, in a browser (native features will error)
```

Before opening a PR, run what CI runs:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run i18n:check
npx vite build

cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the project's hard rules and why they exist.

### Behind a restrictive network?

GitHub is unreachable from some networks, which breaks `tauri build` (it downloads
the bundler toolchain from GitHub Releases). Use:

```bash
bash scripts/build-installer.sh
```

It fetches the same toolchain from an alternate official source and verifies the
SHA-1 before placing it in the bundler cache. Details are in the script header and
in CONTRIBUTING.md.

## Testing

**75 Rust tests**, all green, and the interesting ones use **real system resources —
no mocks**:

| Suite | Count | What it covers |
| --- | --- | --- |
| Unit (`src/`) | 59 | port/PID validation, error serialization, byte-order decoding, buffer-overrun defence, TCP state mapping, `/proc` and `lsof` parsing, aggregation |
| Command layer | 9 | the exact path the frontend calls — validation, `spawn_blocking`, error mapping, plus the **acceptance flow** |
| Native integration | 7 | real listener → real lookup → real kill → real re-check |

The acceptance flow test spawns a child process holding a port, finds it, kills it,
and then **re-queries the port** to confirm it's actually free.

The parsers that are pure logic (`state.rs`, `proc_net.rs`, `lsof_parser.rs`,
`aggregate.rs`) are deliberately **not** behind `#[cfg(target_os)]`. A `cfg`-gated
module isn't compiled on other platforms, so its tests never run there; keeping this
code ungated means one test suite covers every platform.

## Security

Port Killer's whole job is terminating processes, so that's the threat model.

- Runs fully offline — no telemetry, no accounts, no network calls
- No shell is ever spawned; no command string is built from user input
- Ports and PIDs are validated on **both** sides of the IPC boundary
- Strict CSP with `freezePrototype`; capabilities limited to the window features
  the custom title bar actually needs
- Killing is re-verified against the OS; success is never assumed

Found something? Please read [SECURITY.md](./SECURITY.md) — **do not open a public
issue for vulnerabilities.**

## Contributing

Issues and PRs are welcome. Please read
[CONTRIBUTING.md](./CONTRIBUTING.md) first — it documents the non-obvious
constraints (no shell, no command strings, re-check after kill, force-kill is never
the default) so you don't have to rediscover them the hard way.

## License

[MIT](./LICENSE)
