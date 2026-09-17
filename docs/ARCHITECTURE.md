# Architecture

[**English**](./ARCHITECTURE.md) · [简体中文](./ARCHITECTURE.zh-CN.md)

This document covers how Port Killer is put together and — more usefully — **why**
it's built this way. The constraints described below are not stylistic preferences;
each one prevents a specific failure mode, and the reasoning is kept alongside the
rule so it can be evaluated rather than taken on faith.

## Layers

```text
┌──────────────────────────────────────────────────────────┐
│  React frontend                                          │
│    components / hooks / i18n                             │
│    ── no system access whatsoever ──                     │
└───────────────────────────┬──────────────────────────────┘
                            │  Tauri IPC (the only channel)
┌───────────────────────────▼──────────────────────────────┐
│  src/services/portService.ts                             │
│    validates arguments before they cross the boundary    │
└───────────────────────────┬──────────────────────────────┘
┌───────────────────────────▼──────────────────────────────┐
│  src-tauri/src/commands.rs                               │
│    validates again · spawn_blocking · maps errors        │
└───────────────────────────┬──────────────────────────────┘
┌───────────────────────────▼──────────────────────────────┐
│  platform::ProcessProvider  (trait)                      │
│    ├ windows.rs   IP Helper API + TerminateProcess       │
│    ├ linux.rs     /proc parsing + kill(2)                │
│    └ macos.rs     lsof via execve + kill(2)              │
│                                                          │
│  process/   data model + process metadata enrichment     │
│  error.rs   structured errors                            │
└──────────────────────────────────────────────────────────┘
```

The frontend knows nothing about operating systems. The command layer knows nothing
about platforms. Adding a platform means implementing one trait and registering it
in `platform/mod.rs` — nothing above it changes.

## Data contract

Rust is the source of truth. The frontend mirrors it in `src/types/port.ts`.

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

Two rules that matter:

1. **Optional fields are omitted, never `null`.** The frontend gets real optional
   properties rather than having to check for `null` everywhere.
2. **Never use an empty string to mean "unknown".** It conflates "the value could not be
   read because of permissions" with "this is genuinely empty". Blank values are
   normalized to `None` at the point where they enter the model.

### Errors

```rust
pub enum PortError {
    InvalidPort, PermissionDenied, ProcessNotFound,
    KillFailed, PlatformUnsupported, Unknown,
}
```

Serialized as `{ "code": "...", "message": "..." }`. The frontend switches on `code`
only — it never parses system error text. `message` is a human-readable fallback and
is only shown for `UNKNOWN`.

The six codes are mirrored in the frontend's `PortErrorCode`, and each has an i18n
key. **Adding a language never touches Rust** — the UI decides its own wording from
the code.

## Why no shell

This is the single most important design decision.

The obvious way to find what's on a port is to shell out:

```rust
// Do NOT do this.
Command::new("sh").args(["-c", &format!("lsof -i:{port}")])
```

Even with a validated `u16`, this is a bad idea: it spawns a shell, depends on
external binaries being present and on `$PATH`, and produces text that has to be
parsed in a locale-dependent format. The command-injection surface is one refactor
away from appearing.

What Port Killer does instead:

| Platform | Port lookup | Kill |
| --- | --- | --- |
| Windows | `GetExtendedTcpTable` / `GetExtendedUdpTable` — raw FFI, no subprocess | `OpenProcess` + `TerminateProcess` |
| Linux | Read `/proc/net/*`, map inode → PID via `/proc/<pid>/fd` | `kill(2)` |
| macOS | `Command::new("lsof").args([...])` — direct `execve`, **no shell**, all arguments are fixed literals | `kill(2)` |

macOS is the only platform that runs an external binary, and it's executed directly
with literal arguments. `-iTCP:<port>` is built from a `u16` that has already been
range-validated, so the only thing that can appear there is a decimal number.

## Unsafe code

Windows FFI requires `unsafe`. The rules applied there:

- **Never cast a byte buffer to a struct reference.** Buffers from `Vec<u8>` are
  aligned to 1; the `MIB_*` structs require alignment 4. The allocator happening to
  return an aligned address doesn't make the cast legal — it's UB, and Miri rejects
  it. Everything is read with `read_unaligned`.
- **Validate the row count against the buffer length.** The count comes from the
  system, the buffer is ours. Security software and VPN drivers hook these APIs, so
  they can't be assumed to agree. The check uses `checked_add` / `checked_mul` and
  bails out rather than reading out of bounds.
