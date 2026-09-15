import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

/**
 * 取当前窗口句柄；拿不到时返回 `null`。
 *
 * `getCurrentWindow()` 在没有 Tauri 运行时**会同步抛错**（而不是返回 rejected
 * promise），例如在浏览器里单独调 UI 时。窗口相关的功能全是锦上添花，
 * 不该因为它们把整个应用打崩 —— 所以这里一律吞掉异常并让调用方降级。
 */
export function currentWindow(): Window | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * 调用一个窗口 API，并吞掉失败。
 *
 * 窗口行为全是锦上添花（置顶、主题、最小化…），失败时应安静降级。
 * 直接写 `void win.minimize()` 会在 promise 被拒绝时产生 unhandled rejection ——
 * 权限缺失时 Tauri 正是这样拒绝调用的。
 */
export function tryWindowCall(run: (win: Window) => Promise<unknown>): void {
  const win = currentWindow();
  if (!win) return;
  void run(win).catch(() => {
    /* 拿不到权限或窗口不可用：静默降级 */
  });
}
