#!/usr/bin/env node
/**
 * 校验各语言文件的 key 是否与基准语言一致。
 *
 * 为什么需要它：i18next 在缺 key 时会静默回退到 fallback 语言，
 * 界面上不会报错 —— 一句英文文案漏翻了，只有用户切到英文才看得出来。
 * 这个脚本把它变成 CI 能拦住的硬失败。
 *
 * 用法：
 *   node scripts/check-i18n.mjs           # 检查
 *   node scripts/check-i18n.mjs --list    # 顺带打印基准语言的全部 key
 *
 * 退出码：0 = 一致，1 = 有差异。
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "src", "i18n", "locales");

/** 基准语言：其余语言都必须与它的 key 集合一致 */
const BASE = "zh-CN";

/**
 * 把嵌套的语言对象拍平成 `a.b.c` 形式的 key 列表。
 *
 * i18next 的复数后缀（`_one` / `_other` / `_few` …）会被归一化掉：
 * 不同语言的复数形式数量本来就不同，强行要求一致是错的。
 */
function flatten(value, prefix = "") {
  const keys = [];
  for (const [rawKey, child] of Object.entries(value)) {
    // 去掉复数后缀：`count_one` -> `count`
    const key = rawKey.replace(/_(zero|one|two|few|many|other)$/, "");
    const path = prefix ? `${prefix}.${key}` : key;

    if (child && typeof child === "object" && !Array.isArray(child)) {
      keys.push(...flatten(child, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** 取出所有插值变量名（`{{name}}` 里的 name） */
function placeholders(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

/** 按 key 路径取值，用于比对插值变量 */
function getByPath(obj, path) {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

/** 收集某个对象里所有叶子节点的 key -> 原始字符串 */
function collectStrings(value, prefix = "", out = new Map()) {
  for (const [rawKey, child] of Object.entries(value)) {
    const key = rawKey.replace(/_(zero|one|two|few|many|other)$/, "");
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      collectStrings(child, path, out);
    } else if (!out.has(path)) {
      out.set(path, child);
    }
  }
  return out;
}

async function loadLocale(file) {
  const mod = await import(new URL(`file://${join(LOCALES_DIR, file)}`));
  return mod.default;
}

async function main() {
  const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".ts"));
  const names = files.map((f) => f.replace(/\.ts$/, ""));

  if (!names.includes(BASE)) {
    console.error(`✗ 找不到基准语言文件 ${BASE}.ts`);
    process.exit(1);
  }

  const locales = {};
  for (const file of files) {
    locales[file.replace(/\.ts$/, "")] = await loadLocale(file);
  }

  const baseKeys = new Set(flatten(locales[BASE]));
  let failed = false;

  if (process.argv.includes("--list")) {
    console.log(`基准语言 ${BASE} 共 ${baseKeys.size} 个 key：`);
    for (const key of [...baseKeys].sort()) console.log(`  ${key}`);
    console.log("");
  }

  for (const name of names) {
    if (name === BASE) continue;

    const keys = new Set(flatten(locales[name]));
    const missing = [...baseKeys].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !baseKeys.has(k)).sort();

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ ${name} 与 ${BASE} 一致（${keys.size} 个 key）`);
      continue;
    }

    failed = true;
    if (missing.length > 0) {
      console.error(`✗ ${name} 缺少 ${missing.length} 个 key：`);
      for (const k of missing) console.error(`    ${k}`);
    }
    if (extra.length > 0) {
      console.error(`✗ ${name} 多出 ${extra.length} 个 key：`);
      for (const k of extra) console.error(`    ${k}`);
    }
  }

  // 插值变量也要一致：`{{count}}` 漏了会导致文案里少一个数字
  const baseStrings = collectStrings(locales[BASE]);
  for (const name of names) {
    if (name === BASE) continue;
    const strings = collectStrings(locales[name]);
    for (const [key, baseValue] of baseStrings) {
      const value = strings.get(key);
      if (value === undefined) continue;

      const expected = placeholders(baseValue);
      const actual = placeholders(value);
      if (expected.join(",") !== actual.join(",")) {
        failed = true;
        console.error(
          `✗ ${name} 的 ${key} 插值变量不一致：期望 [${expected.join(", ")}]，实际 [${actual.join(", ")}]`,
        );
      }
    }
  }

  if (failed) {
    console.error("\n语言文件不一致，请补齐后再提交。");
    process.exit(1);
  }

  console.log("\n所有语言文件一致。");
}

await main();
