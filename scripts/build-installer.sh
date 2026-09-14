#!/usr/bin/env bash
#
# 构建 Windows 安装包（NSIS）。
#
# 为什么需要这个脚本：
#   tauri-bundler 首次打包会从 GitHub Releases 下载 NSIS / WiX 工具链。
#   受限网络下 GitHub 取不到实际资源（只有拦截代理返回的 302），第三方
#   GitHub 镜像传大文件又容易断，于是打包这一步会一直失败。
#
#   这里换一条可靠的路：
#     - NSIS 本体改从 SourceForge 的官方发布取（不经过 GitHub）。
#       经比对，官方 zip 与 tauri 期望的哈希完全一致，因此可以严格校验。
#     - nsis_tauri_utils.dll 只有 34KB，走 GitHub 镜像取得到，并校验 sha1。
#     - 直接铺进 bundler 的缓存目录，bundler 便跳过下载。
#
#   MSI 仍然需要 WiX，而 WiX 只发布在 GitHub 上，本环境取不到；
#   因此 Windows 的 bundle 目标在 tauri.windows.conf.json 里声明为 nsis。
#   面向开发者的单用户安装，NSIS 也是更合适的形式。
#
# 用法：
#   bash scripts/build-installer.sh                 # 出安装包
#   bash scripts/build-installer.sh --no-bundle     # 只出可执行文件
#   bash scripts/build-installer.sh --bundles nsis  # 显式指定目标
#
# 如果所在网络能直连 GitHub，直接用 `npm run tauri:build` 即可，不需要本脚本。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------- 前置检查

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ;;
  *)
    echo "本脚本只用于 Windows 打包；其他平台直接跑 npm run tauri:build 即可。" >&2
    exit 1
    ;;
esac

if [ -z "${LOCALAPPDATA:-}" ]; then
  echo "找不到 LOCALAPPDATA，无法定位 bundler 的工具链缓存目录。" >&2
  exit 1
fi

TAR="/c/Windows/System32/tar.exe"
[ -x "$TAR" ] || { echo "缺少 $TAR（Windows 10+ 自带），无法解压。" >&2; exit 1; }

NSIS_DIR="$LOCALAPPDATA/tauri/NSIS"
# 下载物默认落在项目的 .cache/ 下；可用 BUNDLER_TOOLS_CACHE 指到别处，
# 便于在干净目录里复现「首次打包」的完整流程。
CACHE="${BUNDLER_TOOLS_CACHE:-$ROOT/.cache/bundler-tools}"
mkdir -p "$CACHE"

# 官方 NSIS 3.11 发布包，哈希与 tauri-bundler 期望值逐字相同
NSIS_URL="https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip"
NSIS_SHA1="ef7ff767e5cbd9edd22add3a32c9b8f4500bb10d"

# tauri 的 NSIS 插件，用于查找/结束占用安装目录的进程
UTILS_REL="tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll"
UTILS_SHA1="75197fee3c6a814fe035788d1c34ead39349b860"
MIRRORS=("https://ghproxy.net" "https://gh-proxy.com")

# ---------------------------------------------------------------- 下载与校验

# 校验一个文件；不存在或哈希不符都算失败。
# $1=文件  $2=期望 sha1（大小写不敏感）
verify() {
  local file="$1" want="$2"
  [ -f "$file" ] || return 1
  want="$(printf '%s' "$want" | tr 'A-Z' 'a-z')"
  [ "$(sha1sum "$file" | cut -d' ' -f1)" = "$want" ]
}

