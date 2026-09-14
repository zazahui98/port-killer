import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** 危险操作对话框：点击遮罩不关闭，避免误触 */
  dismissOnBackdrop?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * 无依赖的可访问对话框。
 *
 * - Esc 关闭
 * - 打开时把焦点移入，关闭时归还给触发元素
 * - Tab / Shift+Tab 在对话框内循环（简易焦点陷阱）
 * - aria-modal + aria-labelledby 让屏幕阅读器正确播报
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissOnBackdrop = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    // 打开后把焦点交给第一个可聚焦元素（通常是「取消」按钮）
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const target = nodes[0] ?? panel;
      target.focus();
    });

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      restoreRef.current?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div
        className="animate-fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={[
          "animate-scale-in relative flex w-full max-w-[380px] flex-col",
          "max-h-[calc(100vh-2rem)] rounded-[16px] border border-line bg-surface",
          "shadow-[var(--pk-shadow-pop)] outline-none",
        ].join(" ")}
      >
        {/*
          三段式布局：头部与底部固定，只有中间滚动。
          不这么做的话，内容一多对话框就会顶破视口 ——
          外层是 `flex items-center`，溢出部分会从上下两端同时被裁掉，
          标题和操作按钮都被挤到贴边。
        */}
        <div className="shrink-0 px-5 pt-5 pb-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-fg">
            {title}
          </h2>

          {description && (
            <div
              id={descId}
              className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted"
            >
              {description}
            </div>
          )}
        </div>

        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">{children}</div>
        )}

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
