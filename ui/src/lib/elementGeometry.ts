import type { Anchor, CoverState, CustomElement } from './types'
import type { MeasureText } from './fitFontSize'
import {
  CANVAS, SUB_TRACK, WM_TRACK,
  byHeight, byWidth, customTextMaxWidth, normalizeAnchor, watermarkMaxWidth,
} from './layout'
import { type Ctx, customElementSize, lineWidth, measureTracked, titleGeometry, wrapText } from './svgBuilder'
import { readViewBox } from './svgSanitizer'

/**
 * 元素在画布上的实际几何（像素）。
 *
 * 命中框、选中框与渲染必须共用这一份计算：任何一处自己估算，
 * 都会出现「框和内容对不上、不在同一水平线」的问题。
 * 所有数值都经 svgBuilder 的同一批换算函数得出。
 */
export interface ElementBox {
  id: string
  label: string
  /** 包围盒（画布像素坐标） */
  x: number
  y: number
  width: number
  height: number
  /** 纵向中心（像素）：用于把选中框对齐到图元的实际视觉中线 */
  centerY: number
}

export interface CustomBox extends ElementBox {
  elementId: string
}

function boxOfText(
  id: string, label: string, ax: Anchor, x: number, baseline: number,
  width: number, fontSize: number, lineCount = 1, lineHeight = 0,
): ElementBox {
  const lh = lineHeight || Math.round(fontSize * 1.18)
  const firstBaseline = baseline - ((lineCount - 1) * lh) / 2
  // 基线到视觉顶/底的经验比例：字形主体大致落在基线上方 0.78em、下方 0.2em
  const top = firstBaseline - fontSize * 0.78
  const bottom = firstBaseline + (lineCount - 1) * lh + fontSize * 0.2
  return {
    id,
    label,
    x: x - width / 2,
    y: top,
    width,
    height: bottom - top,
    centerY: (top + bottom) / 2,
  }
}

/** 内置四元素的命中几何；未启用（隐藏/为空）的元素不出现在结果中 */
export function builtinBoxes(
  state: CoverState, measure: MeasureText, ctx: Ctx, hasLogo: boolean,
): ElementBox[] {
  const boxes: ElementBox[] = []
  const layout = state.layout

  if (hasLogo && !state.logoHidden) {
    const a = normalizeAnchor(layout.logo)
    const size = byWidth(CANVAS.LOGO_SIZE, ctx.s) * a.scale
    boxes.push({
      id: 'logo', label: 'Logo',
      x: a.x * ctx.W - size / 2,
      y: a.y * ctx.H - size / 2,
      width: size, height: size,
      centerY: a.y * ctx.H,
    })
  }

  const title = titleGeometry(state, measure, ctx)
  if (title) {
    const a = normalizeAnchor(layout.title)
    const cx = a.x * ctx.W
    const baseline = a.y * ctx.H
    if (state.titleMode === 'flow' || state.logoHidden) {
      boxes.push(boxOfText(
        'title', '标题', a, cx, baseline, title.totalWidth, title.fontSize,
        title.lineCount, title.lineHeight,
      ))
    } else {
      // 分缝模式两侧各自命中：分别贴合自己那一段，便于单独拖动并保持中缝对齐
      const left = state.titleLeft.trim()
      const right = state.titleRight.trim()
      if (left) {
        boxes.push(boxOfText(
          'title', '标题(左)', a, cx - title.seamHalf - title.leftWidth / 2, baseline,
          title.leftWidth, title.fontSize,
        ))
      }
      if (right) {
        boxes.push(boxOfText(
          'title', '标题(右)', a, cx + title.seamHalf + title.rightWidth / 2, baseline,
          title.rightWidth, title.fontSize,
        ))
      }
    }
  }

  const sub = state.subtitle.trim()
  if (sub) {
    const a = normalizeAnchor(layout.subtitle)
    const base = byHeight(CANVAS.SUB_BASE, ctx.s)
    const min = byHeight(CANVAS.SUB_MIN, ctx.s)
    const maxW = (ctx.W * CANVAS.FULL_MAX_FRACTION) * a.scale
    // 与 subTitleLayer 同源：按基准字号等比缩小到可用宽度，不放大
    const measured = measureTracked(measure, sub, base, base * SUB_TRACK)
    const fontSize = measured <= maxW ? base : Math.max(min, (base * maxW) / measured)
    const width = Math.min(maxW, measureTracked(measure, sub, fontSize, fontSize * SUB_TRACK))
    const lineW = byWidth(CANVAS.SUB_LINE_W, ctx.s)
    const lineGap = byWidth(CANVAS.SUB_LINE_GAP, ctx.s)
    const box = boxOfText('subtitle', '副标题', a, a.x * ctx.W, a.y * ctx.H, width, fontSize)
    // 计入两侧装饰线，命中范围与肉眼所见一致
    box.x -= lineW + lineGap
    box.width += (lineW + lineGap) * 2
    boxes.push(box)
  }

  const wm = state.watermark.trim()
  if (wm) {
    const a = normalizeAnchor(layout.watermark)
    const fontSize = Math.max(12, Math.round(byHeight(CANVAS.WM_SIZE, ctx.s) * a.scale))
    const maxW = watermarkMaxWidth(ctx) * a.scale
    const width = lineWidth(measure, wm, fontSize, fontSize * WM_TRACK, maxW)
    // 水印右对齐锚点：包围盒左边界须按锚点回推
    boxes.push(boxOfText(
      'watermark', '水印', a, a.x * ctx.W - width / 2, a.y * ctx.H, width, fontSize,
    ))
  }

  return boxes
}

/** 自定义元素的命中几何：文字按实际换行宽高，图形按边长 */
export function customBoxes(
  elements: CustomElement[], measure: MeasureText, ctx: Ctx,
): CustomBox[] {
  return elements.map((el) => {
    const a = normalizeAnchor(el.anchor)
    const cx = a.x * ctx.W
    const cy = a.y * ctx.H
    const label = el.kind === 'text' ? '文字' : el.kind === 'svg' ? 'SVG 图标' : '图片'
    const id = `custom:${el.id}`
    if (el.kind === 'text') {
      const size = customElementSize(el, ctx)
      const trackPx = size * el.tracking
      const maxW = customTextMaxWidth(ctx) * a.scale
      const text = el.text.trim()
      const lines = text ? wrapText(text, maxW, size, measure, trackPx) : ['']
      const width = Math.max(...lines.map((l) => measureTracked(measure, l, size, trackPx)), 1)
      const lineHeight = Math.round(size * 1.18)
      const box = boxOfText(id, label, a, cx, cy, Math.min(width, maxW), size, lines.length, lineHeight)
      return { ...box, elementId: el.id }
    }
    const size = customElementSize(el, ctx)
    let width = size
    let height = size
    // SVG 图标按 viewBox 等比缩放，命中框随之贴合（非方形图标不套正方形框）
    if (el.kind === 'svg' && el.content.trim()) {
      const [, , vw, vh] = readViewBox(el.content)
      const scale = size / Math.max(vw, vh)
      width = vw * scale
      height = vh * scale
    }
    return {
      id, label, elementId: el.id,
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      centerY: cy,
    }
  })
}