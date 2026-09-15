/**
 * 平台判断。
 *
 * 用途：决定快捷键提示里显示 ⌘（macOS）还是 Ctrl（Windows / Linux）。
 * 用 `navigator` 同步判断，不依赖 Tauri 的异步平台接口，提示能立即渲染、
 * 也不会因为接口尚未返回而短暂显示错误的修饰键。
 */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;

  // 优先使用非弃用的 userAgentData（部分浏览器可能未实现）
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } })
    .userAgentData;
  const platform = uaData?.platform?.toLowerCase() ?? "";

  // userAgent 未被弃用，作为可靠回退
  const ua = navigator.userAgent?.toLowerCase() ?? "";

  return (
    /mac|iphone|ipad|ipod/.test(platform) ||
    /macintosh|mac os x|iphone|ipad|ipod/.test(ua)
  );
}
