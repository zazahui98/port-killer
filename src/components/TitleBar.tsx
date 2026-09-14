import type { ReactNode } from "react";
import {
  List,
  Maximize2,
  Minimize2,
  Minus,
  Pin,
  PinOff,
  Settings,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { WindowChromeApi } from "../hooks/useWindowChrome";

interface TitleBarProps {
  chrome: WindowChromeApi;
  onOpenSettings: () => void;
  onOpenList: () => void;
  listActive: boolean;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
}

/**
 * 自绘标题栏。
 *
 * 窗口是 `decorations: false`，所以这一行同时承担三件事：
 *   1. 拖拽区（空白处按下拖窗、双击最大化，与系统标题栏一致）
 *   2. 应用级入口（端口列表 / 置顶 / 设置）
 *   3. 窗口控制（最小化 / 最大化 / 关闭）
 *
 * 合并成一行而不是「系统标题栏 + 应用 Header」两行：后者会重复显示应用名，
 * 且两行加起来约 92px，占掉 480×620 窗口的 15%。
 *
 * 整个组件都用主题令牌着色，所以会跟随应用主题 —— 这正是自绘的理由，
 * 系统标题栏只会跟随操作系统外观。
 */
export function TitleBar({
  chrome,
  onOpenSettings,
  onOpenList,
  listActive,
  alwaysOnTop,
  onToggleAlwaysOnTop,
}: TitleBarProps) {
  const { t } = useTranslation();

  return (
    <header
      className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface pr-1 pl-3 select-none"
      onMouseDown={chrome.startDrag}
      onDoubleClick={chrome.toggleMaximizeOnDoubleClick}
    >
      {/* 应用标识 */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent-soft"
          aria-hidden
        >
          <Zap size={11} className="text-accent" />
        </span>
        <span className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-fg">
          {t("app.name")}
        </span>
      </div>

      {/* 应用级入口 */}
      <div className="ml-auto flex items-center gap-0.5">
        <BarButton
          label={t("list.title")}
          onClick={onOpenList}
          active={listActive}
          icon={<List size={14} aria-hidden />}
        />
        <BarButton
          label={alwaysOnTop ? t("header.unpin") : t("header.pin")}
          onClick={onToggleAlwaysOnTop}
          active={alwaysOnTop}
          icon={
            alwaysOnTop ? (
              <Pin size={14} aria-hidden />
            ) : (
              <PinOff size={14} aria-hidden />
            )
          }
        />
        <BarButton
          label={t("header.settings")}
          onClick={onOpenSettings}
          icon={<Settings size={14} aria-hidden />}
        />
      </div>

      {/* 分隔线：把「应用功能」与「窗口控制」分开，避免误点关闭 */}
      <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />

      {/* 窗口控制 */}
      <div className="flex items-center">
        <WindowButton
          label={t("window.minimize")}
          onClick={chrome.minimize}
          icon={<Minus size={14} aria-hidden />}
        />
        <WindowButton
          label={chrome.maximized ? t("window.restore") : t("window.maximize")}
          onClick={chrome.toggleMaximize}
          icon={
            chrome.maximized ? (
              <Minimize2 size={12} aria-hidden />
            ) : (
              <Maximize2 size={12} aria-hidden />
            )
          }
        />
        <WindowButton
          label={t("window.close")}
          onClick={chrome.close}
          danger
          icon={<X size={14} aria-hidden />}
        />
      </div>
    </header>
  );
}

/** 应用级入口按钮：选中态用强调色，未选中保持安静 */
function BarButton({
  label,
  onClick,
  icon,
  active = false,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={[
        "rounded-md p-1.5 transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent"
          : "text-fg-subtle hover:bg-elevated hover:text-fg",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}

/** 窗口控制按钮：关闭按钮悬停时用危险色，与系统标题栏一致 */
function WindowButton({
  label,
  onClick,
  icon,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        "grid size-7 place-items-center rounded-md transition-colors duration-150",
        danger
          ? "text-fg-subtle hover:bg-danger hover:text-white"
          : "text-fg-subtle hover:bg-elevated hover:text-fg",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}
