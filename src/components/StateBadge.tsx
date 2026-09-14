import { stateTone } from "../utils/state";

interface StateBadgeProps {
  /** 规范化后的 TCP 状态；UDP 或未知时为 undefined */
  state?: string;
  /** 强制使用弱化配色（例如「无主连接」这类不该抢注意力的标记） */
  variant?: "default" | "muted";
}

/**
 * TCP 状态徽章。
 *
 * 颜色只是辅助 —— 徽章本身就把状态名写出来了，
 * 满足「状态不能只靠颜色表达」这条可访问性约定。
 */
export function StateBadge({ state, variant = "default" }: StateBadgeProps) {
  if (!state) return null;

  const tone = variant === "muted" ? "muted" : stateTone(state);

  return (
    <span
      className={[
        "inline-block rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-medium",
        "tracking-[0.02em] whitespace-nowrap",
        TONE_CLASS[tone],
      ].join(" ")}
    >
      {state}
    </span>
  );
}

const TONE_CLASS = {
  listen: "bg-success-soft text-success",
  active: "bg-accent-soft text-accent",
  closing: "bg-warn-soft text-warn",
  idle: "bg-elevated text-fg-muted",
  muted: "border border-line bg-elevated text-fg-subtle",
} as const;
