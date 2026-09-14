import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { LOCALES, persistLocale, type Locale } from "../i18n";

export interface LocaleApi {
  /** 当前界面语言 */
  locale: Locale;
  /** 切换语言并持久化偏好 */
  setLocale: (locale: Locale) => void;
  /** 可选语言列表 */
  locales: typeof LOCALES;
}

/**
 * 界面语言的读写。
 *
 * 切换时同步写入 localStorage —— 与主题一样，这属于「用户偏好」，
 * 不是需要维护与清理的累积状态（对比：查询历史已经按需求移除）。
 */
export function useLocale(): LocaleApi {
  const { i18n } = useTranslation();

  const setLocale = useCallback(
    (locale: Locale) => {
      persistLocale(locale);
      void i18n.changeLanguage(locale);
    },
    [i18n],
  );

  return { locale: i18n.language as Locale, setLocale, locales: LOCALES };
}
