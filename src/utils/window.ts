import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

/**
 * 取当前窗口句柄；拿不到时返回 `null`。
 *
 * `getCurrentWindow()` 在**没有 Tauri 运行时时会同步抛错**（例如在浏览器里
 * 单独调 UI），窗口 API 不可用时也一样。窗口相关的功能全是锦上添花，
 * 不该因为它们把整个应用打崩 —— 所以这里一律吞掉异常并让调用方降级。
 *
 * 这个坑真实发生过：`useAlwaysOnTop` 直接在 effect 体里调它，
 * 结果 React 把整棵组件树卸载了，页面只剩一个空的 `#root`。
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
 * 窗口行为全是锦上添花（置顶、主题、最小化…），失败时应该安静降级，
 * 而不是冒泡成未处理的 Promise rejection —— `void somePromise()` 写法
 * 在 promise 被拒绝时会产生 unhandled rejection，虽然不致命但会污染控制台，
 * 也容易掩盖真正的问题。
 *
 * 权限缺失时 Tauri 会拒绝这些调用，这正是我们想静默处理的情况。
 */
export function tryWindowCall(run: (win: Window) => Promise<unknown>): void {
  const win = currentWindow();
  if (!win) return;
  void run(win).catch(() => {
    /* 拿不到权限或窗口不可用：静默降级 */
  });
}
