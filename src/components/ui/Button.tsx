import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "danger" | "dangerGhost" | "ghost";
type Size = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** 加载态时替换的文字（如「正在终结…」） */
  loadingText?: string;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  // 主操作：低饱和、克制，不做成刺眼的大红按钮
  primary: "bg-fg text-bg hover:opacity-90 active:opacity-80 disabled:opacity-40",
  danger:
    "bg-danger-soft text-danger border border-danger/35 hover:bg-danger hover:text-white hover:border-danger active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-danger-soft disabled:hover:text-danger",
  dangerGhost:
    "bg-transparent text-danger border border-transparent hover:bg-danger-soft hover:border-danger/25 disabled:opacity-40",
  ghost:
    "bg-transparent text-fg-muted border border-line hover:bg-elevated hover:text-fg disabled:opacity-40",
};

const SIZES: Record<Size, string> = {
  md: "h-10 px-4 text-[13px] rounded-[10px] gap-2",
  sm: "h-7 px-2.5 text-[12px] rounded-lg gap-1.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "ghost",
    size = "md",
    loading = false,
    loadingText,
    icon,
    block = false,
    className = "",
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex select-none items-center justify-center font-medium",
        "transition-[background-color,color,border-color,opacity,transform] duration-150",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        block ? "w-full" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (
        <Loader2
          size={size === "sm" ? 13 : 15}
          className="animate-spin-fast"
          aria-hidden
        />
      ) : (
        icon
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});
