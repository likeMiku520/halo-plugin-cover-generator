/** 轮廓命令的最小结构 */
export interface PathCommandLike {
  type: string
  x?: number; y?: number
  x1?: number; y1?: number; x2?: number; y2?: number
}

/** svgBuilder 依赖的最小字体能力；opentype Font 天然满足（结构兼容，规避跨文件类型视图差异） */
export interface FontLike {
  getAdvanceWidth(text: string, size: number): number
  getPath(text: string, x: number, y: number, size: number): { commands: PathCommandLike[] }
}
import type { Anchor, CanvasSize, CoverState, CustomElement, LayerKey, TextStyle, TextTarget } from './types'
import { gradientToSvgAttrs } from './gradient'
import { fitFontSize, type MeasureText } from './fitFontSize'
import { esc } from './esc'
import {
  CANVAS,
  byHeight, byWidth, customTextMaxWidth, defaultTextStyles, fullMaxWidth,
  normalizeAnchor, normalizeBackgroundScrim, normalizeRotation, normalizeTextStyle,
  scaleOf, segmentMaxWidth, watermarkMaxWidth,
  type HasSize, type SizeScale,
} from './layout'
import { readViewBox } from './svgSanitizer'
import { layoutRun, measureTracked, runRenderedWidth, type RunLayout } from './textLayout'

/** 兼容旧引用：像素基准已迁至 lib/layout.ts，此别名保留以免下游导入路径断裂 */
export const LAYOUT = CANVAS

const r2 = (n: number) => Math.round(n * 100) / 100

type AnchorAlign = 'start' | 'middle' | 'end'

/** 取某类内置文字的用户排版样式；旧档缺字段时状态层已补齐，这里只做兜底 */
function textStyleOf(state: CoverState, key: TextTarget): TextStyle {
  return normalizeTextStyle(state.textStyles?.[key], defaultTextStyles()[key])
}

/** 绕锚点旋转；角度为 0 时原样返回，不给产物加一层无意义的 <g> */
function rotateAbout(inner: string, deg: number, cx: number, cy: number): string {
  if (!inner) return ''
  const d = normalizeRotation(deg)
  if (d === 0) return inner
  return `<g transform="rotate(${r2(d)} ${r2(cx)} ${r2(cy)})">${inner}</g>`
}

/** 各元素的横向锚定方式：Logo 居中、标题居中（分缝时锚点即中缝）、水印右对齐 */
const ALIGN: Record<'logo' | 'title' | 'subtitle' | 'watermark', AnchorAlign> = {
  logo: 'middle',
  title: 'middle',
  subtitle: 'middle',
  watermark: 'end',
}

/** 渲染上下文：画布尺寸与换算系数，所有层共用，避免各自重算 */
export interface Ctx extends HasSize {
  W: number
  H: number
  s: SizeScale
}

/** 由画布尺寸构造渲染上下文（渲染层与几何层共用同一构造） */
export function makeCtx(size: CanvasSize): Ctx {
  return {
    width: size.width,
    height: size.height,
    W: size.width,
    H: size.height,
    s: scaleOf(size),
  }
}

/**
 * 文本度量：有字体时用真实字宽，无字体时按 0.55 估算。
 * 渲染与命中几何必须共用同一度量，否则选中框与图元会错位。
 */
export function createMeasure(font: FontLike | null): MeasureText {
  return font
    ? (t, sz) => font.getAdvanceWidth(t, sz)
    : (t, sz) => t.length * sz * 0.55
}

/** 比例锚点 → 画布像素坐标 */
const px = (ax: Anchor, ctx: Ctx): { x: number; y: number } => ({
  x: ax.x * ctx.W,
  y: ax.y * ctx.H,
})

