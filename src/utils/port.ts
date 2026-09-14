/** 端口号合法范围 */
export const PORT_MIN = 1;
export const PORT_MAX = 65535;

/** 首页「常用端口」快捷入口 */
export const QUICK_PORTS = [3000, 5173, 5174, 8000, 8080, 8081, 3306, 5432] as const;

export interface ParsedPort {
  ok: boolean;
  /** 解析成功时的端口号 */
  port?: number;
  /**
   * 输入非空但不合法。
   *
   * 刻意返回标志位而不是错误文案 —— 文案由界面经 i18n 渲染，
   * 这个纯函数不该知道用户说的是哪种语言。
   */
  invalid: boolean;
}

/**
 * 解析用户输入的端口。
 *
 * 只接受纯数字（允许首尾空格），显式拒绝：
 * - 非数字（abc、3000a、3.5、+1、1e3）
 * - 超出 1–65535
 *
 * 空串不算「非法」，只是还没输完 —— 此时不该在界面上报警告。
 */
export function parsePortInput(raw: string): ParsedPort {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { ok: false, invalid: false };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, invalid: true };
  }

  // 用 Number 解析后再做整数与范围校验，避免 parseInt("12abc") 这类宽松行为
  const value = Number(trimmed);

  if (!Number.isInteger(value) || value < PORT_MIN || value > PORT_MAX) {
    return { ok: false, invalid: true };
  }

  return { ok: true, port: value, invalid: false };
}

/** 命令行的第一个 token，作为进程名兜底 */
export function commandBinary(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const first = command.trim().split(/\s+/)[0];
  if (!first) return undefined;
  // 只取路径最后一段
  const segments = first.split(/[/\\]/);
  return segments[segments.length - 1] || first;
}
