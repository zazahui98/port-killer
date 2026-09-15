import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { applyTheme, readStoredTheme } from "./utils/theme";
import { tryWindowCall } from "./utils/window";
// 副作用导入：初始化 i18next 并绑定 React。必须在渲染之前完成，
// 否则首帧会先渲染出 key 本身再被替换成文案。
import i18n from "./i18n";
import "./styles.css";

// 首帧渲染前应用主题，避免深/浅色闪烁。
// 放在 import 之后、createRoot 之前 —— CSS 此时已加载完成。
applyTheme(readStoredTheme());

// 让 `lang` 与当前界面语言保持一致：屏幕阅读器靠它选择发音，
// 浏览器的断行 / 标点规则也依赖它。
function syncDocumentLang(locale: string) {
  document.documentElement.lang = locale;
}
syncDocumentLang(i18n.language);
i18n.on("languageChanged", syncDocumentLang);

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载点，index.html 可能被修改过");
}

// 桌面应用不需要浏览器的右键菜单与拖拽行为
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  // 输入框保留右键菜单，方便粘贴
  if (target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") {
    e.preventDefault();
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);

/**
 * 首帧画完后再显示窗口。
 *
 * 窗口在 `tauri.conf.json` 里是 `visible: false`。因为 WebView2 初始化、
 * 加载 JS、React 挂载都需要时间，若窗口一开始就可见，用户会先看到一个
 * 只有底色、没有任何内容的空窗口。
 *
 * 用**双 rAF**：第一个在 React 提交 DOM 之后触发，第二个才是浏览器真正
 * 绘制完一帧的时刻。只等一个 rAF 仍可能在窗口显示时内容还没上屏。
 *
 * 失败时静默忽略 —— Rust 侧还有超时兜底（见 `lib.rs`），
 * 不会出现窗口永远不显示的情况。
 */
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    tryWindowCall((win) => win.show());
  });
});
