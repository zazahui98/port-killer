import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { ArrowLeft, Loader2, RefreshCw, Search, Skull, X } from "lucide-react";
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
  /**
   * 在抽屉顶栏空白处按下时拖动窗口。
   * 抽屉盖住了标题栏右段，那部分标题栏的拖拽因此失效；
   * 把同样的拖动逻辑挂到抽屉顶栏上还原它。
   */
  onStartDrag?: (event: MouseEvent) => void;
  /**
   * 在抽屉顶栏双击时切换最大化/还原。
   * 同样因为标题栏右段被盖住，需要把双击最大化逻辑也兜过来。
   */
  onToggleMaximize?: (event: MouseEvent) => void;
}

/**
 * 端口列表抽屉。
 *
 * 从右侧滑入、占大部分宽度，左侧留一道缝并虚化露出的主界面 ——
 * 窗口只有 480px 宽，纯侧边栏会把列表压扁，全屏覆盖又丢掉空间层级，
 * 这个折中既能放下列表，又能让人看出它是从主界面上「抽出来的一层」。
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
  onStartDrag,
  onToggleMaximize,
}: PortListDrawerProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);

  const { rows, loading, error, query, setQuery, listeningOnly, setListeningOnly } =
    list;
  const { showOwnerless, setShowOwnerless, refresh, total } = list;

  /*
   * 抽屉始终挂载，只用 `open` 驱动 class 切换进场 / 退场。
   *
   * 为什么不用「挂载 + 下一帧显示」的两态方案：打开时元素是**首次挂载**，
   * 浏览器会把它的初始样式当作过渡起点，同一帧内改 class 不产生过渡，于是
   * 直接「闪」出来；而关闭时元素早已存在、样式稳定，改 class 才有过渡 ——
   * 这正是之前「收起动画正常、出来动画失效」的原因。让元素常驻、样式始终
   * 稳定，两个方向的过渡就都成立（不可见时用 pointer-events-none 断掉交互）。
   */

  // 打开时把结果拿一次
  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  // 打开时聚焦搜索框。
  // preventScroll 很关键：否则聚焦会把主界面滚动顶一下 —— 那正是「主界面弹一下」的来源。
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open]);

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

  const failure = error ? presentError(error) : null;

  return (
    <>
      {/*
        遮罩：点击即返回。半透明 + 轻微背景虚化 ——
        露出的那部分主界面被虚化压下去、层级更清楚，但仍看得出「上一级还在」，
        而不是被整块盖死。
      */}
      <button
        type="button"
        onClick={onClose}
        aria-hidden="true"
        tabIndex={-1}
        className={[
          "absolute inset-0 z-40 cursor-default bg-black/25 backdrop-blur-[3px]",
          "transition-opacity duration-300 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      />

      {/*
        抽屉面板：从右缘外滑到贴边，占大部分宽度、左侧留缝露出（已虚化的）主界面，
        这才像「抽屉」而不是整页覆盖。它盖住了标题栏，所以顶栏承接拖动与双击。
        缓动选 iOS 风格的 ease-out-quint：起步快、收尾稳，观感更优雅。

        宽度按断点分三档：端口列表是表格型内容，窗口越宽越应该给更多列位，
        否则最大化后抽屉仍是一条窄条。上限保留，避免宽屏下把主界面挤没。
      */}
      <aside
        className={[
          "absolute inset-y-0 right-0 z-40 flex w-[86%] max-w-[560px] flex-col border-l border-line bg-bg",
          "md:max-w-[720px] xl:max-w-[880px]",
          "shadow-[-16px_0_40px_-16px_rgba(0,0,0,0.4)] will-change-transform",
          "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={t("list.title")}
      >
        {/* 顶部：标题 + 返回。顶栏相当于被覆盖的标题栏，挂上拖动与双击最大化 */}
        <header
          className="shrink-0 cursor-default border-b border-line px-4 py-3"
          onMouseDown={onStartDrag}
          onDoubleClick={onToggleMaximize}
        >
          <div className="flex w-full items-center justify-between gap-3">
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
                aria-label={t("action.back")}
                title={t("action.back")}
                className="rounded-lg p-1.5 text-fg-subtle transition-colors duration-150 hover:bg-elevated hover:text-fg"
              >
                <ArrowLeft size={15} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {/* 筛选 */}
        <div className="shrink-0 border-b border-line px-4 py-2.5">
          <div className="w-full">
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
                  className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors duration-150 hover:text-danger"
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
            <ul className="flex w-full flex-col">
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
      </aside>
    </>
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

          {/*
            窄窗口下这两行上下堆叠；窗口够宽时并排。
            抽屉变宽后若仍堆叠，每行会在文字与右侧终结按钮之间留下大片空白；
            并排则把这份空间换成更完整的可执行路径，顺带压低行高。
          */}
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-3">
            <div className="flex items-baseline gap-2 text-[12px] md:min-w-0">
              <span className="truncate-1 font-mono text-fg">{row.processName}</span>
              <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                PID {row.pid}
              </span>
            </div>

            {(row.localAddress || path) && (
              <p
                className="truncate-1 font-mono text-[11px] text-fg-subtle md:min-w-0 md:flex-1"
                title={[row.localAddress, path].filter(Boolean).join("  ")}
              >
                {row.localAddress && <span>{row.localAddress}</span>}
                {row.localAddress && path && (
                  <span className="mx-1.5 opacity-40">·</span>
                )}
                {path}
              </p>
            )}
          </div>
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
