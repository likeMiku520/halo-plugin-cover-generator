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
 * - 竖排:逐字沿 y 堆叠,一列排满可用高度后换列(按中文竖排的行序自右向左),
 *   仍可合成一条 path(位置直接写进各自的字形坐标)。
 *
 * 换行的边界量按方向分工:横排给 maxW(超出则整段压扁),竖排给 maxH(超出则换列)。
 * 两者都是「调用方算好的可用空间」,本模块因此不需要知道画布尺寸。
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

/**
 * 合成加粗。
 *
 * 内置字体只有一档字重(本身就是粗体),把字转成路径之后 `font-weight` 完全无效——
 * 这正是「自定义文字元素加粗没反应」的原因。改为沿轮廓加一圈同色描边:
 * stroke 以轮廓为中心向内外各扩 w/2,视觉上就是笔画变粗。
 * 系数取字号的比例,换字号时粗细观感保持一致。
 */
function boldAttrs(fontSize: number, color: string, bold: boolean): string {
  if (!bold) return ''
  const w = Math.round(fontSize * 0.035 * 100) / 100
  return ` stroke="${esc(color)}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`
}

/** 按锚点对齐:返回整段左边缘的 x(未压缩坐标系) */
function alignedLeft(x: number, width: number, anchor: AnchorAlign): number {
  if (anchor === 'end') return x - width
  if (anchor === 'middle') return x - width / 2
  return x
}

/** 竖排的逐字步进:列内每下一个字下移这么多(字高 + 字距) */
export function verticalStep(fontSize: number, trackPx: number): number {
  return fontSize * VERTICAL_STEP + trackPx
}

/**
 * 竖排的列距(相邻两列列心之间的距离)。
 *
 * 列宽取字号——竖排里一个字的占位就是 1em,与字体给出的字宽无关;
 * 列间距复用字距:竖排里「字距」本就是字与字之间的呼吸,横过来正好是列与列之间的呼吸,
 * 多列排版因此不需要再引入一个用户没见过的参数(面板上也没有它的位置)。
 * 负字距只收紧列内步进:若它也收紧列距,两列会挤到笔画重叠、整块读不出来。
 */
export function verticalColumnStep(fontSize: number, trackPx: number): number {
  return fontSize + Math.max(0, trackPx)
}

/**
 * 竖排分列:一列排满可用高度后另起一列。
 *
 * maxH <= 0 表示不限高——与横排 maxW = 0 的「不压缩」同一语义,
 * 也是调用方没给高度预算时的默认行为(单列,与历史输出一致)。
 * 文本里的 \n 按强制换列处理:竖排里「换行」与「换列」本就是同一件事。
 * 空行不产生空列——那一列只有空白,读不出内容也量不出高度。
 *
 * 返回逐列的字序数组,渲染与命中几何共用它,免得两处各算一套换列位置。
 */
export function verticalColumns(
  s: string, fontSize: number, trackPx: number, maxH: number,
): string[][] {
  const step = verticalStep(fontSize, trackPx)
  // 容量按「列高 = 步进 × 字数」计,与命中几何同一口径:一列因此永不高于可用高度。
  // step <= 0 只可能来自畸形字号/字距,此时退回不限高,避免按 0 除出无意义的列数。
  const per = maxH > 0 && step > 0 ? Math.max(1, Math.floor(maxH / step)) : 0
  const columns: string[][] = []
  for (const para of s.split('\n')) {
    const chars = [...para]
    if (!chars.length) continue
    if (per <= 0) {
      columns.push(chars)
      continue
    }
    for (let i = 0; i < chars.length; i += per) columns.push(chars.slice(i, i + per))
  }
  return columns
}

