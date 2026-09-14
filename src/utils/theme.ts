/**
 * 主题工具。
 *
 * 单独抽出来是因为有两个调用方：
 * - `main.tsx` 在首帧渲染前同步应用主题（避免深/浅色闪烁）
 * - `useTheme` 在用户切换时应用
 *
 * 约定：`<html>` 上的 class 是唯一事实来源
 *   - 无 class  → 跟随系统（由 styles.css 的 media query 兜底）
 *   - `.dark`   → 强制深色
 *   - `.light`  → 强制浅色
 */

export type ThemeMode = "system" | "dark" | "light";

export const THEME_STORAGE_KEY = "portkiller.theme";

export function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "dark" || raw === "light" || raw === "system") return raw;
  } catch {
    // 隐私模式下 localStorage 可能不可用
  }
  return "system";
}

export function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
}
