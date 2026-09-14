#!/usr/bin/env python3
"""生成应用图标源图（1024x1024 PNG）。

为什么不用现成的图标文件：
图标属于设计资产，仓库里放一份「可复现的生成脚本 + 产物」比只放一个
二进制文件更容易维护和审查。修改配色或形状后重跑本脚本即可。

本机没有 Pillow / numpy，所以这里直接手写 PNG 编码（zlib + struct），
并用有符号距离场（SDF）做抗锯齿 —— 只依赖标准库。

用法：
    python scripts/generate-icon.py [输出路径]
默认输出到 src-tauri/icons/source.png，之后用 `npx tauri icon` 派生各平台图标。
"""

from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024

# 圆角方块：四周留白 10%，圆角半径约为边长的 22%
INSET = 100
RADIUS = 200

# 闪电形状（Feather "zap" 的 24x24 路径，M13 2 L3 14 h9 l-1 8 10-12 h-9 l1-8 z）
BOLT = [(13.0, 2.0), (3.0, 14.0), (12.0, 14.0), (11.0, 22.0), (21.0, 10.0), (12.0, 10.0)]

# 配色：蓝色底 + 近黑闪电。深色底图标在深色任务栏里会糊成一团，
# 所以这里反过来用高饱和蓝做底，保证 16px 下依然可辨识。
BG_TOP = (0x6E, 0xA8, 0xFE)
BG_BOTTOM = (0x3E, 0x7B, 0xEF)
BOLT_COLOR = (0x0B, 0x0C, 0x0E)

# 闪电占画布的最大边比例
BOLT_RATIO = 0.46


def clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def rounded_rect_sdf(px: float, py: float) -> float:
    """圆角方块的有符号距离：<0 在内部，>0 在外部。"""
    cx = cy = SIZE / 2.0
    half_w = (SIZE - 2 * INSET) / 2.0
    half_h = (SIZE - 2 * INSET) / 2.0

    qx = abs(px - cx) - (half_w - RADIUS)
    qy = abs(py - cy) - (half_h - RADIUS)

    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - RADIUS


def segment_distance(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    t = clamp01(((px - ax) * dx + (py - ay) * dy) / length_sq)
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def point_in_polygon(px, py, pts) -> bool:
    """射线法判断点是否在多边形内部。"""
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > py) != (yj > py):
            x_cross = (xj - xi) * (py - yi) / (yj - yi) + xi
            if px < x_cross:
                inside = not inside
        j = i
    return inside


def polygon_sdf(px, py, pts) -> float:
    nearest = min(
        segment_distance(px, py, pts[i][0], pts[i][1], pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1])
        for i in range(len(pts))
    )
    return -nearest if point_in_polygon(px, py, pts) else nearest


def build_bolt() -> list[tuple[float, float]]:
    """把 24x24 坐标系的闪电等比缩放并居中到画布。"""
    xs = [p[0] for p in BOLT]
    ys = [p[1] for p in BOLT]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = (BOLT_RATIO * SIZE) / extent
    return [(SIZE / 2.0 + (x - cx) * scale, SIZE / 2.0 + (y - cy) * scale) for x, y in BOLT]


def render() -> bytes:
    """返回 PNG 的原始像素数据（每行前置 filter byte 0）。"""
    bolt = build_bolt()
    bolt_xs = [p[0] for p in bolt]
    bolt_ys = [p[1] for p in bolt]
    bx0, bx1 = min(bolt_xs), max(bolt_xs)
    by0, by1 = min(bolt_ys), max(bolt_ys)

    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type: None
        py = y + 0.5

        # 底色随纵向渐变，给图标一点体积感
        t = y / (SIZE - 1)
        bg_r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
        bg_g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
        bg_b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t

        in_bolt_band = by0 - 1.0 <= py <= by1 + 1.0

        for x in range(SIZE):
            px = x + 0.5

            # 圆角方块的覆盖率（1px 过渡带近似抗锯齿）
            cov_bg = clamp01(0.5 - rounded_rect_sdf(px, py))
            if cov_bg <= 0.0:
                raw += b"\x00\x00\x00\x00"
                continue

            cov_bolt = 0.0
            if in_bolt_band and bx0 - 1.0 <= px <= bx1 + 1.0:
                cov_bolt = clamp01(0.5 - polygon_sdf(px, py, bolt))

            r = bg_r + (BOLT_COLOR[0] - bg_r) * cov_bolt
            g = bg_g + (BOLT_COLOR[1] - bg_g) * cov_bolt
            b = bg_b + (BOLT_COLOR[2] - bg_b) * cov_bolt

            raw += bytes((int(r + 0.5), int(g + 0.5), int(b + 0.5), int(cov_bg * 255 + 0.5)))

    return bytes(raw)


def chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def encode_png(raw: bytes) -> bytes:
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("src-tauri/icons/source.png")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encode_png(render()))
    print(f"icon source written: {target} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