/**
 * 竖排:逐字沿 y 堆叠,一列排满可用高度后换列,整块的水平中心落在 x、垂直中心落在 y。
 *
 * 换列方向取「自右向左」:中文竖排的行序是自上而下、自右向左,首列贴在整个列阵的最右,
 * 后续各列依次向左展开(横排的从左到右,在竖排里对应的就是从上到下)。
 * 整块以锚点为心:列阵在 x 上左右对称、各列齐头(顶端对齐),最高的一列在 y 上居中。
 * 单列时列心正好等于 x、列内也不偏移,因此「一列放得下」的输出仍与历史版本逐字节一致。
 *
 * 竖排不做压缩——纵向预算与横向预算不是同一个量,横排那套按宽度缩字号的 fit 在这里没有意义;
 * 排不下时的处理是换列,而不是把字压扁。
 */
function layoutVertical(
  font: TextFont | null, s: string, x: number, y: number, fontSize: number,
  trackPx: number, color: string, bold: boolean, maxH: number,
): string {
  const columns = verticalColumns(s, fontSize, trackPx, maxH)
  if (!columns.length) return ''
  const step = verticalStep(fontSize, trackPx)
  const colStep = verticalColumnStep(fontSize, trackPx)
  const count = columns.length
  const tallest = Math.max(...columns.map((c) => c.length))
  const startY = y - (step * (tallest - 1)) / 2
  // 列心:第 0 列(整段开头)在最右,越靠后的列越往左
  const centerX = (i: number) => x + ((count - 1) / 2 - i) * colStep
  if (font) {
    let d = ''
    columns.forEach((col, c) => {
      const cx = centerX(c)
      col.forEach((char, i) => {
        // 逐字按自己的字宽水平居中在列心上:字宽只在列内起作用,列距与它无关
        const advance = font.getAdvanceWidth(char, fontSize)
        d += pathToD(font.getPath(char, cx - advance / 2, startY + i * step, fontSize))
      })
    })
    return `<path d="${d}" fill="${esc(color)}"${boldAttrs(fontSize, color, bold)}/>`
  }
  const weight = bold ? 'bold' : 'normal'
  return columns
    .map((col, c) => col
      .map((char, i) =>
        `<text x="${r2(centerX(c))}" y="${r2(startY + i * step)}" font-family="sans-serif" ` +
        `font-weight="${weight}" font-size="${fontSize}" fill="${esc(color)}" ` +
        `text-anchor="middle">${esc(char)}</text>`)
      .join(''))
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
          `fill="${esc(color)}"${boldAttrs(fontSize, color, bold)}/>`
      }
      return `<text transform="${tf}" font-family="sans-serif" font-weight="${weight}" ` +
        `font-size="${fontSize}" fill="${esc(color)}" text-anchor="middle">${esc(g.char)}</text>`
    })
    .join('')
}

/**
 * 排布一段文字。
 *
 * @param maxW       可用宽度;超出时整段水平压缩(仅横排)
 * @param maxH       可用高度;超出时换列(仅竖排)
 * @param extraScale 额外水平压缩系数(分缝模式两段共用,字号已按该系数缩过)
 */
export function layoutRun(
  font: TextFont | null, s: string, x: number, y: number,
  fontSize: number, trackPx: number, color: string,
  anchor: AnchorAlign, bold: boolean, maxW: number, maxH: number,
  layout: RunLayout = STRAIGHT, extraScale = 1,
): string {
  const chars = [...s]
  if (!chars.length) return ''

  if (layout.direction === 'vertical') {
    return layoutVertical(font, s, x, y, fontSize, trackPx, color, bold, maxH)
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
    return `<path transform="${tf}" d="${d}" fill="${esc(color)}"${boldAttrs(fontSize, color, bold)}/>`
  }

  const weight = bold ? 'bold' : 'normal'
  // 降级版用原生 letter-spacing;被压缩时以 textLength 交给渲染器拉伸
  const tl = sx !== 1 ? ` textLength="${r2(w * sx)}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<text x="${r2(left)}" y="${r2(y)}" font-family="sans-serif" font-weight="${weight}" ` +
    `font-size="${fontSize}" letter-spacing="${r2(trackPx)}" fill="${esc(color)}" ` +
    `text-anchor="start"${tl}>${esc(s)}</text>`
}