- **Close handles on every path.** `CloseHandle` is called whether or not
  `TerminateProcess` succeeded, otherwise kernel objects leak.

There are unit tests that build malformed tables by hand — including one that claims
100 rows in a header-only buffer — and assert they're rejected rather than read.

## Why parsers live outside `#[cfg(target_os)]`

The pure-logic parts of platform code are extracted into modules with **no platform
gate**:

```
platform/state.rs        TCP state mapping (Windows codes / Linux hex / lsof names)
platform/proc_net.rs     /proc/net line + IPv4/IPv6 address parsing
platform/lsof_parser.rs  lsof field output parsing
platform/aggregate.rs    socket records → aggregated process rows
```

**Why it matters:** Rust only compiles what the `cfg` gates allow. A module gated
behind `#[cfg(target_os = "macos")]` — and the `#[cfg(test)]` module inside it — is
not compiled on Linux or Windows at all. Its tests do not fail there; they don't run.

Since this project is primarily developed and verified on Windows, any test that
lives only inside a macOS or Linux gate is effectively untested in day-to-day work.
Keeping the pure logic ungated means the same tests run on every platform, so a
regression in the macOS parser fails the Windows build immediately.

For the same reason CI builds and tests on **both** Linux and Windows: a Windows-only
loop cannot detect that `platform/linux.rs` fails to compile.

Related language wart worth knowing: **Rust block comments nest**. A `/*` appearing
inside a block comment opens a nested one, so the following `*/` closes the inner
comment only, and the rest of the file is swallowed. Path examples in comments should
avoid wildcard syntax for this reason.

## Kill flow

```
user clicks "Kill process"
      │
      ▼
confirmation dialog (name + PID + port spelled out)
      │
      ▼
kill_process(pid, force=false)          ← normal kill: SIGTERM on Unix
      │
      ├── error ──▶ show the reason; offer "Force kill" only if it could help
      │             (permission denied / process refused) — never for "process gone"
      ▼
re-query the port                       ← the important part
      │
      ├── no processes ──▶ "Port N released"
      ├── still occupied ─▶ "Port N still has M processes" (honest partial success)
      └── query failed ───▶ report the *query* failure, not a kill failure
```

**A successful syscall is not proof the port was freed.** The process might have
exited on its own, or another process might still be holding the same port. Claiming
success from the return value alone produces an app that lies to you — which is worse
than one that fails loudly.

Note the last branch: if the re-check itself fails, that's reported as a *check*
failure and the process list is cleared. Reporting it as a kill failure would keep the
stale process list on screen and assert "the port is still in use" — a claim the
app cannot actually support.

## Force kill

`force_kill` exists, but the UI never makes it easy:

- It is **not** available in the first confirmation dialog.
- It only appears after a normal kill has actually failed.
- It requires its own second confirmation that spells out the risk of data loss.

On Windows, `TerminateProcess` is inherently forceful, so "normal" and "force" differ
only in how hard the UI tries to talk you out of it. The UI copy reflects that honestly
rather than pretending there's a gentler option.

## Port list aggregation

A single port produces many sockets: one `LISTEN` plus any number of `ESTABLISHED`
connections. Listing them raw floods the view.

Rust aggregates by `(port, pid)` before returning:

- `connections` counts the underlying sockets
- the **representative state** is the one with the best rank — `LISTEN` wins, because
  that's the answer to "who's holding this port"
- protocols merge (`tcp+tcp6` when a process listens on both stacks)
- the representative address follows the representative state

The default view then filters to `LISTEN` only (plus UDP, which has no state), with
toggles for all connections and for ownerless sockets.

**Ownerless sockets** (PID 0 — typically `TIME_WAIT` residue) are shown but flagged,
and they get no kill button. There's no process to kill, and offering a button that
does nothing would be a lie.

Filtering happens client-side: one scan returns everything, so toggling a view is
instant and doesn't re-invoke a system call (four table walks on Windows, an `lsof`
process on macOS).

## Custom title bar

The window is `decorations: false`; the title bar is drawn in HTML. Reasons, in order
of importance:

1. **The native title bar follows the OS theme, not the app theme.** Switching the app
   to light while the OS is dark leaves a dark title bar. That's the kind of
   inconsistency users notice immediately.
