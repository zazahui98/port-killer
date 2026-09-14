# Security Policy

[**English**](./SECURITY.md) · [简体中文](./SECURITY.zh-CN.md)

## What this program does

Port Killer **terminates processes you point it at**. That's the entire point of the
tool, and it's also its largest risk surface. Before reporting a security issue,
it helps to know the design boundaries:

- All port lookup and process termination happen locally — **no network access, no
  telemetry, no data collection of any kind**
- No subprocesses are spawned (on macOS the system `lsof` binary is executed directly
  to read port information)
- No command-line strings are built from user input; nothing a user types ever
  reaches a shell
- Ports (1–65535) and PIDs are validated independently on both sides of the IPC boundary
- Normal termination is the default; **force kill** only appears after a normal kill
  has failed, and requires its own separate confirmation
- The port is re-queried after a kill — success is reported only once it's actually free

## Supported versions

| Version | Security fixes |
| --- | --- |
| Latest release | ✅ |
| Older releases | ❌ — please upgrade first |

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Preferred: GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(repository **Security** tab → *Report a vulnerability*).

If you can't use that, email the maintainer (see the repository profile) with
`[SECURITY]` in the subject line.

Please include as much of the following as you can:

- Affected version and platform
- Vulnerability class (e.g. privilege escalation, command injection, out-of-bounds
  read, unvalidated IPC input)
- Steps to reproduce, or a minimal reproducer
- Impact assessment — what could an attacker actually do with this?
- A suggested fix, if you have one

## What we care about

In rough priority order:

1. **IPC input-validation bypass** — anything that gets malformed ports or PIDs past
   the validation layer
2. **Command injection** — any path that lets user input reach a shell. This should
   be structurally impossible; if you find one, please report it
3. **Out-of-bounds access** — memory-safety issues while parsing binary buffers
   returned by the OS
4. **Privilege escalation** — killing a process a normal user shouldn't be able to kill
5. **Data exfiltration** — any form of network access or reporting

## Response timeline

Maintainers aim to acknowledge within **7 days** and to provide a fix or a plan within
**30 days** of acknowledgement. This is a best-effort commitment, not an SLA.

## Known non-issues

The following are **by design** and are not security vulnerabilities:

- **A normal user cannot kill processes owned by other users or by the system.**
  That's the operating system's permission model, not a defect. The app returns a
  structured "permission denied" error and points the user at the fix.
- **Killing a process may break programs that depend on it, or lose unsaved work.**
  That's an inherent consequence of terminating a process. The confirmation dialog
  says so explicitly, and force kill has a second confirmation.
- **`lsof` being unavailable on macOS.** The app returns a clear error rather than
  failing silently.
