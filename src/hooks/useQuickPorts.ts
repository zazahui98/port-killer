import { useCallback, useState } from "react";

/** 常用端口区的显示偏好（与主题、语言一样保存在本机） */
const STORAGE_KEY = "portkiller.showQuickPorts";

/**
 * 默认开启：常用端口是这个工具的主要快捷入口，
 * 关掉它属于「我要更简洁的界面」这种主动选择，不该是默认状态。
 */
function readStored(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

function persist(value: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(value));
}

export interface QuickPortsApi {
  /** 主界面是否显示常用端口区 */
  enabled: boolean;
  toggle: () => void;
}

export function useQuickPorts(): QuickPortsApi {
  const [enabled, setEnabled] = useState(readStored);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, []);

  return { enabled, toggle };
}
