# Contributing

[**English**](./CONTRIBUTING.md) · [简体中文](./CONTRIBUTING.zh-CN.md)

Thanks for taking the time to improve Port Killer. Below are the project's
conventions — read them first, they'll save you a round of review.

## Requirements

| Dependency | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 22 | frontend build |
| Rust | ≥ 1.77 | backend; this is the project MSRV |
| System deps | — | see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |

On Linux you'll also need:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev libgtk-3-dev libxdo-dev libssl-dev patchelf
```

## Development

```bash
npm ci
npm run tauri:dev        # desktop app with hot reload
npm run dev              # frontend only, in a browser (native features will error)
```

## What CI runs

Run these locally before opening a PR — it saves a round trip:

```bash
npm run typecheck                        # tsc --noEmit, 0 errors
npm run lint                             # eslint, 0 errors / 0 warnings
npm run format:check                     # prettier
npm run i18n:check                       # locale keys + placeholders in sync
npx vite build                           # production frontend build

cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run tauri:build` produces installers but needs to reach `github.com` (Tauri
downloads the bundler toolchain from GitHub Releases). On a restricted network use
`npm run tauri:build -- --no-bundle` to get just the executable.

### Restrictive networks

The repository intentionally ships **no** mirror configuration. Mirrors are
machine- and network-specific; committing one would point every contributor at a
third-party source. If you're in mainland China, configure it at the **user** level.

`~/.cargo/config.toml`:

```toml
[source.crates-io]
replace-with = "rsproxy"

[source.rsproxy]
registry = "sparse+https://rsproxy.cn/index/"
```

npm:

```bash
npm config set registry https://registry.npmmirror.com
```

If `tauri build` hangs downloading the NSIS bundler toolchain (`github.com`
unreachable), `scripts/build-installer.sh` fetches the same toolchain from an
alternate official source, verifies the SHA-1, and places it in the bundler cache.
See the script header for details.

## Project rules (important)

These aren't style preferences — they're constraints derived from bugs that actually
happened. Please understand the reasoning before changing code that touches them.

### 1. The frontend never touches the system

All port lookup and process termination goes through `src/services/portService.ts`
over IPC, implemented in Rust. No system calls from frontend code, ever.

### 2. Never build command-line strings

The whole project forbids interpolating user input into a command line.

- **Windows**: call the Win32 IP Helper API directly (`GetExtendedTcpTable`),
  then `OpenProcess` / `TerminateProcess`
- **Linux**: read `/proc` — no subprocess at all
- **macOS**: `Command::args` to `execve` `lsof` directly — **no shell**

Follow the same principle when adding a platform.

### 3. Rust owns the data contract

Rust structs use `#[serde(rename_all = "camelCase")]`, and optional fields use
`skip_serializing_if = "Option::is_none"` — **never emit `null`, and never use an
empty string to mean "unknown"**. `src/types/port.ts` must match exactly.

### 4. Validate ports and PIDs on both sides

The frontend (`parsePortInput`) and Rust (`validate_port` / `validate_pid`) each
validate independently. Neither trusts the other.

### 5. Always re-check the port after killing

A successful syscall is not proof the port was freed. Re-query it, and only report
success once nothing is holding it any more.

### 6. Force kill is never the default action

It only appears after a normal kill has failed, and it requires its own separate
confirmation.

### 7. No dead code

No TODOs, no unused exports, no mocks standing in for real implementations. A new
platform means implementing `ProcessProvider`, registering it in `platform/mod.rs`,
and adding integration tests.

### 8. Platform-specific tests must run on every platform

Rust block comments **nest**, and a `#[cfg(target_os = "linux")]` module isn't even
compiled on other platforms — so a syntax error in it goes unnoticed. Extract pure
parsing logic into modules with **no `cfg` gate** (see
`src-tauri/src/platform/lsof_parser.rs`) so its tests execute everywhere.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: filter the port list by process name
fix: stop reporting a released port as still occupied
docs: note that macOS hasn't been verified on real hardware
refactor: extract lsof parsing into a cross-platform module
test: cover out-of-bounds row counts in the Windows table parser
chore: bump tauri to 2.9
```

## Adding a language

UI copy lives in `src/i18n/locales/`. To add a language:

1. Copy `zh-CN.ts` to a new file and translate it
2. Register it in `SUPPORTED_LOCALES` in `src/i18n/index.ts`

Rust is unaffected — the backend's `message` is only a fallback, and the UI renders
its own wording from the error `code`. `npm run i18n:check` will fail if keys or
placeholders drift apart, so run it before committing.

## Pull requests

- One PR, one thing — it makes review tractable
- Explain **why**, not just what changed
- For behaviour changes, include how you verified it (command output, screenshots)
- Bug fixes should come with a test that reproduces the bug

## Reporting issues

Please use the issue templates and include:

- OS and version
- App version
- Steps to reproduce
- Expected vs actual behaviour

For anything involving a failed kill, mention whether you were running as
administrator / root — a normal user can only kill their own processes.
