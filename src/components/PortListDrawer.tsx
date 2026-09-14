import { useEffect, useRef, type ReactNode } from "react";
import { Loader2, RefreshCw, Search, Skull, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StateBadge } from "./StateBadge";
import { isOwnerless, presentError, type PortProcess } from "../types/port";
import type { PortListApi } from "../hooks/usePortList";

interface PortListDrawerProps {
  open: boolean;
  onClose: () => void;
  list: PortListApi;
  /** 点击某一行时把该端口带进单端口查询 */
  onPickPort: (port: number) => void;
  /** 终结某个进程 */
  onKill: (pid: number) => void;
  /** 正在被终结的 PID */
  killingPid: number | null;
}

/**
 * 端口列表抽屉。
 *
 * 覆盖整个窗口而不是做成侧边栏：窗口只有 480px 宽，
 * 侧边栏会把列表压到没法看。
 *
 * 默认只显示**监听中**的端口 —— 那才是「端口被占用」的答案；
 * 想看全部连接（含 ESTABLISHED / TIME_WAIT）有开关。
 */
export function PortListDrawer({
  open,
  onClose,
  list,
  onPickPort,
  onKill,
  killingPid,
}: PortListDrawerProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);

  const { rows, loading, error, query, setQuery, listeningOnly, setListeningOnly } =
    list;
  const { showOwnerless, setShowOwnerless, refresh, total } = list;

  // 打开时聚焦搜索框，并把结果拿一次
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    refresh();
  }, [open, refresh]);

  // Esc 关闭（输入框里有内容时先清空，符合直觉）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (query) {
        setQuery("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, query, setQuery, onClose]);

  if (!open) return null;

  const failure = error ? presentError(error) : null;

  return (
    <div
      className="animate-fade-in absolute inset-0 z-40 flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label={t("list.title")}
    >
      {/* 顶部：标题 + 关闭 */}
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-fg">{t("list.title")}</h2>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              aria-label={t("action.refresh")}
              title={t("action.refresh")}
              className="rounded-lg p-1.5 text-fg-subtle transition-colors duration-150 hover:bg-elevated hover:text-fg disabled:opacity-40"
            >
              <RefreshCw
                size={14}
                aria-hidden
                className={loading ? "animate-spin-fast" : undefined}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("action.close")}
              title={t("action.close")}
              className="rounded-lg p-1.5 text-fg-subtle transition-colors duration-150 hover:bg-elevated hover:text-fg"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {/* 筛选 */}
      <div className="shrink-0 border-b border-line px-4 py-2.5">
        <div className="mx-auto w-full max-w-[560px]">
          <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent/60">
            <Search size={13} className="shrink-0 text-fg-subtle" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("list.filter")}
              spellCheck={false}
              className="h-full w-full min-w-0 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("action.clear")}
                className="shrink-0 rounded p-0.5 text-fg-subtle hover:text-fg"
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Toggle
                checked={listeningOnly}
                onChange={setListeningOnly}
                label={t("list.listeningOnly")}
                title={t("list.listeningOnlyHint")}
              />
              <Toggle
                checked={showOwnerless}
                onChange={setShowOwnerless}
                label={t("list.showOwnerless")}
                title={t("list.ownerlessHint")}
              />
            </div>
            <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
              {query || rows.length !== total
                ? t("list.filteredCount", { shown: rows.length, total })
                : t("list.count", { count: rows.length })}
            </span>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {failure ? (
          <div className="px-4 py-6" role="alert">
            <p className="text-[13px] font-medium text-fg">{t(failure.titleKey)}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
              {failure.detailKey ? t(failure.detailKey) : failure.detailFallback}
            </p>
          </div>
        ) : loading && rows.length === 0 ? (
          <Placeholder>
            <Loader2 size={16} className="animate-spin-fast" aria-hidden />
            {t("list.loading")}
          </Placeholder>
        ) : rows.length === 0 ? (
          <Placeholder>
            {listeningOnly ? t("list.emptyListening") : t("list.empty")}
          </Placeholder>
        ) : (
          <ul className="mx-auto flex w-full max-w-[560px] flex-col">
            {rows.map((row) => (
              <PortListRow
                key={`${row.protocol ?? "tcp"}-${row.port}-${row.pid}`}
                row={row}
                onPick={() => onPickPort(row.port)}
                onKill={() => onKill(row.pid)}
                killing={killingPid === row.pid}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 列表里的一行 */
function PortListRow({
  row,
  onPick,
  onKill,
  killing,
}: {
  row: PortProcess;
  onPick: () => void;
  onKill: () => void;
  killing: boolean;
}) {
  const { t } = useTranslation();
  const ownerless = isOwnerless(row);
  // 命令行通常以可执行文件路径开头，有它就不必再单列路径
  const path = row.executablePath ?? row.command;

  return (
    <li className="border-b border-line/60 px-4 py-2.5 transition-colors duration-150 hover:bg-surface">
      <div className="flex items-start gap-3">
        {/* 左侧：端口 + 状态 */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPick}
              title={t("list.jumpToPort", { port: row.port })}
              className="rounded font-mono text-[13px] font-semibold text-accent transition-opacity duration-150 hover:opacity-75"
            >
              {row.port}
            </button>
            {row.protocol && (
              <span className="font-mono text-[10.5px] tracking-[0.04em] text-fg-subtle uppercase">
                {row.protocol}
              </span>
            )}
            <StateBadge state={row.state} />
            {ownerless && (
              <span
                className="rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-fg-subtle"
                title={t("process.ownerlessHint")}
              >
                {t("process.ownerless")}
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2 text-[12px]">
            <span className="truncate-1 font-mono text-fg">{row.processName}</span>
            <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
              PID {row.pid}
            </span>
          </div>

          {(row.localAddress || path) && (
            <p
              className="truncate-1 font-mono text-[11px] text-fg-subtle"
              title={[row.localAddress, path].filter(Boolean).join("  ")}
            >
              {row.localAddress && <span>{row.localAddress}</span>}
              {row.localAddress && path && <span className="mx-1.5 opacity-40">·</span>}
              {path}
            </p>
          )}
        </div>

        {/* 右侧：终结 */}
        {!ownerless && (
          <button
            type="button"
            onClick={onKill}
            disabled={killing}
            aria-label={t("process.killAria", { name: row.processName, pid: row.pid })}
            title={t("process.kill")}
            className="mt-0.5 shrink-0 rounded-lg border border-danger/30 p-1.5 text-danger transition-colors duration-150 hover:bg-danger-soft disabled:opacity-50"
          >
            {killing ? (
              <Loader2 size={13} className="animate-spin-fast" aria-hidden />
            ) : (
              <Skull size={13} aria-hidden />
            )}
          </button>
        )}
      </div>
    </li>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-[12.5px] text-fg-subtle">
      {children}
    </div>
  );
}

/** 轻量开关：比 checkbox 更贴合窄栏布局 */
function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={title}
      className="group flex items-center gap-1.5 text-[11.5px] text-fg-muted transition-colors duration-150 hover:text-fg"
    >
      <span
        className={[
          "relative h-[15px] w-[26px] shrink-0 rounded-full border transition-colors duration-150",
          checked ? "border-accent/50 bg-accent-soft" : "border-line bg-elevated",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-[2px] size-[9px] rounded-full transition-[left,background-color] duration-150",
            checked ? "left-[14px] bg-accent" : "left-[2px] bg-fg-subtle",
          ].join(" ")}
        />
      </span>
      {label}
    </button>
  );
}