# 带多轮重试的下载：镜像断连是常态，单次失败必须能自愈。
# 刻意不用 -C - 续传：镜像可能忽略 Range 头返回 200，
# curl 会把整个响应追加到已有分片后面，拼出哈希对不上的文件。
# $1=输出文件  $2=sha1  $3=可读名称  $4...=候选 URL
fetch_verified() {
  local out="$1" want="$2" label="$3"
  shift 3
  local urls=("$@")

  if verify "$out" "$want"; then
    echo "  [cached] $label"
    return 0
  fi

  local round url
  for round in 1 2 3 4 5; do
    for url in "${urls[@]}"; do
      echo "  [fetch ] $label (round $round)"
      rm -f "$out"
      # 输出路径必须转成 Windows 形式：curl 是原生程序，写不了 MSYS 风格的
      # 绝对路径 —— 路径里含非 ASCII 字符（比如中文目录名）时会直接以
      # 「client returned ERROR on write」失败，且报错信息完全不提路径。
      # 网络抖动则表现为 18/56 传输中断，同样按可重试处理。
      curl -sSL --retry 3 --retry-delay 2 -m 600 \
        -o "$(cygpath -w "$out")" "$url" || true
      if verify "$out" "$want"; then
        echo "  [ok    ] $label ($(stat -c%s "$out") bytes)"
        return 0
      fi
      echo "  [retry ] 未取到完整文件"
    done
  done

  rm -f "$out"
  echo "  [FAIL  ] $label 多次重试仍失败" >&2
  return 1
}

# ---------------------------------------------------------------- 1. NSIS 本体

echo "==> 准备 NSIS 工具链（缓存目录 $NSIS_DIR）"
if [ -x "$NSIS_DIR/makensis.exe" ]; then
  echo "  [cached] NSIS 已就位"
else
  fetch_verified "$CACHE/nsis-3.11.zip" "$NSIS_SHA1" "nsis-3.11.zip (SourceForge)" "$NSIS_URL"

  echo "  [unzip ] 解压到 $NSIS_DIR"
  mkdir -p "$NSIS_DIR"
  # 用 mktemp 拿一个干净的临时目录，省掉一次可能失败的预清理
  tmp="$(mktemp -d)"
  # bsdtar（Windows 自带）能直接解 zip；两个路径都要换成本地形式
  "$TAR" -xf "$(cygpath -w "$CACHE/nsis-3.11.zip")" -C "$(cygpath -w "$tmp")"
  # 去掉压缩包里的顶层 nsis-3.11/ 目录，让 makensis.exe 直接落在 NSIS/ 下
  inner="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$inner" ] || { echo "解压结果不符合预期" >&2; exit 1; }
  cp -r "$inner"/. "$NSIS_DIR"/
  rm -rf "$tmp" 2>/dev/null || true
fi

# ---------------------------------------------------------------- 2. NSIS 插件

echo "==> 准备 nsis_tauri_utils.dll"
urls=()
for mirror in "${MIRRORS[@]}"; do
  urls+=("$mirror/https://github.com/$UTILS_REL")
done
if ! fetch_verified "$CACHE/nsis_tauri_utils.dll" "$UTILS_SHA1" "nsis_tauri_utils.dll" "${urls[@]}"; then
  echo "无法获取 nsis_tauri_utils.dll。" >&2
  echo "可在能访问 GitHub 的网络下先跑一次本脚本，或手动把该文件放到：" >&2
  echo "  $CACHE/nsis_tauri_utils.dll" >&2
  exit 1
fi

# bundler 在生成安装脚本时会引用这个插件，两个候选位置都放一份更稳妥
for sub in "Plugins/x86-unicode" "Plugins/x86-unicode/additional"; do
  mkdir -p "$NSIS_DIR/$sub"
  cp "$CACHE/nsis_tauri_utils.dll" "$NSIS_DIR/$sub/"
done
echo "  [ok    ] 插件已放置"

# ---------------------------------------------------------------- 3. 打包

echo "==> 开始打包"
cd "$ROOT"

# 本机 ~/.cargo/bin 下的 rustc 可能是坏 shim，优先用 rustup 的真实工具链
if [ -d "$HOME/.rustup/toolchains" ]; then
  real_tc="$(find "$HOME/.rustup/toolchains" -maxdepth 1 -mindepth 1 -type d | head -1)"
  [ -n "$real_tc" ] && export PATH="$real_tc/bin:$PATH"
fi
export CARGO_CACHE_AUTO_CLEAN_FREQUENCY="${CARGO_CACHE_AUTO_CLEAN_FREQUENCY:-never}"

npx tauri build "$@"
