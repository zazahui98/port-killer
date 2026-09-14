import { useCallback, useEffect, useState } from "react";

import { currentWindow } from "../utils/window";

/** 窗口置顶偏好（与主题、语言一样保存在本机） */
const STORAGE_KEY = "portkiller.alwaysOnTop";

function readStored(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function persist(value: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(value));
}

export interface AlwaysOnTopApi {
  enabled: boolean;
  toggle: () => void;
}

/**
 * 窗口置顶。
 *
 * 对这个工具是刚需：终端里报 `Address already in use`，切过来点一下终结，
 * 希望它别被终端盖住。
 *
 * 偏好持久化 —— 与主题、语言同属「用户偏好」，不是需要清理的累积状态。
 * 但**以窗口的真实状态为准**：初始化时读一次 `isAlwaysOnTop()`，
 * 免得本地记录与窗口实际状态不一致（例如上次异常退出）。
 */
export function useAlwaysOnTop(): AlwaysOnTopApi {
  const [enabled, setEnabled] = useState(readStored);

  // 挂载时与窗口真实状态对齐
  useEffect(() => {
    const appWindow = currentWindow();
    if (!appWindow) return;

    let cancelled = false;

    appWindow
      .isAlwaysOnTop()
      .then((actual) => {
        if (cancelled) return;
        setEnabled(actual);
        persist(actual);
      })
      .catch(() => {
        // 拿不到就当没置顶，不影响其它功能
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(() => {
    const appWindow = currentWindow();
    if (!appWindow) return;

    setEnabled((prev) => {
      const next = !prev;
      persist(next);
      // 失败时回滚，避免界面显示的状态与窗口实际状态不符
      appWindow.setAlwaysOnTop(next).catch(() => {
        setEnabled(prev);
        persist(prev);
      });
      return next;
    });
  }, []);

  return { enabled, toggle };
}
