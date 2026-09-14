/**
 * 国际化入口。
 *
 * 用 i18next + react-i18next 而不是手写一套 Context：
 * 界面文案最终要支持多国语言，而复数规则（俄语 3 种、阿拉伯语 6 种）、
 * 插值转义、缺失 key 的降级策略这些硬骨头不该自己搓。
 * 桌面应用不需要下载资源，包体积不是考量因素。
 *
 * 新增语言只需两步：
 *   1. 在 `locales/` 下新建语言文件（照抄 zh-CN.ts 的结构）
 *   2. 在下面的 `LOCALES` 里注册
 * Rust 侧不受影响 —— 界面文案一律由前端按错误码渲染。
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en";
import zhCN from "./locales/zh-CN";

/** 界面语言偏好（与主题一样保存在本机） */
const STORAGE_KEY = "portkiller.locale";

/** 当前支持的语言。`label` 用该语言自己的写法，便于用户辨认。 */
export const LOCALES = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
] as const;

export type Locale = (typeof LOCALES)[number]["value"];

export const DEFAULT_LOCALE: Locale = "zh-CN";

function isSupported(value: string | null | undefined): value is Locale {
  return LOCALES.some((l) => l.value === value);
}

/**
 * 决定初始语言，优先级：本机保存的偏好 → 系统语言 → 默认值。
 *
 * `navigator.language` 形如 `zh-CN` / `en-US` / `pt-BR`，
 * 先整体匹配再退回主语言标签，这样 `en-US` 能命中 `en`。
 */
export function resolveInitialLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isSupported(saved)) return saved;

  const candidates = [navigator.language, ...(navigator.languages ?? [])].filter(
    Boolean,
  );

  for (const tag of candidates) {
    if (isSupported(tag)) return tag;
    const primary = tag.split("-")[0];
    const matched = LOCALES.find((l) => l.value.split("-")[0] === primary);
    if (matched) return matched.value;
  }

  return DEFAULT_LOCALE;
}

/** 持久化语言偏好。 */
export function persistLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
  },
  lng: resolveInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: {
    // React 本身就会转义，再转一次会把 `&` 之类的字符显示成实体
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
