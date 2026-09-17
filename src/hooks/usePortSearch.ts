import { useCallback, useEffect, useRef, useReducer } from "react";
import { checkPort, killProcess } from "../services/portService";
import { parsePortInput } from "../utils/port";
import { PortKillerError, toPortError } from "../types/port";
import type { PortError, PortProcess, Phase } from "../types/port";

/**
 * 端口终结的完整状态机。
 *
 *   IDLE → CHECKING → ┬→ AVAILABLE
 *                     └→ OCCUPIED → KILLING → (RECHECK)
 *                                              ├→ RELEASED
 *                                              ├→ OCCUPIED（仍有残留进程）
 *                                              └→ FAILED（终结失败，或终结后复查失败）
 *
 * 状态全部收敛在这一个 reducer 里，组件只负责渲染与派发意图。
 */

export interface PortSearchState {
  phase: Phase;
  /** 输入框原始文本 */
  input: string;
  /** 本次查询的目标端口 */
  port: number | null;
  /** 占用该端口的进程 */
  processes: PortProcess[];
  /** 结构化错误 */
  error: PortError | null;
  /** 正在被终结的 PID（按钮 loading 用） */
  killingPid: number | null;
  /** 已成功释放的端口（成功态展示用） */
  releasedPort: number | null;
}

const initialState: PortSearchState = {
  phase: "IDLE",
  input: "",
  port: null,
  processes: [],
  error: null,
  killingPid: null,
  releasedPort: null,
};

type Action =
  | { type: "INPUT_CHANGED"; value: string }
  | { type: "CHECK_STARTED"; port: number }
  | { type: "CHECK_SUCCEEDED"; processes: PortProcess[] }
  | { type: "CHECK_FAILED"; error: PortError }
  | { type: "KILL_STARTED"; pid: number }
  | { type: "KILL_RELEASED"; port: number }
  | { type: "KILL_PARTIAL"; processes: PortProcess[] }
  | { type: "KILL_FAILED"; error: PortError }
  | { type: "RESET" };

function reducer(state: PortSearchState, action: Action): PortSearchState {
  switch (action.type) {
    case "INPUT_CHANGED":
      return { ...state, input: action.value };

    case "CHECK_STARTED":
      return {
        ...state,
        phase: "CHECKING",
        port: action.port,
        processes: [],
        error: null,
        killingPid: null,
        releasedPort: null,
      };

    case "CHECK_SUCCEEDED":
      return {
        ...state,
        phase: action.processes.length > 0 ? "OCCUPIED" : "AVAILABLE",
        processes: action.processes,
        error: null,
      };

    case "CHECK_FAILED":
      return {
        ...state,
        phase: "FAILED",
        processes: [],
        error: action.error,
        killingPid: null,
      };

    case "KILL_STARTED":
      return { ...state, phase: "KILLING", killingPid: action.pid, error: null };

    case "KILL_RELEASED":
      return {
        ...state,
        phase: "RELEASED",
        processes: [],
        error: null,
        killingPid: null,
        releasedPort: action.port,
      };

    case "KILL_PARTIAL":
      return {
        ...state,
        phase: "OCCUPIED",
        processes: action.processes,
        error: null,
        killingPid: null,
      };

    case "KILL_FAILED":
      return {
        ...state,
        phase: "FAILED",
        error: action.error,
        killingPid: null,
      };

    case "RESET":
      return { ...initialState, input: state.input };
  }
}

/** 一次终结尝试的结果。调用方据此决定弹窗、Toast 与后续动作。 */
export type KillOutcome =
  | { kind: "released"; port: number }
  | { kind: "partial"; port: number; remaining: number }
  | { kind: "failed"; error: PortError };

/** 终结后等待端口释放的轮询参数（约 1.2s 窗口，覆盖系统回收 socket 的延迟） */
const RELEASE_POLL_ATTEMPTS = 8;
const RELEASE_POLL_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 端口复查结果 */
type RecheckResult =
  | { status: "released" }
  | { status: "occupied"; processes: PortProcess[] }
  | { status: "error"; error: PortError };

/** 单次复查端口占用（不做重试） */
async function probePort(port: number): Promise<RecheckResult> {
  try {
    const info = await checkPort(port);
    return info.processes.length === 0
      ? { status: "released" }
      : { status: "occupied", processes: info.processes };
  } catch (raw) {
    return { status: "error", error: toPortError(raw) };
  }
}

/**
 * 终结后复查端口，直到确认释放或到达最大尝试次数。
 *
 * 进程被终结后，操作系统回收 socket 需要一点时间；在那之前
 * `check_port` 仍可能把残留 socket 列出来。只查一次很容易在这个瞬时
 * 窗口内误判为「端口仍被占用」，进而引导用户重复终结、撞上对已退出
 * 进程的权限错误。这里带间隔重试若干次来吸收该窗口。
 *
 * killedPid 用于区分两种情况：只要残留列表里还有「刚被终结的进程」，
 * 就继续等待其 socket 被回收；一旦该进程已消失、端口却被别的进程占着，
 * 说明是真正的多进程占用，立即返回、不再等待。
 */