export function buildCoverSvg(o: {
  state: CoverState
  font: FontLike | null
  defaultLogoDataUrl: string
}): string {
  const { state, font, defaultLogoDataUrl } = o
  const ctx: Ctx = makeCtx(state.canvas)
  const measure: MeasureText = createMeasure(font)
  const logoUrl = state.logoHidden ? null : (state.logoDataUrl || defaultLogoDataUrl || null)

  const defs = [
    gradientToSvgAttrs(state.gradient, ctx.W, ctx.H),
    // 光影层：左上高光 + 边缘暗角（objectBoundingBox 单位，随画布缩放）
    '<radialGradient id="hl" cx="0.28" cy="0.18" r="0.75">' +
    '<stop offset="0" stop-color="#fff" stop-opacity="0.38"/>' +
    '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="vig" cx="0.5" cy="0.45" r="0.9">' +
    '<stop offset="0.58" stop-color="#3c1e00" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="#3c1e00" stop-opacity="0.16"/></radialGradient>',
    // 噪点层：feTurbulence 经 feColorMatrix 压为黑色颗粒，pattern 平铺（stitchTiles 无缝）
    '<filter id="grain-f" x="0" y="0" width="160" height="160" filterUnits="userSpaceOnUse">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>' +
    '<feColorMatrix type="matrix" ' +
    'values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.7 0.7 0.7 0 0"/></filter>',
    '<pattern id="grain" width="160" height="160" patternUnits="userSpaceOnUse">' +
    '<rect width="160" height="160" filter="url(#grain-f)"/></pattern>',
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
    '<feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000" flood-opacity="0.35"/></filter>',
    // 副标题轻投影：小字号下重投影会形成明显晕圈（用户反馈），改用紧凑轻影
    '<filter id="sub-shadow" x="-20%" y="-20%" width="140%" height="140%">' +
    '<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.18"/></filter>',
    // Logo 徽章双层柔影：贴影（3/5/18%）+ 环境影（16/20/20%），仅 Logo 显示时挂载
    ...(logoUrl ? logoShadowDefs(state.layout.logo, ctx) : []),
  ]

  const body = [
    ...backgroundLayers(state, ctx),
    `<rect width="${ctx.W}" height="${ctx.H}" fill="url(#hl)"/>`,
    `<rect width="${ctx.W}" height="${ctx.H}" fill="url(#vig)"/>`,
    // 图元按图层顺序绘制：数组靠后者在上层，内置元素与自定义元素共用同一次序
    ...renderLayers(state, font, measure, ctx, logoUrl),
    // 噪点始终最上层：统一质感并消除大面积渐变的色带
    `<rect width="${ctx.W}" height="${ctx.H}" fill="url(#grain)" opacity="0.06"/>`,
  ]

  return `<svg width="${ctx.W}" height="${ctx.H}" viewBox="0 0 ${ctx.W} ${ctx.H}" ` +
    `fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n` +
    `<defs>${defs.join('')}</defs>\n${body.filter(Boolean).join('\n')}\n</svg>`
}

/**
 * 背景层。
 *
 * 渐变模式铺一层线性渐变;图片模式铺背景图后按用户设定压一层黑色遮罩——
 * 照片明暗不可控,不压暗时白色标题经常读不出来。背景图 slice 铺满画布,
 * 与自定义图片元素走同一条内嵌边界(只接受 dataURL,导出不依赖外链)。
 */
function backgroundLayers(state: CoverState, ctx: Ctx): string[] {
  if (state.backgroundMode !== 'image' || !state.backgroundImage) {
    return [`<rect width="${ctx.W}" height="${ctx.H}" fill="url(#bg)"/>`]
  }
  const image = `<image href="${esc(state.backgroundImage)}" xlink:href="${esc(state.backgroundImage)}" ` +
    `x="0" y="0" width="${ctx.W}" height="${ctx.H}" preserveAspectRatio="xMidYMid slice"/>`
  const scrim = normalizeBackgroundScrim(state.backgroundScrim)
  if (scrim <= 0) return [image]
  return [image, `<rect width="${ctx.W}" height="${ctx.H}" fill="#000" opacity="${r2(scrim / 100)}"/>`]
}

