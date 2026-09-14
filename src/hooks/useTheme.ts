import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  prefersDark,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../utils/theme";
import { tryWindowCall } from "../utils/window";

export type { ThemeMode };

export interface ThemeApi {
  mode: ThemeMode;
  /** 当前实际生效的是不是深色 */
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

/**
 * 主题管理：System / Dark / Light。
 *
 * 深色是首要设计目标，System 是默认值。
 *
 * `isDark` 是**派生值**而不是 state：它只由「用户选择」和「系统外观」决定。
 * 这样既避免了在 effect 里 setState 造成的级联渲染，也不会出现
 * 「状态和实际 DOM 不一致」的可能。
 */
export function useTheme(): ThemeApi {
  const [mode, setModeState] = useState<ThemeMode>(readStoredTheme);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  // effect 的正当用途：把状态同步到外部系统（<html> 上的 class）
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // 订阅系统外观变化（无论当前是什么模式都订阅，切换模式时无需重订阅）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 隐私模式下静默降级 */
    }
  }, []);

  const isDark = mode === "dark" || (mode === "system" && systemDark);

  /**
   * 让**窗口外壳**也跟上主题。
   *
   * 自绘标题栏本身是 HTML，会跟着 CSS 变量走；但窗口自身还有两处由系统绘制：
   *   - `theme`：影响窗口边框与系统绘制的右键菜单
   *   - `backgroundColor`：内容绘制前的底色，不设的话浅色主题下会闪一下深色
   *
   * `mode === "system"` 时传 `null`，交还给系统跟随 —— 传死一个值反而
   * 会在系统切换外观时不同步。
   */
  useEffect(() => {
    tryWindowCall((win) =>
      win.setTheme(mode === "system" ? null : isDark ? "dark" : "light"),
    );
    // 与 tauri.conf.json 里的 backgroundColor 保持一致，
    // 避免首帧前露出一块与主题不符的底色
    tryWindowCall((win) => win.setBackgroundColor(isDark ? "#0b0c0e" : "#f6f7f8"));
  }, [mode, isDark]);

  return { mode, isDark, setMode };
}
