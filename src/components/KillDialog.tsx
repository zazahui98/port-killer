import { useState } from "react";
import { AlertTriangle, Skull, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { PORT_MAX, PORT_MIN } from "../utils/port";
import type { ErrorPresentation, PortProcess } from "../types/port";

interface KillDialogProps {
  open: boolean;
  process: PortProcess | null;
  port: number;
  /**
   * 上一次终结失败的原因。
   * 任何错误码都要给出说明 —— 否则用户点了「终结进程」后弹窗毫无变化，
   * 完全不知道发生了什么。是否提供强制入口由 suggestForce 决定。
   */
  failure?: ErrorPresentation | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onForce: () => void;
}

/**
 * 终结确认对话框。
 *
 * 关键约束：
 * - 明确告知将结束哪个进程（名字 + PID + 端口），不做模糊确认
 * - 「强制终结」永远不是默认按钮，且需要独立的二次确认
 * - 危险操作对话框不响应遮罩点击，避免误触
 */
export function KillDialog({
  open,
  process,
  port,
  failure,
  busy,
  onCancel,
  onConfirm,
  onForce,
}: KillDialogProps) {
  const { t } = useTranslation();

  // 强制终结的二次确认步骤。
  // 重置靠父组件用 key 重新挂载本组件完成，不需要 effect 同步。
  const [forceStep, setForceStep] = useState(false);

  if (!process) return null;

  const name = process.processName || `PID ${process.pid}`;

  if (forceStep) {
    return (
      <Dialog
        open={open}
        onClose={busy ? () => undefined : () => setForceStep(false)}
        title={t("dialog.forceTitle")}
        dismissOnBackdrop={false}
        description={t("dialog.forceDescription")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForceStep(false)} disabled={busy}>
              {t("action.back")}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingText={t("dialog.forceLoading")}
              onClick={onForce}
              icon={<Zap size={14} aria-hidden />}
            >
              {t("dialog.forceEntry")}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
          <div className="min-w-0 font-mono text-[12px] text-danger">
            {name} · PID {process.pid}
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={t("dialog.killTitle", { name })}
      dismissOnBackdrop={false}
      description={t("dialog.killDescription")}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            loadingText={t("process.killing")}
            onClick={onConfirm}
            icon={<Skull size={14} aria-hidden />}
          >
            {t("process.kill")}
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-elevated px-3 py-2.5">
        <dt className="text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
          PID
        </dt>
        <dd className="font-mono text-[12.5px] text-fg">{process.pid}</dd>

        <dt className="text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
          Port
        </dt>
        <dd className="font-mono text-[12.5px] text-fg">{port}</dd>
      </dl>

      {failure && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5">
          <p className="text-[12.5px] font-medium text-fg">{t(failure.titleKey)}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">
            {failure.detailKey
              ? t(failure.detailKey, { min: PORT_MIN, max: PORT_MAX })
              : failure.detailFallback}
          </p>

          {failure.suggestForce && (
            <div className="mt-2.5">
              <Button
                variant="dangerGhost"
                size="sm"
                onClick={() => setForceStep(true)}
                disabled={busy}
                icon={<Zap size={12} aria-hidden />}
              >
                {t("dialog.forceEntry")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
