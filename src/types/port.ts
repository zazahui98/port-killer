/**
 * 与 Rust 原生层共享的数据契约。
 *
 * 注意：Rust 侧使用 #[serde(rename_all = "camelCase")]，
 * 因此这里的字段名必须与序列化结果逐字对应。
 */

/** 端口可用性 */
export type PortStatus = "available" | "occupied" | "unknown";

/** 占用某个端口的进程 */
export interface PortProcess {
  pid: number;
  processName: string;
  port: number;
  /** "tcp" | "tcp6" | "udp" | "udp6"（同进程同时监听 v4/v6 时为 "tcp+tcp6"） */
  protocol?: string;
  /**
   * 本地绑定地址：`0.0.0.0`（所有网卡）/ `127.0.0.1`（仅本机）/ `::` / `::1`。
   * macOS 上 lsof 会给出 `*`，表示通配但无法区分 v4/v6。
   */
  localAddress?: string;
  /** 规范化后的 TCP 状态（LISTEN / ESTABLISHED / TIME_WAIT …）；UDP 无状态 */
  state?: string;
  /** 完整启动命令行；可能因权限不足而缺失 */
  command?: string;
  /** 可执行文件完整路径；可能因权限不足而缺失 */
  executablePath?: string;
  user?: string;
}

/**
 * 是否是没有归属进程的连接。
 *
 * PID 0 表示这个 socket 不属于任何用户进程 —— 常见于 TIME_WAIT 残留。
 * 界面据此标注为「无主连接」并默认隐藏，而不是给一个点了没反应的终结按钮。
 */
export function isOwnerless(process: PortProcess): boolean {
  return process.pid === 0;
}

/** 一次端口检查的完整结果 */
export interface PortInfo {
  port: number;
  status: PortStatus;
  processes: PortProcess[];
}

/* ------------------------------------------------------------------
   结构化错误 —— 前端只依赖 code 决定 UI，不解析底层系统错误文本
   ------------------------------------------------------------------ */

export type PortErrorCode =
  | "INVALID_PORT"
  | "PERMISSION_DENIED"
  | "PROCESS_NOT_FOUND"
  | "KILL_FAILED"
  | "PLATFORM_UNSUPPORTED"
  | "UNKNOWN";

export interface PortError {
  code: PortErrorCode;
  message: string;
}

/**
 * 带错误码的 Error 子类。
 *
 * 刻意继承 Error 而不是抛一个裸对象：
 * - 保留调用栈，便于排查
 * - 满足 `@typescript-eslint/only-throw-error`
 * - `instanceof Error` 的常规判断依然成立
 */
export class PortKillerError extends Error implements PortError {
  readonly code: PortErrorCode;

  constructor(code: PortErrorCode, message: string) {
    super(message);
    this.name = "PortKillerError";
    this.code = code;
  }
}

/** 原生层返回的错误无法直接 instanceof，这里做一次安全收窄 */
export function toPortError(raw: unknown): PortKillerError {
  if (raw instanceof PortKillerError) return raw;

  if (
    typeof raw === "object" &&
    raw !== null &&
    "code" in raw &&
    "message" in raw &&
    typeof (raw as PortError).code === "string"
  ) {
    const { code, message } = raw as PortError;
    return new PortKillerError(code, message);
  }

  return new PortKillerError("UNKNOWN", typeof raw === "string" ? raw : "发生未知错误");
}

/* ------------------------------------------------------------------
   界面状态机
   ------------------------------------------------------------------ */

export type Phase =
  | "IDLE" // 尚未查询
  | "CHECKING" // 正在检查端口
  | "AVAILABLE" // 端口可用
  | "OCCUPIED" // 端口被占用，展示进程列表
  | "KILLING" // 正在终结进程
  | "RELEASED" // 终结成功，端口已释放
  | "FAILED"; // 查询或终结失败

/**
 * 每个错误码对应的界面文案与可执行的补救动作。
 *
 * 文案只存 **i18n key**，不存翻译好的字符串 —— 语言切换时组件重渲染即可生效，
 * 不需要在语言变化时重新计算一遍。
 *
 * 补救动作集中在这里而不是散落在各个组件里：
 * 同一个错误码在弹窗、错误面板里应当给出完全一致的引导。
 */
export interface ErrorPresentation {
  /** 标题的 i18n key，形如 `error.PERMISSION_DENIED.title` */
  titleKey: string;
  /** 说明的 i18n key；为空表示用 `detailFallback` */
  detailKey?: string;
  /**
   * 原生层返回的原始说明。
   * 只作为 UNKNOWN 的兜底 —— 其它错误码都有确定的界面文案，
   * 不该把系统错误文本直接透给用户。
   */
  detailFallback?: string;
  /** 是否引导「使用管理员 / sudo 权限重试」 */
  suggestElevation: boolean;
  /**
   * 是否提供「强制终结」入口。
   * 只在强制真的可能奏效时给（权限不足、进程拒绝终止）；
   * 「进程已不存在」这类再强制也没有意义。
   */
  suggestForce: boolean;
}

/** 错误码 → 界面表现的映射，key 与 Rust 的 `PortError::code()` 逐字对应。 */
export function presentError(err: PortError): ErrorPresentation {
  const titleKey = `error.${err.code}.title`;
  const detailKey = `error.${err.code}.detail`;

  switch (err.code) {
    case "PERMISSION_DENIED":
    case "KILL_FAILED":
      // 这两种是「再试一次可能就成了」，给出提权引导与强制入口
      return { titleKey, detailKey, suggestElevation: true, suggestForce: true };

    case "INVALID_PORT":
    case "PROCESS_NOT_FOUND":
    case "PLATFORM_UNSUPPORTED":
      return { titleKey, detailKey, suggestElevation: false, suggestForce: false };

    default:
      return {
        titleKey,
        detailFallback: err.message,
        suggestElevation: false,
        suggestForce: false,
      };
  }
}