/** 按 layers 顺序产出图元；顺序表中缺失的元素补画在末尾，避免旧档升级后元素消失 */
function renderLayers(
  state: CoverState, font: FontLike | null, measure: MeasureText, ctx: Ctx, logoUrl: string | null,
): string[] {
  const render = (key: LayerKey): string => {
    switch (key) {
      case 'title':
        return titleLayer(state, font, measure, !!logoUrl, ctx)
      case 'subtitle':
        return subTitleLayer(state, font, measure, ctx)
      case 'watermark':
        return watermarkLayer(state, font, measure, ctx)
      case 'logo':
        // 投影必须作用于裁圆后的图形（外层 g filter + 内层 clip）：
        // SVG 规范中同元素 filter 先于 clip-path，直接挂 image 上会产生方形阴影边界
        return logoUrl ? logoLayer(logoUrl, state.layout.logo, ctx) : ''
      default: {
        const id = key.slice('custom:'.length)
        const el = state.customElements.find((e) => e.id === id)
        return el ? customElementLayer(el, font, measure, ctx) : ''
      }
    }
  }
  const known = new Set<string>([
    'title', 'subtitle', 'watermark', 'logo',
    ...state.customElements.map((e) => `custom:${e.id}`),
  ])
  const declared = state.layers.filter((k) => known.has(k))
  const declaredSet = new Set<string>(declared)
  const missing = [...known].filter((k) => !declaredSet.has(k)) as LayerKey[]
  return [...declared, ...missing].map(render)
}

/** Logo 的裁圆与投影定义：圆心随锚点移动，故 id 固定但几何值动态生成 */
function logoShadowDefs(ax: Anchor, ctx: Ctx): string[] {
  const a = normalizeAnchor(ax)
  const { x, y } = px(a, ctx)
  const size = logoSizeOf(a, ctx)
  return [
    '<filter id="logo-shadow" x="-25%" y="-25%" width="150%" height="150%">' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="20" result="b1"/>' +
    '<feOffset in="b1" dy="16" result="o1"/>' +
    '<feFlood flood-color="#000" flood-opacity="0.2" result="c1"/>' +
    '<feComposite in="c1" in2="o1" operator="in" result="s1"/>' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b2"/>' +
    '<feOffset in="b2" dy="3" result="o2"/>' +
    '<feFlood flood-color="#000" flood-opacity="0.18" result="c2"/>' +
    '<feComposite in="c2" in2="o2" operator="in" result="s2"/>' +
    '<feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/>' +
    '<feMergeNode in="SourceGraphic"/></feMerge></filter>',
    `<clipPath id="logo-clip"><circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(size / 2)}"/></clipPath>`,
  ]
}

/** Logo 边长：图形类尺寸按画布宽度换算 */
function logoSizeOf(a: Anchor, ctx: Ctx): number {
  return byWidth(CANVAS.LOGO_SIZE, ctx.s) * a.scale
}

// 文字排布与含字距度量已收敛到 lib/textLayout;此处转出以保持下游导入路径稳定
export { measureTracked }

/** 文本行几何：命中框与渲染共用同一份度量，保证选中框贴合图元 */
export interface LineMetrics {
  width: number
  fontSize: number
}

/** 单行文本的绘制宽度（含字距与超宽压缩），供布局层计算命中框 */
export function lineWidth(
  measure: MeasureText, s: string, fontSize: number, trackPx: number, maxW: number,
): number {
  return runRenderedWidth(measure, s, fontSize, trackPx, maxW)
}

/**
 * 按可用宽度断行。中日韩字符可任意断行；拉丁文优先在空格处断，
 * 避免把英文单词切成两半。返回每行文本。
 */
