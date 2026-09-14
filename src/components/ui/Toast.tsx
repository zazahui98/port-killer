import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, Loader2, XCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ToastContext,
  type ToastContextValue,
  type ToastItem,
  type ToastKind,
} from "./toastContext";

/** 各类型默认存活时长（毫秒） */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2600,
  error: 4200,
  info: 2600,
  loading: 0, // 常驻，直到被替换或手动关闭
};

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={15} className="text-success" aria-hidden />,
  error: <XCircle size={15} className="text-danger" aria-hidden />,
  info: <Info size={15} className="text-fg-muted" aria-hidden />,
  loading: (
    <Loader2 size={15} className="text-fg-muted animate-spin-fast" aria-hidden />
  ),
};

const ACCENT: Record<ToastKind, string> = {
  success: "border-l-success/60",
  error: "border-l-danger/60",
  info: "border-l-line-strong",
  loading: "border-l-line-strong",
};

/**
 * 统一的 Toast 系统。
 *
 * 不使用浏览器原生 alert —— 它会阻塞渲染进程，且在桌面窗口里样式失控。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, duration?: number) => {
      const id = ++idRef.current;
      const life = duration ?? DEFAULT_DURATION[kind];

      // 同一时刻最多保留 3 条，避免堆叠遮挡主内容
      setToasts((prev) => [...prev, { id, kind, message, duration: life }].slice(-3));

      if (life > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), life),
        );
      }
      return id;
    },
    [dismiss],
  );

  // 卸载时清理所有计时器
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      loading: (m) => push("loading", m),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器：底部居中，不阻断交互 */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-4"
        role="region"
        aria-label={t("toast.notifications")}
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
            aria-live={item.kind === "error" ? "assertive" : "polite"}
            className={[
              "animate-toast-in pointer-events-auto flex w-full max-w-[420px] items-center gap-2.5",
              "rounded-[10px] border border-line border-l-2 bg-elevated/95 px-3 py-2.5",
              "text-[13px] text-fg shadow-[var(--pk-shadow-pop)] backdrop-blur-md",
              ACCENT[item.kind],
            ].join(" ")}
          >
            <span className="shrink-0">{ICONS[item.kind]}</span>
            <span className="min-w-0 flex-1 leading-snug break-words">
              {item.message}
            </span>
            {item.kind !== "loading" && (
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={t("toast.closeNotification")}
                className="-mr-1 shrink-0 rounded-md p-1 text-fg-subtle transition-colors duration-150 hover:bg-line/60 hover:text-fg"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
