import { useTranslation } from "react-i18next";

import { QUICK_PORTS } from "../utils/port";

interface QuickPortsProps {
  /** 当前正在查询的端口，用于高亮 */
  activePort: number | null;
  onPick: (port: number) => void;
  disabled?: boolean;
}

/**
 * 常用端口快捷入口。
 * 刻意做得非常轻量：小尺寸 pill，不与主输入框争夺注意力。
 */
export function QuickPorts({ activePort, onPick, disabled }: QuickPortsProps) {
  const { t } = useTranslation();

  return (
    <section className="px-5" aria-labelledby="quick-ports-label">
      <h2
        id="quick-ports-label"
        className="mb-2 text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase"
      >
        {t("quickPorts.title")}
      </h2>

      {/*
        一行排开。
        桌面端窗口宽 480px，去掉左右内边距后只剩 ~440px。
        px-2.5 + 4 位数字 + border ≈ 51px/pill，8 个会溢出 ~10px；
        改成 px-2 后 ≈ 47px/pill，总宽 ≈ 418px，留 ~22px 余量，
        既能容下当前 8 个，也给未来再加 1-2 个留空间。
      */}
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {QUICK_PORTS.map((port) => {
          const active = activePort === port;
          return (
            <button
              key={port}
              type="button"
              disabled={disabled}
              onClick={() => onPick(port)}
              aria-label={t("quickPorts.check", { port })}
              aria-pressed={active}
              className={[
                "h-7 shrink-0 rounded-lg border px-2 font-mono text-[12px]",
                "transition-[background-color,color,border-color,transform] duration-150",
                "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
                active
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line bg-surface text-fg-muted hover:border-line-strong hover:bg-elevated hover:text-fg",
              ].join(" ")}
            >
              {port}
            </button>
          );
        })}
      </div>
    </section>
  );
}
