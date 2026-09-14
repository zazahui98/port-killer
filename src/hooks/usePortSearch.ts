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
      dispatch({ type: "KILL_FAILED", error });
      return { kind: "failed", error };
    }

    // 终结成功后必须回到系统再确认一次：进程可能瞬间退出，
    // 也可能同一端口上还有别的进程。
    try {
      const info = await checkPort(port);
      if (info.processes.length === 0) {
        dispatch({ type: "KILL_RELEASED", port });
        return { kind: "released", port };
      }
      dispatch({ type: "KILL_PARTIAL", processes: info.processes });
      return { kind: "partial", port, remaining: info.processes.length };
    } catch (raw) {
      // 注意这里是「复查失败」，不是「终结失败」。
      // 进程很可能已经被终结了，我们只是无法确认端口当前状态，
      // 所以走 CHECK_FAILED（清空进程列表 → 展示错误面板 + 重新检查），
      // 而不是 KILL_FAILED —— 后者会保留旧进程列表，
      // 让界面错误地断言「端口仍被占用」。
      const error = toPortError(raw);
      dispatch({ type: "CHECK_FAILED", error });
      return { kind: "failed", error };
    }
  }, []);

  const reset = useCallback(() => {
    requestId.current++;
    dispatch({ type: "RESET" });
  }, []);

  return { state, setInput, submit, check, kill, reset };
}
