import { invoke } from "@tauri-apps/api/core";
import {
  PortKillerError,
  toPortError,
  type PortInfo,
  type PortProcess,
} from "../types/port";
import { PORT_MAX, PORT_MIN } from "../utils/port";

/**
 * 前端与 Rust 原生层之间的唯一通道。
 *
 * 安全约定：
 * - 前端只传递「数字」，绝不拼接任何命令字符串。
 * - 所有参数在送入 IPC 之前先做一次范围校验（纵深防御），
 *   Rust 侧还会再校验一次，两侧都不信任对方。
 * - 原生层不会把 PID 或端口拼进 shell，全部走系统 API。
 */

/** 原生层抛出的错误统一是 { code, message } 结构 */
async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (raw) {
    throw toPortError(raw);
  }
}

/**
 * 这里的 message 只用于开发期排查 —— 界面文案由错误码经 i18n 渲染，
 * 因此刻意写成与语言无关的英文，避免代码里散落未翻译的中文。
 */
function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new PortKillerError("INVALID_PORT", `port out of range: ${port}`);
  }
}

function assertPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new PortKillerError("PROCESS_NOT_FOUND", `invalid pid: ${pid}`);
  }
}

/** 检查端口占用情况（首页主流程使用） */
export async function checkPort(port: number): Promise<PortInfo> {
  assertPort(port);
  return call<PortInfo>("check_port", { port });
}

/**
 * 列出本机全部端口占用（端口列表视图使用）。
 *
 * 返回的是**已聚合**的行：同一「协议 + 端口 + PID」的多条 socket 合并为一条。
 * 只看监听 / 显示 UDP 由调用方按 `state` 过滤，切换视图不需要重新查询。
 */
export async function listPorts(): Promise<PortProcess[]> {
  return call<PortProcess[]>("list_ports", {});
}

/**
 * 终结进程。
 *
 * @param force true 时使用「强制终结」（Windows: 直接 TerminateProcess；
 *              Unix: SIGKILL）。默认 false（Unix 发 SIGTERM，先礼后兵）。
 */
export async function killProcess(pid: number, force = false): Promise<void> {
  assertPid(pid);
  return call<void>("kill_process", { pid, force });
}

/** 当前平台标识，用于在 UI 上展示平台差异（如权限提示措辞） */
export async function getPlatform(): Promise<string> {
  return call<string>("platform_info", {});
}
