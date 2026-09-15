import { forwardRef, useId, type KeyboardEvent } from "react";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PORT_MAX, PORT_MIN } from "../utils/port";

interface PortInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 点击清除叉号时清空输入 */
  onClear?: () => void;
  /** 校验错误文案（为空表示无错误） */
  error?: string;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * 主输入框 —— 整个界面的视觉焦点。
 *
 * 只允许输入数字（其余字符在 onChange 阶段就被过滤掉，
 * 从源头保证不会把奇怪的内容送进 IPC）。
 */
export const PortInput = forwardRef<HTMLInputElement, PortInputProps>(
  function PortInput(
    { value, onChange, onSubmit, onClear, error, loading = false, disabled },
    ref,
  ) {
    const inputId = useId();
    const errorId = useId();
    const { t } = useTranslation();

    function handleChange(next: string) {
      // 允许清空；否则只保留数字，且长度不超过 5 位
      const digitsOnly = next.replace(/\D/g, "").slice(0, 5);
      onChange(digitsOnly);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      }
    }

    const invalid = Boolean(error);

    return (
      <div className="px-5">
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-[11px] font-medium tracking-[0.06em] text-fg-subtle uppercase"
        >
          {t("input.label")}
        </label>

        <div
          className={[
            "group relative flex h-[54px] items-center rounded-[var(--radius-field)]",
            "border bg-surface transition-[border-color,box-shadow,background-color] duration-200",
            invalid
              ? "border-danger/60 shadow-[0_0_0_3px_var(--pk-danger-soft)]"
              : "border-line focus-within:border-accent/70 focus-within:shadow-[0_0_0_3px_var(--pk-accent-soft)]",
          ].join(" ")}
        >
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={disabled}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("input.placeholder")}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className={[
              "h-full w-full min-w-0 bg-transparent px-4 font-mono text-[20px] tracking-[0.01em]",
              "text-fg placeholder:font-sans placeholder:text-[14px] placeholder:tracking-normal placeholder:text-fg-subtle",
              "outline-none disabled:opacity-50",
            ].join(" ")}
          />

          <div className="flex shrink-0 items-center gap-2 pr-3.5">
            {loading && (
              <Loader2
                size={15}
                className="animate-spin-fast text-fg-subtle"
                aria-hidden
              />
            )}
            {/* 清除叉号：有内容时才出现，鼠标悬停变红（与端口列表一致） */}
            {value && !loading && onClear && (
              <button
                type="button"
                onClick={onClear}
                aria-label={t("action.clear")}
                className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors duration-150 hover:text-danger"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* 错误提示占位高度固定，避免布局跳动 */}
        <p
          id={errorId}
          role={invalid ? "alert" : undefined}
          className={[
            "mt-1.5 min-h-[16px] text-[11.5px] transition-opacity duration-150",
            invalid ? "text-danger opacity-100" : "opacity-0",
          ].join(" ")}
        >
          {error || t("input.hint", { min: PORT_MIN, max: PORT_MAX })}
        </p>
      </div>
    );
  },
);
