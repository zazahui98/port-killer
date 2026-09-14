import { createContext, useContext } from "react";

/**
 * Toast 的上下文与消费 Hook。
 *
 * 单独成文件而不是和 <ToastProvider> 放一起：
 * React Fast Refresh 只在「一个文件只导出组件」时才能可靠地热更新，
 * 组件与 Hook 混在一个文件里会让热更新退化成整页刷新。
 */

export type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** 毫秒；loading 类型默认不自动消失 */
  duration?: number;
}

export interface ToastContextValue {
  success: (message: string) => number;
  error: (message: string) => number;
  info: (message: string) => number;
  loading: (message: string) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 <ToastProvider> 内部使用");
  return ctx;
}
