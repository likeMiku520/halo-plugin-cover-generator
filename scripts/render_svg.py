"""极简 SVG 栅格化器：仅覆盖封面生成器产出的结构。

导出产物以矢量路径为主，本脚本只实现预览所需的子集
（linearGradient 背景、path、rect、circle、image 的 dataURL、text 兜底），
复杂滤镜（feTurbulence 噪点、feDropShadow 投影）按整体略过，
足以核对版式与文字位置；不追求像素级还原。
"""

import base64
import io
import math
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
NUM = re.compile(r"-?\d*\.?\d+(?:e-?\d+)?")


def parse_color(value):
    """支持 #rgb/#rrggbb/url(#id)/none/currentColor"""
    if not value or value in ("none", "transparent"):
        return None
    if value.startswith("url("):
        return "GRADIENT"
    if value.startswith("#"):
        v = value[1:]
        if len(v) == 3:
            v = "".join(c * 2 for c in v)
        try:
            return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            return None
    return None


def parse_opacity(value, default=1.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def gradient_stops(root, gid):
    """只认 linearGradient：背景层是线性的，hl/vig 等 radial 装饰层不参与填充，
    否则会被当成整屏底色盖住所有图元（初版即踩此坑）。"""
    for grad in root.iter():
        tag = grad.tag.split("}")[-1]
        if tag != "linearGradient" or grad.get("id") != gid:
            continue
        stops = []
        for stop in grad:
            color = parse_color(stop.get("stop-color", "#000000")) or (0, 0, 0)
            opacity = parse_opacity(stop.get("stop-opacity"), 1.0)
            raw = stop.get("offset", "0")
            offset = float(raw.rstrip("%")) / (100.0 if raw.endswith("%") else 1.0)
            stops.append((offset, color, opacity))
        if stops:
            return stops
    return None


def lerp(a, b, t):
    return a + (b - a) * t


def gradient_fill(size, stops):
    """沿线方向铺一层渐变：以像素级插值生成背景，避免依赖绘制库能力。"""
    w, h = size
    img = Image.new("RGB", (w, h))
    px = img.load()
    n = max(1, len(stops) - 1)
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2.0
            t = min(1.0, max(0.0, t))
            i = min(n - 1, int(t * n))
            local = (t - i / n) * n
            o0, c0, _ = stops[i]
            o1, c1, _ = stops[min(i + 1, len(stops) - 1)]
            px[x, y] = (
                int(lerp(c0[0], c1[0], local)),
                int(lerp(c0[1], c1[1], local)),
                int(lerp(c0[2], c1[2], local)),
            )
    return img


def parse_transform(value):
    """仅支持 translate/scale/matrix 组合里的平移与缩放（封面产物只用这两种）"""
    tx = ty = 0.0
    sx = sy = 1.0
    if not value:
        return tx, ty, sx, sy
    for name, args in re.findall(r"(translate|scale|matrix)\(([^)]*)\)", value):
        nums = [float(n) for n in NUM.findall(args)]
        if name == "translate":
            tx += nums[0] if nums else 0.0
            ty += nums[1] if len(nums) > 1 else 0.0
        elif name == "scale":
            sx *= nums[0] if nums else 1.0
            sy *= nums[1] if len(nums) > 1 else nums[0] if nums else 1.0
        elif name == "matrix" and len(nums) == 6:
            sx *= nums[0]
            sy *= nums[3]
            tx += nums[4]
            ty += nums[5]
    return tx, ty, sx, sy


def flatten_path(d):
    """把路径转成点列表：贝塞尔按 12 段采样，够看版式"""
    tokens = re.findall(r"[MLCQZmlcqz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    pts = []
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    i = 0
    cmd = None
    while i < len(tokens):
        tok = tokens[i]
        if re.match(r"[A-Za-z]", tok):
            cmd = tok
            i += 1
            if cmd in "Zz":
                if start:
                    pts.append(start)
                cur = start
            continue
        if cmd is None:
            i += 1
            continue
        upper = cmd.upper()
        if upper == "M":
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            cur = (x, y)
            start = cur
            pts.append(cur)
            cmd = "L" if cmd == "M" else "l"
        elif upper == "L":
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            cur = (x, y)
            pts.append(cur)
        elif upper == "C":
            x1, y1, x2, y2, x, y = (float(tokens[i + k]) for k in range(6))
            i += 6
            for s in range(1, 13):
                t = s / 12.0
                mt = 1 - t
                px = (mt ** 3) * cur[0] + 3 * (mt ** 2) * t * x1 + 3 * mt * (t ** 2) * x2 + (t ** 3) * x
                py = (mt ** 3) * cur[1] + 3 * (mt ** 2) * t * y1 + 3 * mt * (t ** 2) * y2 + (t ** 3) * y
                pts.append((px, py))
            cur = (x, y)
        elif upper == "Q":
            x1, y1, x, y = (float(tokens[i + k]) for k in range(4))
            i += 4
            for s in range(1, 13):
                t = s / 12.0
                mt = 1 - t
                px = (mt ** 2) * cur[0] + 2 * mt * t * x1 + (t ** 2) * x
                py = (mt ** 2) * cur[1] + 2 * mt * t * y1 + (t ** 2) * y
                pts.append((px, py))
            cur = (x, y)
        else:
            i += 1
    return pts


def decode_data_url(url):
    m = re.match(r"data:image/[^;]+;base64,(.*)$", url or "", re.S)
    if not m:
        return None
    try:
        img = Image.open(io.BytesIO(base64.b64decode(m.group(1))))
        # convert 会真正解码像素：占位图可能字节不完整，此处失败不应中断整张渲染
        return img.convert("RGBA")
    except Exception:
        return None


def collect(node, root, out):
    """深度优先收集可见图元，携带累积变换与不透明度"""
    tag = node.tag.split("}")[-1]
    if tag in ("defs", "clipPath", "filter", "pattern", "linearGradient", "radialGradient"):
        return
    tx, ty, sx, sy = parse_transform(node.get("transform"))
    opacity = parse_opacity(node.get("opacity"), 1.0)
    style = node.get("style", "")
    if "display:none" in style.replace(" ", ""):
        return

    def tr(x, y):
        return (tx + x * sx, ty + y * sy)

    if tag == "path":
        pts = [tr(x, y) for x, y in flatten_path(node.get("d", ""))]
        if len(pts) >= 3:
            out.append(("poly", pts, parse_color(node.get("fill")) or (255, 255, 255), opacity))
    elif tag == "rect":
        x = float(node.get("x", 0) or 0)
        y = float(node.get("y", 0) or 0)
        w = float(node.get("width", 0) or 0)
        h = float(node.get("height", 0) or 0)
        fill_attr = node.get("fill", "#000000")
        color = parse_color(fill_attr)
        if color == "GRADIENT":
            gid = re.search(r"#([^)]+)", fill_attr).group(1)
            stops = gradient_stops(root, gid)
            x0, y0 = tr(x, y)
            out.append(("grad", (x0, y0, w * sx, h * sy), stops, opacity))
        elif color and w > 0 and h > 0:
            x0, y0 = tr(x, y)
            out.append(("rect", (x0, y0, w * sx, h * sy), color, opacity))
    elif tag == "circle":
        cx = float(node.get("cx", 0) or 0)
        cy = float(node.get("cy", 0) or 0)
        r = float(node.get("r", 0) or 0)
        color = parse_color(node.get("fill"))
        if color and color != "GRADIENT" and r > 0:
            out.append(("circle", tr(cx, cy) + (r * sx,), color, opacity))
    elif tag == "image":
        href = node.get("href") or node.get(f"{{{XLINK_NS}}}href") or ""
        img = decode_data_url(href)
        if img is not None:
            x = float(node.get("x", 0) or 0)
            y = float(node.get("y", 0) or 0)
            w = float(node.get("width", 0) or 0)
            h = float(node.get("height", 0) or 0)
            x0, y0 = tr(x, y)
            out.append(("image", (x0, y0, w * sx, h * sy), img, opacity))
    elif tag == "text":
        x = float(node.get("x", 0) or 0)
        y = float(node.get("y", 0) or 0)
        size = float(node.get("font-size", 16) or 16)
        color = parse_color(node.get("fill")) or (255, 255, 255)
        out.append(("text", tr(x, y) + (size * sy,), (node.text or "").strip(), color, opacity))

    for child in node:
        collect(child, root, out)


def render(svg_path, png_path, width=None, height=None):
    tree = ET.parse(svg_path)
    root = tree.getroot()
    # 画布尺寸从 SVG 自身读取：插件支持多分辨率，写死 1200×630 会截断竖版
    if width is None:
        width = int(float(root.get("width") or 1200))
    if height is None:
        height = int(float(root.get("height") or 630))
    canvas = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas, "RGBA")

    prims = []
    collect(root, root, prims)

    for prim in prims:
        kind = prim[0]
        if kind == "grad":
            _, (x, y, w, h), stops, opacity = prim
            if stops:
                layer = gradient_fill((max(1, int(w)), max(1, int(h))), stops).convert("RGBA")
                canvas.alpha_composite(layer, (int(x), int(y)))
        elif kind == "rect":
            _, (x, y, w, h), color, opacity = prim
            draw.rectangle([x, y, x + w, y + h], fill=color + (int(255 * opacity),))
        elif kind == "poly":
            _, pts, color, opacity = prim
            draw.polygon(pts, fill=color + (int(255 * opacity),))
        elif kind == "circle":
            _, (cx, cy, r), color, opacity = prim
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (int(255 * opacity),))
        elif kind == "image":
            _, (x, y, w, h), img, opacity = prim
            resized = img.resize((max(1, int(w)), max(1, int(h))))
            if opacity < 1:
                alpha = resized.getchannel("A").point(lambda a: int(a * opacity))
                resized.putalpha(alpha)
            canvas.alpha_composite(resized, (int(x), int(y)))
        elif kind == "text":
            _, (x, y, size), text, color, opacity = prim
            if text:
                draw.text((x, y - size), text, fill=color + (int(255 * opacity),))

    canvas.convert("RGB").save(png_path)


if __name__ == "__main__":
    for name in sys.argv[1:]:
        render(f"{name}.svg", f"{name}.png")
        print("rendered", name)