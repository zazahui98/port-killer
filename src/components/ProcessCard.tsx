import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Info, Skull } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { StateBadge } from "./StateBadge";
import { isOwnerless } from "../types/port";
import { commandBinary } from "../utils/port";
import type { PortProcess } from "../types/port";

interface ProcessCardProps {
  process: PortProcess;
  port: number;
  /** 该进程正在被终结 */
  killing: boolean;
  /** 有其它终结操作在进行中 */
  disabled: boolean;
  onKill: (pid: number) => void;
}

/**
 * 单个进程卡片。
 *
 * 信息层级：进程名 → 归属信息 → PID / 端口 / 地址 / 状态 → 启动方式 → 危险操作。
 *
 * 「启动方式」优先展示完整命令行，拿不到时退回可执行文件路径 ——
 * 两者都在回答「这是什么程序」，同时展示只是重复。
 */
export function ProcessCard({
  process,
  port,
  killing,
  disabled,
  onKill,
}: ProcessCardProps) {
  const { t } = useTranslation();
  const {
    pid,
    processName,
    command,
    executablePath,
    protocol,
    user,
    localAddress,
    state,
  } = process;

  const ownerless = isOwnerless(process);

  // 进程名可能为空（权限受限），退回命令行首段
  const title = processName || commandBinary(command) || `PID ${pid}`;

  // 命令行优先；没有就退到可执行文件路径
  const detail = command ?? executablePath ?? null;

  const meta = [protocol?.toUpperCase(), user].filter(Boolean).join(" · ");

  /**
   * 是否需要悬停提示：CSS 层 `truncate-1` 是否真的把内容裁掉了。
   *
   * 用 ResizeObserver 量真实的 `scrollWidth > clientWidth`，而不是按字符数估算 ——
   * 视觉宽度才是真相，60 个字符的命令行在 440px 的等宽字体下也会被裁。
   */
  const codeRef = useRef<HTMLElement>(null);
  const [isClipped, setIsClipped] = useState(false);
  useLayoutEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    const check = () => setIsClipped(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [detail]);

  return (
    <article
      className={[
        "animate-fade-up rounded-[var(--radius-card)] border border-line bg-surface p-3.5",
        "transition-[border-color,opacity] duration-200",
        killing ? "border-accent/40 opacity-80" : "",
      ].join(" ")}
      aria-label={t("process.cardAria", { name: title, pid })}
    >
      {/* 进程名 + 归属 */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="truncate-1 font-mono text-[14px] font-medium text-fg"
            title={title}
          >
            {title}
          </h3>
          {meta && (
            <p className="mt-0.5 truncate-1 text-[11.5px] text-fg-subtle">{meta}</p>
          )}
        </div>
        {ownerless && <StateBadge state={state} variant="muted" />}
      </header>

      {/* 关键字段 */}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <Field label={t("process.pid")}>{pid}</Field>
        <Field label={t("process.port")}>{port}</Field>
        {localAddress && <Field label={t("process.address")}>{localAddress}</Field>}
        {state && (
          <Field label={t("process.state")}>
            <StateBadge state={state} />
          </Field>
        )}
      </dl>

      {/* 启动方式 —— 被裁掉时鼠标悬停查看完整内容 */}
      {detail && (
        <div
          className={[
            "group/codebox mt-3 flex items-center gap-2 rounded-lg border bg-elevated px-2.5 py-2",
            "transition-colors duration-150",
            isClipped
              ? "cursor-help border-line hover:border-line-strong hover:text-fg"
              : "border-line",
          ].join(" ")}
        >
          <Tooltip content={detail} disabled={!isClipped}>
            <code
              ref={codeRef}
              className="min-w-0 flex-1 truncate-1 block font-mono text-[11.5px] text-fg-muted"
            >
              {detail}
            </code>
          </Tooltip>
          {isClipped && (
            <Info
              size={14}
              aria-hidden
              className="shrink-0 text-fg-muted opacity-90 transition-opacity duration-150 group-hover/codebox:opacity-100"
            />
          )}
        </div>
      )}

      <div className="mt-3.5">
        <Button
          variant="danger"
          block
          loading={killing}
          loadingText={t("process.killing")}
          disabled={disabled && !killing}
          onClick={() => onKill(pid)}
          icon={<Skull size={14} aria-hidden />}
          aria-label={t("process.killAria", { name: title, pid })}
        >
          {t("process.kill")}
        </Button>
      </div>
    </article>
  );
}

/** 定义列表里的一行：标签 + 值 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="font-mono text-[12.5px] text-fg">{children}</dd>
    </>
  );
}
