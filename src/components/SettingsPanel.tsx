import type { ReactNode } from "react";
import { Check, Languages, Monitor, Moon, Pin, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useLocale } from "../hooks/useLocale";
import type { ThemeMode } from "../hooks/useTheme";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeMode;
  /** 当前实际生效的是否为深色（跟随系统时会随系统变化） */
  isDark: boolean;
  onThemeChange: (mode: ThemeMode) => void;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  platform: string;
}

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  labelKey: string;
  hintKey: string;
  icon: typeof Sun;
}> = [
  {
    value: "system",
    labelKey: "settings.theme.system",
    hintKey: "settings.theme.systemHint",
    icon: Monitor,
  },
  {
    value: "dark",
    labelKey: "settings.theme.dark",
    hintKey: "settings.theme.darkHint",
    icon: Moon,
  },
  {
    value: "light",
    labelKey: "settings.theme.light",
    hintKey: "settings.theme.lightHint",
    icon: Sun,
  },
];

/**
 * 设置面板。
 *
 * 只放真正生效的选项：外观主题、界面语言、窗口置顶。
 * 未实现的能力（开机自启 / 托盘 / 全局快捷键）不在这里放占位开关 ——
 * 放着不能用的开关比没有更糟。
 */
export function SettingsPanel({
  open,
  onClose,
  theme,
  isDark,
  onThemeChange,
  alwaysOnTop,
  onToggleAlwaysOnTop,
  platform,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const { locale, setLocale, locales } = useLocale();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("action.done")}
        </Button>
      }
    >
      <fieldset>
        <legend className="mb-1.5 flex w-full items-center justify-between text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
          <span>{t("settings.appearance")}</span>
          <span className="font-normal normal-case tracking-normal">
            {t("settings.currentTheme", {
              theme: isDark ? t("settings.theme.dark") : t("settings.theme.light"),
            })}
          </span>
        </legend>

        <div
          role="radiogroup"
          aria-label={t("settings.themeAria")}
          className="flex flex-col gap-1"
        >
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value;
            const Icon = opt.icon;
            return (
              <OptionRow
                key={opt.value}
                active={active}
                role="radio"
                ariaChecked={active}
                onClick={() => onThemeChange(opt.value)}
                icon={<Icon size={14} aria-hidden />}
                label={t(opt.labelKey)}
                hint={t(opt.hintKey)}
              />
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
          {t("settings.language")}
        </legend>

        <div
          role="radiogroup"
          aria-label={t("settings.languageAria")}
          className="flex flex-col gap-1"
        >
          {locales.map((item) => {
            const active = locale === item.value;
            return (
              <OptionRow
                key={item.value}
                active={active}
                role="radio"
                ariaChecked={active}
                onClick={() => setLocale(item.value)}
                icon={<Languages size={14} aria-hidden />}
                label={item.label}
              />
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase">
          {t("settings.window")}
        </legend>

        <div className="flex flex-col gap-1">
          <OptionRow
            active={alwaysOnTop}
            role="checkbox"
            ariaChecked={alwaysOnTop}
            onClick={onToggleAlwaysOnTop}
            icon={<Pin size={14} aria-hidden />}
            label={t("header.pin")}
            hint={t("settings.pinHint")}
          />
        </div>
      </fieldset>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-2.5">
        <p className="text-[11px] leading-snug text-fg-subtle">
          {t("settings.offlineNote")}
        </p>
        <p className="shrink-0 font-mono text-[11px] text-fg-subtle">{platform}</p>
      </div>
    </Dialog>
  );
}

/**
 * 单选 / 复选行。
 *
 * 单行布局：图标 + 标题 + 说明（右对齐）+ 选中勾。
 * 说明放在标题下方会让每行高出一倍 —— 6 行就是 100 多 px，
 * 在小窗口里会把整个面板顶满。改成同一行后既省高度，
 * 也让「标题」与「补充说明」的主次关系更清楚。
 *
 * 勾选位始终占位（未选中时透明），避免选中/取消时标题宽度跳动。
 */
function OptionRow({
  active,
  onClick,
  icon,
  label,
  hint,
  role,
  ariaChecked,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  hint?: string;
  role: "radio" | "checkbox";
  ariaChecked: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={ariaChecked}
      onClick={onClick}
      title={hint}
      className={[
        "flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left",
        "transition-[background-color,border-color] duration-150",
        active
          ? "border-accent/50 bg-accent-soft"
          : "border-line bg-surface hover:border-line-strong hover:bg-elevated",
      ].join(" ")}
    >
      <span className="shrink-0" aria-hidden>
        <span className={active ? "text-accent" : "text-fg-subtle"}>{icon}</span>
      </span>

      <span className={`shrink-0 text-[13px] ${active ? "text-fg" : "text-fg-muted"}`}>
        {label}
      </span>

      {hint && (
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-fg-subtle">
          {hint}
        </span>
      )}

      <Check
        size={14}
        aria-hidden
        className={`shrink-0 text-accent ${active ? "" : "invisible"}`}
      />
    </button>
  );
}