async function waitPortReleased(
  port: number,
  killedPid: number,
): Promise<RecheckResult> {
  let last: RecheckResult = {
    status: "error",
    error: new PortKillerError("UNKNOWN", "复查端口失败"),
  };

  for (let attempt = 0; attempt < RELEASE_POLL_ATTEMPTS; attempt++) {
    last = await probePort(port);

    if (last.status === "released") return last;

    if (
      last.status === "occupied" &&
      !last.processes.some((p) => p.pid === killedPid)
    ) {
      // 被终结的进程已被系统清理，端口却被别的进程占用 —— 无需再等
      return last;
    }

    if (attempt < RELEASE_POLL_ATTEMPTS - 1) {
      await sleep(RELEASE_POLL_INTERVAL_MS);
    }
  }

  return last;
}

export interface PortSearchApi {
  state: PortSearchState;
  setInput: (value: string) => void;
  /** 提交输入框内容；端口非法时不发请求，返回 false */
  submit: () => boolean;
  /** 直接检查某个端口（常用端口点击） */
  check: (port: number) => void;
  /** 终结进程并返回结果；force=true 走强制终结 */
  kill: (pid: number, force?: boolean) => Promise<KillOutcome>;
  /** 清空结果回到空闲态 */
  reset: () => void;
}

export function usePortSearch(): PortSearchApi {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 用于丢弃过期响应：快速连续查询时只认最后一次
  const requestId = useRef(0);

  // 终结流程需要读当前端口，但又不想让 kill 的身份随 state.port 频繁变化
  const portRef = useRef(state.port);
  useEffect(() => {
    portRef.current = state.port;
  }, [state.port]);

  const runCheck = useCallback(async (port: number) => {
    const id = ++requestId.current;
    dispatch({ type: "CHECK_STARTED", port });

    try {
      const info = await checkPort(port);
      if (id !== requestId.current) return; // 已被更新的请求取代
      dispatch({ type: "CHECK_SUCCEEDED", processes: info.processes });
    } catch (raw) {
      if (id !== requestId.current) return;
      dispatch({ type: "CHECK_FAILED", error: toPortError(raw) });
    }
  }, []);

  const check = useCallback(
    (port: number) => {
      void runCheck(port);
    },
    [runCheck],
  );

  const setInput = useCallback((value: string) => {
    dispatch({ type: "INPUT_CHANGED", value });
  }, []);

  const submit = useCallback((): boolean => {
    const parsed = parsePortInput(state.input);
    if (!parsed.ok || parsed.port === undefined) {
      if (parsed.invalid) {
        // 文案由界面按错误码渲染，这里只传结构化错误
        dispatch({
          type: "CHECK_FAILED",
          error: new PortKillerError("INVALID_PORT", `invalid input: ${state.input}`),
        });
      }
      return false;
    }
    void runCheck(parsed.port);
    return true;
  }, [state.input, runCheck]);

  const kill = useCallback(async (pid: number, force = false): Promise<KillOutcome> => {
    const port = portRef.current;
    if (port === null) {
      return {
        kind: "failed",
        error: new PortKillerError("UNKNOWN", "当前没有正在检查的端口"),
      };
    }

    dispatch({ type: "KILL_STARTED", pid });

    try {
      await killProcess(pid, force);
    } catch (raw) {
      const error = toPortError(raw);

      // 竞态兜底：本次终结报错，但进程可能已被「上一次」终结带走
      // （重复点击时进程其实已退出，对一个正在退出/已退出的进程调用
      //  系统接口会返回权限类错误）。复查一次端口，若确实已空，
      //  就按终结成功处理，避免「端口明明空了却报权限不足」的误导。
      const probe = await probePort(port);
      if (probe.status === "released") {
        dispatch({ type: "KILL_RELEASED", port });
        return { kind: "released", port };
      }

      dispatch({ type: "KILL_FAILED", error });
      return { kind: "failed", error };
    }

    // 终结成功后必须回到系统再确认一次：进程可能瞬间退出，
    // 也可能同一端口上还有别的进程。系统回收 socket 有延迟，
    // 因此这里带间隔轮询，直到端口真正空出来（或确认是别的进程占用）。
    const recheck = await waitPortReleased(port, pid);

    // 复查期间用户可能已切换端口 / 重置界面，此时只回报结果、不再改动状态
    const stillCurrent = portRef.current === port;

    if (recheck.status === "released") {
      if (stillCurrent) dispatch({ type: "KILL_RELEASED", port });
      return { kind: "released", port };
    }

    if (recheck.status === "occupied") {
      if (stillCurrent) {
        dispatch({ type: "KILL_PARTIAL", processes: recheck.processes });
      }
      return { kind: "partial", port, remaining: recheck.processes.length };
    }

    // 注意这里是「复查失败」，不是「终结失败」。
    // 进程很可能已经被终结了，我们只是无法确认端口当前状态，
    // 所以走 CHECK_FAILED（清空进程列表 → 展示错误面板 + 重新检查），
    // 而不是 KILL_FAILED —— 后者会保留旧进程列表，
    // 让界面错误地断言「端口仍被占用」。
    if (stillCurrent) dispatch({ type: "CHECK_FAILED", error: recheck.error });
    return { kind: "failed", error: recheck.error };
  }, []);

  const reset = useCallback(() => {
    requestId.current++;
    dispatch({ type: "RESET" });
  }, []);

  return { state, setInput, submit, check, kill, reset };
}
