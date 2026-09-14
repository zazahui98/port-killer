import { useCallback, useEffect, useState } from "react";

import { currentWindow, tryWindowCall } from "../utils/window";

export interface WindowChromeApi {
  /** 窗口当前是否最大化（决定标题栏显示「最大化」还是「还原」图标） */
  maximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  /**
   * 挂在标题栏的 `onMouseDown` 上：在空白处按下即拖动窗口。
   * 按钮上按下不触发（否则点按钮会变成拖窗）。
   */
  startDrag: (event: React.MouseEvent) => void;
  /**
   * 挂在标题栏的 `onDoubleClick` 上：双击空白处切换最大化，
   * 与 Windows 原生标题栏行为一致。
   */
  toggleMaximizeOnDoubleClick: (event: React.MouseEvent) => void;
}

/** 判断事件是否发生在可交互元素上（按钮 / 输入框 / 链接） */
function onInteractiveElement(event: React.MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(
    target?.closest("button, a, input, select, textarea, [role='button']"),
  );
}

/**
 * 自绘标题栏需要的窗口行为。
 *
 * 因为窗口是 `decorations: false`，拖拽、最小化、最大化、关闭全部得自己接。
 * 所有调用都经过 `currentWindow()` 的 null 检查 —— 拿不到窗口时静默降级，
 * 不让可选功能把应用打崩。
 *
 * 最大化状态通过 webview 的 `resize` 事件跟踪：窗口尺寸变化必然伴随
 * resize，比订阅 Tauri 的窗口事件少一个权限。
 */
export function useWindowChrome(): WindowChromeApi {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = currentWindow();
    if (!appWindow) return;

    let cancelled = false;

    const sync = () => {
      appWindow
        .isMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
        })
        .catch(() => {
          /* 拿不到就维持原状 */
        });
    };

    sync();
    window.addEventListener("resize", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", sync);
    };
  }, []);

  const minimize = useCallback(() => {
    tryWindowCall((win) => win.minimize());
  }, []);

  const toggleMaximize = useCallback(() => {
    tryWindowCall((win) => win.toggleMaximize());
  }, []);

  const close = useCallback(() => {
    tryWindowCall((win) => win.close());
  }, []);

  const startDrag = useCallback((event: React.MouseEvent) => {
    if (event.buttons !== 1) return; // 只响应左键
    if (onInteractiveElement(event)) return;
    tryWindowCall((win) => win.startDragging());
  }, []);

  const toggleMaximizeOnDoubleClick = useCallback((event: React.MouseEvent) => {
    if (onInteractiveElement(event)) return;
    tryWindowCall((win) => win.toggleMaximize());
  }, []);

  return {
    maximized,
    minimize,
    toggleMaximize,
    close,
    startDrag,
    toggleMaximizeOnDoubleClick,
  };
}
