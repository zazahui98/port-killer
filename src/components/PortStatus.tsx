import { AlertTriangle, CheckCircle2, CircleDot, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Phase } from "../types/port";

interface PortStatusProps {
  port: number;
  phase: Phase;
  processCount: number;
}

/**
 * 端口状态条。
 *
 * 可访问性：状态不能只靠颜色表达，因此每种状态都有
 * 图标 + 文字描述，颜色只是辅助。
 */
export function PortStatus({ port, phase, processCount }: PortStatusProps) {
  const { t } = useTranslation();
  const checking = phase === "CHECKING" || phase === "KILLING";

  const view = (() => {
    if (checking) {
      return {
        tone: "text-fg-muted",
        icon: <Loader2 size={13} className="animate-spin-fast" aria-hidden />,
        label:
          phase === "KILLING" ? t("status.killing") : t("status.checking", { port }),
        detail: null as string | null,
      };
    }
    if (phase === "RELEASED") {
      return {
        tone: "text-success",
        icon: <CheckCircle2 size={13} aria-hidden />,
        label: t("status.released", { port }),
        detail: t("status.releasedDetail"),
      };
    }
    if (phase === "AVAILABLE") {
      return {
        tone: "text-success",
        icon: <CheckCircle2 size={13} aria-hidden />,
        label: t("status.portLabel", { port }),
        detail: t("status.availableDetail"),
      };
    }
    if (phase === "OCCUPIED") {
      return {
        tone: "text-danger",
        icon: <CircleDot size={13} aria-hidden />,
        label: t("status.portLabel", { port }),
        detail:
          processCount > 1
            ? t("status.occupiedMany", { count: processCount })
            : t("status.occupied"),
      };
    }
    if (phase === "FAILED") {
      // FAILED 有两种来源，靠进程列表是否为空区分：
      // - 终结失败：reducer 保留了进程列表，端口依然被占用
      // - 查询失败：进程列表为空，由 App 直接渲染错误面板，不走这里
      if (processCount === 0) return null;
      return {
        tone: "text-danger",
        icon: <AlertTriangle size={13} aria-hidden />,
        label: t("status.portLabel", { port }),
        detail:
          processCount > 1
            ? t("status.failedMany", { count: processCount })
            : t("status.failed"),
      };
    }
    return null;
  })();

  if (!view) return null;

  const { tone, icon, label, detail } = view;

  return (
    <div className="px-5" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className={tone}>{icon}</span>
        <span className={`font-mono text-[12px] font-medium tracking-[0.02em] ${tone}`}>
          {label}
        </span>
      </div>

      {detail && (
        <p
          className={[
            "mt-1 text-[13px] leading-relaxed",
            phase === "OCCUPIED" || phase === "FAILED" ? "text-fg" : "text-fg-muted",
          ].join(" ")}
        >
          {detail}
        </p>
      )}
    </div>
  );
}
