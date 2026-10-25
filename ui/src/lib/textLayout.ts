import { pathToD } from './fontLoader'
import { esc } from './esc'
import type { MeasureText } from './fitFontSize'

/** 轮廓命令的最小结构(与 svgBuilder 的同名结构逐字段一致) */
interface PathCommandLike {
  type: string
  x?: number; y?: number
  x1?: number; y1?: number; x2?: number; y2?: number
}

/**
 * 排版所需的最小字体能力。
 *
 * 与 svgBuilder 的 FontLike 逐字段一致,因此结构类型互相兼容;
 * 在本模块另行声明是为了让排版引擎不反向依赖渲染层(避免循环引用)。
 */
export interface TextFont {
  getAdvanceWidth(text: string, size: number): number
  getPath(text: string, x: number, y: number, size: number): { commands: PathCommandLike[] }
}

/**
 * 文字排版引擎:标题 / 副标题 / 水印 / 自定义文字共用同一套排布。
 *
 * 先前这里有两份等价实现(layoutLine 与 pathTextTracked/fallbackTextTracked),
 * 只差颜色参数与压缩语义,新增排布方式时必须同时改两处,于是收敛到本模块。
 *
 * 三种排布:
 * - 直线(默认):整段合成一条 path,输出与历史版本逐字一致;
 * - 圆弧:逐字给出自己的旋转与位移,只能一个字一条 path;
 * - 竖排:逐字沿 y 堆叠,仍可合成一条 path(位置直接写进各自的字形坐标)。
 */

export type TextDirection = 'horizontal' | 'vertical'

/** 一段文字的排布方式 */
export interface RunLayout {
  /** 弯曲度 -100–100:0 为直线,正负决定弧向(正=向上拱)。仅横排生效 */
  curve: number
  direction: TextDirection
}

export const STRAIGHT: RunLayout = { curve: 0, direction: 'horizontal' }

/** 弯曲度满值对应的圆心角(度):±100 → ±120° */
export const CURVE_MAX_SWEEP = 120

/** 竖排的字符步进(相对字号),与横排字号同基准 */
const VERTICAL_STEP = 1

/** 弯曲度小于该值视为直线:避免半径趋于无穷时的数值抖动 */
const CURVE_EPSILON = 1

/** 全角字符区间(CJK / 全角标点 / 谚文):无字体时按 1em 估宽 */
const WIDE_CHAR =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

/** 无字体时的字宽估算:全角 1em、半角 0.55em(仅供降级路径排布,不参与度量) */
export function estimateAdvance(char: string, fontSize: number): number {
  return fontSize * (WIDE_CHAR.test(char) ? 1 : 0.55)
}

/** 含字距的宽度度量:∑字宽 + 字距×(字数−1) */
export function measureTracked(
  measure: MeasureText, s: string, fontSize: number, trackPx: number,
): number {
  const n = [...s].length
  return measure(s, fontSize) + trackPx * Math.max(0, n - 1)
}

/** 单字在该段中的横向占位 */
interface GlyphAdvance {
  char: string
  advance: number
  /** 该字左边缘相对整段起点的偏移 */
  offset: number
}

function advancesOf(
  font: TextFont | null, chars: string[], fontSize: number, trackPx: number,
): GlyphAdvance[] {
  const out: GlyphAdvance[] = []
  let cursor = 0
  for (const char of chars) {
    const advance = font ? font.getAdvanceWidth(char, fontSize) : estimateAdvance(char, fontSize)
    out.push({ char, advance, offset: cursor })
    cursor += advance + trackPx
  }
  return out
}

/** 整段在未压缩坐标下的宽度:∑字宽 + 字距×(字数−1) */
function runWidthOf(glyphs: GlyphAdvance[]): number {
  const last = glyphs[glyphs.length - 1]
  return last ? last.offset + last.advance : 0
}

export type AnchorAlign = 'start' | 'middle' | 'end'

/**
 * 一段文字压缩后的实际绘制宽度(与 layoutRun 同一套规则)。
 * 命中框与副标题装饰线都要用它,否则会与图元错位。
 */
export function runRenderedWidth(
  measure: MeasureText, s: string, fontSize: number, trackPx: number, maxW: number, extraScale = 1,
): number {
  const w = measureTracked(measure, s, fontSize, trackPx)
  return w * fitScale(w, maxW) * extraScale
}

/** 超宽时整体水平压缩的系数;不超宽(或没给宽度预算)为 1 */
function fitScale(w: number, maxW: number): number {
  return maxW > 0 && w > maxW ? maxW / w : 1
}

/** 按锚点对齐:返回整段左边缘的 x(未压缩坐标系) */
function alignedLeft(x: number, width: number, anchor: AnchorAlign): number {
  if (anchor === 'end') return x - width
  if (anchor === 'middle') return x - width / 2
  return x
}

/**
 * 竖排:逐字沿 y 堆叠,列的水平中心落在 x、垂直中心落在 y。
 * 竖排不做压缩——纵向预算与横向预算不是同一个量,横排那套 fit 在这里没有意义,
 * 字号由用户的大小滑杆掌握。
 */
