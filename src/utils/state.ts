/**
 * TCP 状态的展示映射。
 *
 * 状态的**名字**由 Rust 侧规范化后给出（见 `src-tauri/src/platform/state.rs`），
 * 前端只负责决定用什么色调呈现 —— 两边的状态名必须一致。
 */

/** 状态对应的视觉分组 */
export type StateTone = "listen" | "active" | "closing" | "idle";

/**
 * 把状态映射到色调分组。
 *
 * 分组依据是「用户看到它该有什么反应」：
 * - listen：有人在监听，这就是「端口被占用」的元凶 → 醒目
 * - active：有活动连接，端口确实在干活 → 次醒目
 * - closing：正在收尾，通常稍后自己就消失了 → 提示色
 * - idle：其余（CLOSED 等）→ 弱化
 */
export function stateTone(state: string): StateTone {
  switch (state.toUpperCase()) {
    case "LISTEN":
      return "listen";
    case "ESTABLISHED":
    case "SYN_SENT":
    case "SYN_RECEIVED":
      return "active";
    case "CLOSE_WAIT":
    case "CLOSING":
    case "LAST_ACK":
    case "FIN_WAIT_1":
    case "FIN_WAIT_2":
    case "TIME_WAIT":
      return "closing";
    default:
      return "idle";
  }
}

/** 是否属于「有人在监听」。与 Rust 侧 `state::is_listening` 语义一致。 */
export function isListening(state?: string): boolean {
  // 没有状态（UDP，或平台未提供）也算「占用」——
  // 否则 UDP 端口会从默认视图里消失
  return state === undefined || state.toUpperCase() === "LISTEN";
}