export function wrapText(
  text: string, maxWidth: number, fontSize: number, measure: MeasureText, trackPx = 0,
): string[] {
  const paragraphs = text.split('\n')
  const lines: string[] = []
  const width = (s: string) => measureTracked(measure, s, fontSize, trackPx)
  for (const para of paragraphs) {
    const chars = [...para]
    if (chars.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    let lastBreakable = -1
    for (const ch of chars) {
      const next = current + ch
      if (current !== '' && width(next) > maxWidth) {
        if (lastBreakable > 0 && /[A-Za-z0-9]/.test(ch)) {
          const head = current.slice(0, lastBreakable).trimEnd()
          const tail = current.slice(lastBreakable).trimStart()
          lines.push(head)
          current = tail + ch
        } else {
          lines.push(current)
          current = ch
        }
        lastBreakable = current.lastIndexOf(' ')
      } else {
        current = next
        if (ch === ' ') lastBreakable = current.length - 1
      }
    }
    lines.push(current)
  }
  return lines.filter((l, i, arr) => l !== '' || (i > 0 && i < arr.length - 1))
}

/**
 * 标题层。
 *
 * split 模式：锚点 x 即中缝位置，左右两段各自求齐中缝并共用一个缩放系数——
 * 两段长度不等时较短一段不再被放大（旧实现两段各自 fit，短的那段字号明显更大，
 * 是实机反馈的主要观感问题），视觉重量一致且都贴齐中缝。
 *
 * flow 模式：两段拼接为一整块，按可用宽度自动断行后在锚点处居中。
 */
function titleLayer(
  state: CoverState, font: FontLike | null,
  measure: MeasureText, hasLogo: boolean, ctx: Ctx,
): string {
  const left = state.titleLeft.trim()
  const right = state.titleRight.trim()
  const flow = state.titleFlow.trim()
  const ax = normalizeAnchor(state.layout.title)
  const { x: cx, y: baseline } = px(ax, ctx)
  // 基准字号由用户滑杆控制（100–210），自适应只在放不下时保护性缩小
  const base = Math.min(
    CANVAS.TITLE_BASE,
    Math.max(CANVAS.TITLE_MIN, state.titleFontSize),
  ) * ctx.s.h
  const minSize = CANVAS.TITLE_MIN * ctx.s.h
  const wrap = (inner: string) => (inner ? `<g filter="url(#shadow)">${inner}</g>` : '')
  const maxW = fullMaxWidth(ctx) * ax.scale
  const ts = textStyleOf(state, 'title')
  const layout: RunLayout = { curve: ts.curve, direction: ts.direction }
  const vertical = ts.direction === 'vertical'
  // 竖排沿纵向堆叠,横向宽度预算不再适用:置 0 表示不压缩,列高由字号决定
  const budget = vertical ? 0 : maxW
  const trackOf = (fs: number) => fs * ts.tracking
  /** 收尾:先加投影,再绕锚点整体旋转 */
  const finish = (inner: string) => rotateAbout(wrap(inner), ts.rotation, cx, baseline)
  // 两种排版各有独立文本：整块模式只看 titleFlow，分缝模式只看左右两段
  const hasText = state.titleMode === 'flow' ? !!flow : !!(left || right)

  if (!hasText) {
    // 占位(仅预览态可见;导出按钮在 UI 层因空标题禁用)。降透明度以免
    // 与真实封面混淆——首跑用户此前看到的是一张"已完成"的封面(A5)
    const phSize = byHeight(160, ctx.s)
    const ph = layoutRun(
      font, '标题标题', cx, baseline, phSize, trackOf(phSize),
      '#ffffff', 'middle', true, budget, layout,
    )
    return finish(`<g opacity="0.4">${ph}</g>`)
  }

  if (state.titleMode === 'flow') {
    // 竖排不做横向断行:每行都会变成一列,断行只会得到一排并列的短列
    const lines = vertical ? flow.split('\n') : wrapText(flow, maxW, base, measure)
    const lineHeight = Math.round(base * 1.18)
    // 整块以锚点为竖直中心：行数增加时向上向下对称展开
    const firstBaseline = baseline - ((lines.length - 1) * lineHeight) / 2
    const rendered = lines
      .map((line, i) => layoutRun(
        font, line, cx, firstBaseline + i * lineHeight, base, trackOf(base),
        '#ffffff', 'middle', true, budget, layout,
      ))
      .join('')
    return finish(rendered)
  }

  if (!hasLogo) {
    // 无 Logo：两段拼接为一行整体居中；放不下时压缩到可用宽度
    const joined = `${left}${right}`
    const { fontSize } = vertical
      ? { fontSize: base }
      : fitFontSize(joined, maxW, { base, min: minSize }, measure)
    return finish(layoutRun(
      font, joined, cx, baseline, fontSize, trackOf(fontSize),
      '#ffffff', 'middle', true, budget, layout,
    ))
  }

  // 有 Logo：左右分缝。两段共用一个缩放系数且字号一致——
  // 旧实现各自 fit，短的那段反而字号更大，两段视觉重量失衡（实机反馈的主因）。
  // 系数取几何平均而非直接取小：单侧很长时（长段可达三四倍）一并取小会把
  // 短的那段压得几乎看不见，几何平均兼顾「看起来一样大」与「两边都还读得清」。
  const segMax = segmentMaxWidth(ctx) * ax.scale
  const scaleOfText = (s: string) => {
    if (!s) return 1
    const w = measure(s, base)
    return w <= segMax ? 1 : segMax / w
  }
  // 字号不低于下限时允许的最大缩放；超出部分改由水平压缩吸收。
  // 旧实现用 Math.max(min/base, shared) 把压缩一并顶掉，长段会直接冲出画布
  const minSizeScale = minSize / base
  const factors = ([left, right].filter(Boolean) as string[]).map(scaleOfText)
  const shared = factors.length <= 1
    ? (factors[0] ?? 1)
    : Math.sqrt(factors.reduce((a, b) => a * b, 1))
  const clamped = Math.min(1, Math.max(minSizeScale, shared))
  // 竖排两段各成一列,列宽与段宽无关:不参与那套横向缩放
  const size = vertical ? base : Math.max(minSize, Math.round(base * clamped))
  // 字号被下限截住后，剩余比例转为水平压缩，两段因此仍严格不超单侧可用宽度
  const compress = vertical ? 1 : (clamped > 0 ? clamped / (size / base) : 1)
  const segBudget = vertical ? 0 : segMax
  const half = byWidth(state.seamGap, ctx.s) / 2
  const leftText = left
    ? layoutRun(font, left, cx - half, baseline, size, trackOf(size),
        '#ffffff', 'end', true, segBudget, layout, compress)
    : ''
  const rightText = right
    ? layoutRun(font, right, cx + half, baseline, size, trackOf(size),
        '#ffffff', 'start', true, segBudget, layout, compress)
    : ''
  return finish(leftText + rightText)
}

/**
 * 标题命中几何：与 titleLayer 使用同一套缩放规则计算字号与段宽。
 *
 * 抽出来的原因是命中框必须贴合图元：旧实现给标题硬编码了一个 0.28 宽度的方框，
 * 长标题会明显超出框外，且与文字不在同一水平线上。
 */
export interface TitleGeometry {
  fontSize: number
  /** 分缝模式下由中缝向外的半宽（含 SEAM_GAP/2），flow 模式为 0 */
  seamHalf: number
  leftWidth: number
  rightWidth: number
  /** 整体横向跨度（以锚点为中心） */
  totalWidth: number
  lineHeight: number
  lineCount: number
}

export function titleGeometry(
  state: CoverState, measure: MeasureText, ctx: Ctx,
): TitleGeometry | null {
  const left = state.titleLeft.trim()
  const right = state.titleRight.trim()
  const flow = state.titleFlow.trim()
  const hasText = state.titleMode === 'flow' ? !!flow : !!(left || right)
  if (!hasText) return null
  const ax = normalizeAnchor(state.layout.title)
  const base = Math.min(CANVAS.TITLE_BASE, Math.max(CANVAS.TITLE_MIN, state.titleFontSize)) * ctx.s.h
  const minSize = CANVAS.TITLE_MIN * ctx.s.h
  const maxW = fullMaxWidth(ctx) * ax.scale

  if (state.titleMode === 'flow') {
    const lines = wrapText(flow, maxW, base, measure)
    return {
      fontSize: base,
      seamHalf: 0,
      leftWidth: 0,
      rightWidth: 0,
      totalWidth: Math.min(maxW, Math.max(...lines.map((l) => measure(l, base)), 0)),
      lineHeight: Math.round(base * 1.18),
      lineCount: Math.max(1, lines.length),
    }
  }

  if (state.logoHidden) {
    const joined = `${left}${right}`
    const { fontSize } = fitFontSize(joined, maxW, { base, min: minSize }, measure)
    return {
      fontSize,
      seamHalf: 0, leftWidth: 0, rightWidth: 0,
      totalWidth: Math.min(maxW, measure(joined, fontSize)),
      lineHeight: Math.round(fontSize * 1.18),
      lineCount: 1,
    }
  }

  const segMax = segmentMaxWidth(ctx) * ax.scale
  const scaleOfText = (s: string) => {
    if (!s) return 1
    const w = measure(s, base)
    return w <= segMax ? 1 : segMax / w
  }
  const minSizeScale = minSize / base
  const factors = ([left, right].filter(Boolean) as string[]).map(scaleOfText)
  const shared = factors.length <= 1
    ? (factors[0] ?? 1)
    : Math.sqrt(factors.reduce((a, b) => a * b, 1))
  const clamped = Math.min(1, Math.max(minSizeScale, shared))
  const fontSize = Math.max(minSize, Math.round(base * clamped))
  // 与 titleLayer 同源：字号被下限截住后，剩余比例转为水平压缩
  const compress = clamped > 0 ? clamped / (fontSize / base) : 1
  const segHalf = byWidth(state.seamGap, ctx.s) / 2
  const leftWidth = left ? measure(left, fontSize) * compress : 0
  const rightWidth = right ? measure(right, fontSize) * compress : 0
  return {
    fontSize,
    seamHalf: segHalf,
    leftWidth,
    rightWidth,
    totalWidth: segHalf * 2 + leftWidth + rightWidth,
    lineHeight: Math.round(fontSize * 1.18),
    lineCount: 1,
  }
}

function subTitleLayer(
  state: CoverState, font: FontLike | null, measure: MeasureText, ctx: Ctx,
): string {
  const sub = state.subtitle.trim()
  if (!sub) return ''
  const ax = normalizeAnchor(state.layout.subtitle)
  const { x: cx, y: baseline } = px(ax, ctx)
  const ts = textStyleOf(state, 'subtitle')
  const layout: RunLayout = { curve: ts.curve, direction: ts.direction }
  const vertical = ts.direction === 'vertical'
  const lineW = byWidth(CANVAS.SUB_LINE_W, ctx.s)
  const lineGap = byWidth(CANVAS.SUB_LINE_GAP, ctx.s)
  // 两侧装饰线占位后，文字实际可用宽度收窄；竖排是单列，不需要为侧线让位
  const textMax = vertical ? 0 : (fullMaxWidth(ctx) - 2 * (lineW + lineGap)) * ax.scale
  const trackPxOf = (sz: number) => sz * ts.tracking
  const mTracked = (t: string, sz: number) => measureTracked(measure, t, sz, trackPxOf(sz))
  // 竖排没有横向预算可言，字号直接取基准（大小仍由元素面板掌握）
  const { fontSize } = vertical
    ? { fontSize: byHeight(CANVAS.SUB_BASE, ctx.s) }
    : fitFontSize(sub, textMax,
        { base: byHeight(CANVAS.SUB_BASE, ctx.s), min: byHeight(CANVAS.SUB_MIN, ctx.s) }, mTracked)
  const text = layoutRun(font, sub, cx, baseline, fontSize, trackPxOf(fontSize),
    '#ffffff', 'middle', true, textMax, layout)
  // 装饰线只在横排出现：竖排是一列字，两侧横线会横穿列身
  const sideLines = vertical ? '' : (() => {
    // 被压缩时装饰线必须贴压缩后的实际宽，否则跑出画布
    const renderedW = runRenderedWidth(measure, sub, fontSize, trackPxOf(fontSize), textMax)
    const lineY = baseline - Math.round(fontSize * 0.32)
    const line = (lx: number) =>
      `<rect x="${r2(lx)}" y="${r2(lineY)}" width="${r2(lineW)}" height="2" ` +
      `rx="1" fill="#fff"/>`
    return `<g opacity="0.55">` +
      line(cx - renderedW / 2 - lineGap - lineW) +
      line(cx + renderedW / 2 + lineGap) +
      `</g>`
  })()
  // 文字带轻投影；装饰线不进投影组（2px 细线会被投影糊出明显边缘）
  return rotateAbout(
    `<g filter="url(#sub-shadow)" opacity="0.9">${text}</g>${sideLines}`,
    ts.rotation, cx, baseline,
  )
}

/** Logo 层：按锚点定位与缩放，圆形裁剪 + 双层柔影 */
function logoLayer(url: string, ax: Anchor, ctx: Ctx): string {
  const a = normalizeAnchor(ax)
  const { x, y } = px(a, ctx)
  const size = logoSizeOf(a, ctx)
  return `<g filter="url(#logo-shadow)"><image href="${esc(url)}" xlink:href="${esc(url)}" ` +
    `x="${r2(x - size / 2)}" y="${r2(y - size / 2)}" ` +
    `width="${r2(size)}" height="${r2(size)}" ` +
    `clip-path="url(#logo-clip)"/></g>`
}

/** 域名水印：白色 65%，带字距，无投影；超宽时与标题/副标题一致整体压缩 */
function watermarkLayer(
  state: CoverState, font: FontLike | null, measure: MeasureText, ctx: Ctx,
): string {
  const wm = state.watermark.trim()
  if (!wm) return ''
  const ax = normalizeAnchor(state.layout.watermark)
  const { x, y } = px(ax, ctx)
  const ts = textStyleOf(state, 'watermark')
  const layout: RunLayout = { curve: ts.curve, direction: ts.direction }
  const size = Math.max(12, Math.round(byHeight(CANVAS.WM_SIZE, ctx.s) * ax.scale))
  const trackPx = size * ts.tracking
  // 竖排按纵向堆叠，横向宽度预算不适用
  const maxW = ts.direction === 'vertical' ? 0 : watermarkMaxWidth(ctx) * ax.scale
  const text = layoutRun(font, wm, x, y, size, trackPx,
    '#ffffff', ALIGN.watermark, true, maxW, layout)
  return rotateAbout(`<g opacity="0.65">${text}</g>`, ts.rotation, x, y)
}

/** 元素实际尺寸：文字按字号、图形按边长，命中框与渲染共用此换算 */
export function customElementSize(el: CustomElement, ctx: { s: SizeScale }): number {
  return el.kind === 'text'
    ? Math.max(10, Math.round(byHeight(el.size, ctx.s) * el.anchor.scale))
    : Math.max(8, byWidth(el.size, ctx.s) * el.anchor.scale)
}

function customElementLayer(
  el: CustomElement, font: FontLike | null, measure: MeasureText, ctx: Ctx,
): string {
  const a = normalizeAnchor(el.anchor)
  const { x, y } = px(a, ctx)
  if (el.kind === 'text') {
    const text = el.text.trim()
    if (!text) return ''
    const size = customElementSize(el, ctx)
    const trackPx = size * el.tracking
    const maxW = customTextMaxWidth(ctx) * a.scale
    const lines = wrapText(text, maxW, size, measure, trackPx)
    const lineHeight = Math.round(size * 1.18)
    const firstBaseline = y - ((lines.length - 1) * lineHeight) / 2
    const body = lines
      .map((line, i) => layoutRun(
        font, line, x, firstBaseline + i * lineHeight, size, trackPx, el.color, 'middle', el.bold, maxW,
      ))
      .join('')
    return `<g>${body}</g>`
  }

  const size = customElementSize(el, ctx)
  const clipDefs = el.round
    ? `<defs><clipPath id="ce-clip-${esc(el.id)}">` +
      `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(size / 2)}"/></clipPath></defs>`
    : ''
  const cp = el.round ? ` clip-path="url(#ce-clip-${esc(el.id)})"` : ''

  if (el.kind === 'image') {
    if (!el.content) return ''
    return clipDefs + `<image href="${esc(el.content)}" xlink:href="${esc(el.content)}" ` +
      `x="${r2(x - size / 2)}" y="${r2(y - size / 2)}" ` +
      `width="${r2(size)}" height="${r2(size)}" preserveAspectRatio="xMidYMid slice"${cp}/>`
  }

  // svg 图标：录入时已过白名单；此处按 viewBox 等比缩放到目标尺寸，
  // 缩放系数取 size 与 viewBox 较长边的比值，非方形图标不会被拉伸变形
  const markup = el.content.trim()
  if (!markup) return ''
  const [vx, vy, vw, vh] = readViewBox(markup)
  const inner = markup.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '')
  const scale = size / Math.max(vw, vh)
  const offsetX = -vx - vw / 2
  const offsetY = -vy - vh / 2
  // color 是 color 属性的呈现属性,标记里的 currentColor 由它解析:
  // 图标按 currentColor 入库,颜色因此是渲染期输入,改色无需重取标记
  return clipDefs + `<g color="${esc(el.color)}" transform="translate(${r2(x)} ${r2(y)}) scale(${r2(scale)}) ` +
    `translate(${r2(offsetX)} ${r2(offsetY)})"${cp}>${inner}</g>`
}