function layoutVertical(
  font: TextFont | null, glyphs: GlyphAdvance[], x: number, y: number,
  fontSize: number, trackPx: number, color: string, bold: boolean,
): string {
  const step = fontSize * VERTICAL_STEP + trackPx
  const total = step * Math.max(0, glyphs.length - 1)
  const startY = y - total / 2
  if (font) {
    let d = ''
    glyphs.forEach((g, i) => {
      d += pathToD(font.getPath(g.char, x - g.advance / 2, startY + i * step, fontSize))
    })
    return `<path d="${d}" fill="${esc(color)}"/>`
  }
  const weight = bold ? 'bold' : 'normal'
  return glyphs
    .map((g, i) =>
      `<text x="${r2(x)}" y="${r2(startY + i * step)}" font-family="sans-serif" ` +
      `font-weight="${weight}" font-size="${fontSize}" fill="${esc(color)}" ` +
      `text-anchor="middle">${esc(g.char)}</text>`)
    .join('')
}

/**
 * 圆弧:把整段贴到一段圆弧上,每个字再按切线方向自转。
 *
 * 半径由「弧长 = 整段宽度」反解(R = W/|φ|),因此弯曲度只决定张开的角度,
 * 字号与字距怎么改都不会让弧长与文字长度脱节。整段的中点始终落在基线 (x, y),
 * 两端随弧向抬起或垂下。
 */
function layoutArc(
  font: TextFont | null, glyphs: GlyphAdvance[], x: number, y: number,
  fontSize: number, trackPx: number, color: string, bold: boolean,
  anchor: AnchorAlign, maxW: number, extraScale: number, sweep: number,
): string {
  const w = runWidthOf(glyphs)
  const sx = fitScale(w, maxW) * extraScale
  const effW = w * sx
  const left = alignedLeft(x, effW, anchor)
  const radius = effW / Math.abs(sweep)
  const weight = bold ? 'bold' : 'normal'
  return glyphs
    .map((g) => {
      // 字心在整段中的相对位置(-0.5..0.5)→ 弧上的角度
      const center = (g.offset + g.advance / 2) * sx
      const angle = ((center - effW / 2) / effW) * sweep
      const px = left + effW / 2 + radius * Math.sin(angle)
      // 弧向由 sweep 的符号决定:半径取了绝对值,垂直偏移必须补回符号,
      // 否则负弯曲只会翻转水平方向、仍然向上拱
      const py = y + Math.sign(sweep) * radius * (1 - Math.cos(angle))
      const tf = `translate(${r2(px)} ${r2(py)}) rotate(${r2((angle * 180) / Math.PI)}) ` +
        `translate(${r2((-g.advance * sx) / 2)} 0)` +
        (sx !== 1 ? ` scale(${r4(sx)} 1)` : '')
      if (font) {
        return `<path transform="${tf}" d="${pathToD(font.getPath(g.char, 0, 0, fontSize))}" ` +
          `fill="${esc(color)}"/>`
      }
      return `<text transform="${tf}" font-family="sans-serif" font-weight="${weight}" ` +
        `font-size="${fontSize}" fill="${esc(color)}" text-anchor="middle">${esc(g.char)}</text>`
    })
    .join('')
}

/**
 * 排布一段文字。
 *
 * @param maxW       可用宽度;超出时整段水平压缩(竖排不使用)
 * @param extraScale 额外水平压缩系数(分缝模式两段共用,字号已按该系数缩过)
 */
export function layoutRun(
  font: TextFont | null, s: string, x: number, y: number,
  fontSize: number, trackPx: number, color: string,
  anchor: AnchorAlign, bold: boolean, maxW: number,
  layout: RunLayout = STRAIGHT, extraScale = 1,
): string {
  const chars = [...s]
  if (!chars.length) return ''

  if (layout.direction === 'vertical') {
    return layoutVertical(font, advancesOf(font, chars, fontSize, trackPx), x, y,
      fontSize, trackPx, color, bold)
  }

  const glyphs = advancesOf(font, chars, fontSize, trackPx)
  const sweep = (Math.min(100, Math.max(-100, layout.curve)) / 100) * CURVE_MAX_SWEEP * (Math.PI / 180)
  if (Math.abs(layout.curve) >= CURVE_EPSILON) {
    return layoutArc(font, glyphs, x, y, fontSize, trackPx, color, bold, anchor, maxW, extraScale, sweep)
  }

  const w = runWidthOf(glyphs)
  const sx = fitScale(w, maxW) * extraScale
  const left = alignedLeft(x, w * sx, anchor)

  if (font) {
    let d = ''
    for (const g of glyphs) {
      d += pathToD(font.getPath(g.char, g.offset, y, fontSize))
    }
    const tf = `translate(${r2(left)} 0)` + (sx !== 1 ? ` scale(${r4(sx)} 1)` : '')
    return `<path transform="${tf}" d="${d}" fill="${esc(color)}"/>`
  }

  const weight = bold ? 'bold' : 'normal'
  // 降级版用原生 letter-spacing;被压缩时以 textLength 交给渲染器拉伸
  const tl = sx !== 1 ? ` textLength="${r2(w * sx)}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<text x="${r2(left)}" y="${r2(y)}" font-family="sans-serif" font-weight="${weight}" ` +
    `font-size="${fontSize}" letter-spacing="${r2(trackPx)}" fill="${esc(color)}" ` +
    `text-anchor="start"${tl}>${esc(s)}</text>`
}