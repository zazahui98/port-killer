import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** 提示气泡最大宽度 */
  maxWidth?: number;
  /** 是否禁用（内容为空时自动禁用） */
  disabled?: boolean;
  className?: string;
}

const GAP = 8;
const EDGE = 10;

/**
 * 轻量 Tooltip。
 *
 * 通过 portal 渲染到 body，避免被卡片的圆角/滚动容器裁切；
 * 位置按视口做边界收敛，保证小窗口下也不会溢出。
 * 同时响应鼠标悬停与键盘聚焦，满足可访问性要求。
 */
export function Tooltip({
  content,
  children,
  maxWidth = 340,
  disabled = false,
  className = "",
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (!disabled && content) setOpen(true);
  }, [disabled, content]);

  const hide = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  // 打开后测量气泡尺寸并定位（居中于触发器上方）
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();

    let top = t.top - b.height - GAP;
    // 上方空间不足则翻转到下方
    if (top < EDGE) top = t.bottom + GAP;
    top = Math.min(Math.max(top, EDGE), window.innerHeight - b.height - EDGE);

    let left = t.left + t.width / 2 - b.width / 2;
    left = Math.min(Math.max(left, EDGE), window.innerWidth - b.width - EDGE);

    setPos({ top, left });
  }, [open]);

  // 滚动或改变窗口尺寸时收起，避免气泡与触发器错位
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => hide();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, hide]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  const active = open && !disabled && Boolean(content);

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex min-w-0 max-w-full ${className}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>

      {active &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              maxWidth,
              visibility: pos ? "visible" : "hidden",
            }}
            className="animate-fade-in pointer-events-none fixed z-[60] rounded-lg border border-line bg-elevated px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed break-all text-fg shadow-[var(--pk-shadow-pop)]"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