2. **Vertical space.** The native title bar (~32px) plus an in-app header (~60px) is
   ~92px — 15% of a 480×620 window — and both display the app name. Merging them into
   one 40px row is a net win.
3. It's where app-level actions (port list, pin, settings) belong.

Trade-offs accepted: no native snap/snap-layouts, and drag plus window controls are
implemented in the frontend.

Every window API call goes through a guard that degrades silently when the handle is
unavailable. `getCurrentWindow()` **throws synchronously** rather than rejecting, so an
unguarded call inside a `useEffect` propagates and unmounts the entire React tree. A
missing capability must disable one optional feature, not the whole application.

**Edge resizing still works.** tao implements `WM_NCHITTEST` for undecorated but
resizable windows, so `resizable` and `minWidth` / `minHeight` behave normally.

**The layout grows with the window.** There is no maximum window size, so a single
fixed content width would leave hundreds of pixels empty on each side once maximised.
Both the content column and the drawer therefore step up at the `md` and `xl`
breakpoints rather than sitting at one fixed cap:

| | 480 px window | 900 px | 1400 px+ |
| --- | --- | --- | --- |
| Content column | 560 px | 680 px | 760 px |
| Port list drawer | 86% | 720 px | 880 px |

Below 560 px the column is limited by the viewport, so the default 480 px window is
unaffected. The caps stay in place because a full-width input box and a full-width
process card are harder to read than a centred column.

## Startup: hiding the window until there is something to show

Any webview-based desktop app has a gap between the window being created and the
first paint: the webview has to initialise, the HTML has to load, and the JS bundle
has to parse and run. In this app that gap is roughly 300-600 ms, and a window that
is visible during it shows nothing but its background colour.

The window is therefore created with `visible: false` and revealed by the frontend
once React has painted:

```ts
requestAnimationFrame(() => {
  requestAnimationFrame(() => tryWindowCall((win) => win.show()));
});
```

Two nested `requestAnimationFrame` calls are deliberate. The first fires after React
commits the DOM; the second fires after the browser has actually painted a frame.
A single `rAF` can still reveal the window before anything is on screen.

### The splash screen

`index.html` carries a self-contained splash: a centred mark and the app name, with
its own `<style>` block and a `prefers-color-scheme` variant. It lives inside `#root`,
so React clears it on mount and no cleanup code is needed.

Its job is to make the failure mode graceful. `lib.rs` reveals the window
unconditionally after 2 seconds, so a frontend that fails to load cannot leave an
invisible window behind — and if that fallback fires, what the user sees is the
splash rather than a blank window. Firing early is harmless for the same reason:
the splash is a legitimate thing to look at until React takes over.

The fallback calls `show()` **without** checking `is_visible()` first. A guard there
would make the safety net depend on the very thing it is protecting against.

> **Verification note.** Window visibility cannot be read reliably from outside the
> process on Windows. `Process.MainWindowHandle` and `MainWindowTitle` are not a
> sound proxy here: with this window they return a handle whose title is empty even
> while the window is on screen, and a control comparison against a decorated window
> (Notepad) does not transfer, because the app's window is undecorated. Verify from
> inside the app, or by looking at it.

## Verification scope

Being precise about what has actually been run, versus what has only been written:

| Platform | Status |
| --- | --- |
| **Windows** | Verified end-to-end on real hardware: native tests, production build, real app launch |
| **Linux** | Implementation complete; compiled and tested in CI, **not yet run on real hardware** |
| **macOS** | Implementation complete; parsers tested on every platform, **not yet run on real hardware** |

The Linux and macOS `ProcessProvider` implementations are written against the
documented behaviour of `/proc` and `lsof`. Their pure-logic halves are covered by
tests that run everywhere. But "the parser is correct" is not the same as "it works
on a real Mac", and this document won't claim otherwise.

If you can run it on Linux or macOS, that's the single most valuable contribution
right now — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Quality gates

Every change is expected to keep all of these green:

```bash
npx tsc --noEmit                              # 0 errors
npx eslint .                                  # 0 errors, 0 warnings
npx prettier --check "src/**/*.{ts,tsx,css}"  # formatted
npm run i18n:check                            # locale keys + placeholders in sync
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings     # 0 warnings
cargo test                                    # 75 passing
```

CI runs the frontend job plus Rust on **both** Ubuntu and Windows. Linux is included
specifically because `platform/linux.rs` is not compiled on Windows at all — a
Windows-only loop cannot detect that it fails to compile.
