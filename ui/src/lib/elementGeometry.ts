import type { Anchor, CoverState, CustomElement, TextStyle } from './types'
import type { MeasureText } from './fitFontSize'
import {
  CANVAS,
  byHeight, byWidth, customTextMaxWidth, defaultTextStyles, normalizeAnchor,
  normalizeTextStyle, watermarkMaxWidth,
} from './layout'
import { type Ctx, customElementSize, lineWidth, measureTracked, titleGeometry, verticalTextMaxHeight, wrapText } from './svgBuilder'
import { verticalColumnStep, verticalColumns, verticalStep } from './textLayout'
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
  /** 文字排版旋转角（度）；缺省 0 表示不旋转，选中框据此绕 pivot 旋转 */
  rotation?: number
  /** 旋转支点（画布像素）：渲染时绕元素锚点旋转，选中框必须用同一个支点 */
  pivot?: { x: number; y: number }
}

export interface CustomBox extends ElementBox {
  elementId: string
}

/** 取某类内置文字的有效排版样式（旧档缺字段时回落默认） */
function textStyleOf(state: CoverState, key: 'title' | 'subtitle' | 'watermark'): TextStyle {
  return normalizeTextStyle(state.textStyles?.[key], defaultTextStyles()[key])
}

/**
 * 竖排文字的命中框：一列字按字号宽、按逐字步进高；一列排不下就换列，
 * 框宽随列数增长、框高停在最高的一列。
 *
 * 与渲染层同源（同一个 verticalColumns/verticalStep）：换列后的实际占位就是命中范围——
 * 两处各算一套的话，多列元素会出现「框只有一列宽、字却铺开好几列」的脱节。
 * 单列时各项与旧口径逐字段一致（宽 = 字号、高 = 步进 × 字数），短文本的框不会变样。
 */
function verticalTextBox(
  id: string, label: string, cx: number, cy: number,
  text: string, fontSize: number, trackPx: number, maxH: number, rotation: number,
): ElementBox {
  const columns = verticalColumns(text, fontSize, trackPx, maxH)
  // 列阵整体以锚点为心：列心左右对称、各列齐头，所以框也以 (cx, cy) 为中心
  const rows = Math.max(1, ...columns.map((c) => c.length))
  const count = Math.max(1, columns.length)
  const width = fontSize + (count - 1) * verticalColumnStep(fontSize, trackPx)
  const height = verticalStep(fontSize, trackPx) * rows
  return {
    id, label,
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    centerY: cy,
    rotation,
    pivot: { x: cx, y: cy },
  }
}

function boxOfText(
  id: string, label: string, ax: Anchor, x: number, baseline: number,
  width: number, fontSize: number, lineCount = 1, lineHeight = 0, rotation = 0,
  pivot?: { x: number; y: number },
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
    rotation,
    pivot,
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
    const st = textStyleOf(state, 'title')
    if (st.direction === 'vertical') {
      // 竖排一律取基准字号（渲染层的竖排不做横向缩放），因此这里不能复用横排的 fitFontSize 结果；
      // 分缝模式下左右两段各自成一个列阵，与 titleLayer 的竖排分支一一对应。
      const base = Math.min(
        CANVAS.TITLE_BASE, Math.max(CANVAS.TITLE_MIN, state.titleFontSize),
      ) * ctx.s.h
      const trackPx = base * st.tracking
      const maxH = verticalTextMaxHeight('title', ctx, a.scale)
      const seamHalf = byWidth(state.seamGap, ctx.s) / 2
      const left = state.titleLeft.trim()
      const right = state.titleRight.trim()
      // 取文本的规则与 titleLayer 一致：整块模式只看 titleFlow，无 Logo 时两段拼接为一块
      const segments = state.titleMode === 'flow'
        ? [{ label: '标题', text: state.titleFlow.trim(), cx }]
        : state.logoHidden
          ? [{ label: '标题', text: `${left}${right}`, cx }]
          : [
              ...(left ? [{ label: '标题(左)', text: left, cx: cx - seamHalf }] : []),
              ...(right ? [{ label: '标题(右)', text: right, cx: cx + seamHalf }] : []),
            ]
      for (const seg of segments) {
        boxes.push(verticalTextBox(
          'title', seg.label, seg.cx, baseline, seg.text, base, trackPx, maxH, a.rotation,
        ))
      }
    } else if (state.titleMode === 'flow' || state.logoHidden) {
      boxes.push(boxOfText(
        'title', '标题', a, cx, baseline, title.totalWidth, title.fontSize,
        title.lineCount, title.lineHeight, a.rotation, { x: cx, y: baseline },
      ))
    } else {
      // 分缝模式两侧各自命中：分别贴合自己那一段，便于单独拖动并保持中缝对齐
      const left = state.titleLeft.trim()
      const right = state.titleRight.trim()
      if (left) {
        boxes.push(boxOfText(
          'title', '标题(左)', a, cx - title.seamHalf - title.leftWidth / 2, baseline,
          title.leftWidth, title.fontSize, 1, 0, a.rotation, { x: cx, y: baseline },
        ))
      }
      if (right) {
        boxes.push(boxOfText(
          'title', '标题(右)', a, cx + title.seamHalf + title.rightWidth / 2, baseline,
          title.rightWidth, title.fontSize, 1, 0, a.rotation, { x: cx, y: baseline },
        ))
      }
    }
  }

  const sub = state.subtitle.trim()
  if (sub) {
    const a = normalizeAnchor(layout.subtitle)
    const st = textStyleOf(state, 'subtitle')
    const base = byHeight(CANVAS.SUB_BASE, ctx.s) * a.scale
    const min = byHeight(CANVAS.SUB_MIN, ctx.s) * a.scale
    const maxW = (ctx.W * CANVAS.FULL_MAX_FRACTION) * a.scale
    if (st.direction === 'vertical') {
      boxes.push(verticalTextBox(
        'subtitle', '副标题', a.x * ctx.W, a.y * ctx.H, sub, base, base * st.tracking,
        verticalTextMaxHeight('subtitle', ctx, a.scale), a.rotation,
      ))
    } else {
      // 与 subTitleLayer 同源：按基准字号等比缩小到可用宽度，不放大
      const measured = measureTracked(measure, sub, base, base * st.tracking)
      const fontSize = measured <= maxW ? base : Math.max(min, (base * maxW) / measured)
      const width = Math.min(maxW, measureTracked(measure, sub, fontSize, fontSize * st.tracking))
      const lineW = byWidth(CANVAS.SUB_LINE_W, ctx.s)
      const lineGap = byWidth(CANVAS.SUB_LINE_GAP, ctx.s)
      const box = boxOfText(
        'subtitle', '副标题', a, a.x * ctx.W, a.y * ctx.H, width, fontSize, 1, 0,
        a.rotation, { x: a.x * ctx.W, y: a.y * ctx.H },
      )
      // 计入两侧装饰线，命中范围与肉眼所见一致
      box.x -= lineW + lineGap
      box.width += (lineW + lineGap) * 2
      boxes.push(box)
    }
  }

  const wm = state.watermark.trim()
  if (wm) {
    const a = normalizeAnchor(layout.watermark)
    const st = textStyleOf(state, 'watermark')
    const fontSize = Math.max(12, Math.round(byHeight(CANVAS.WM_SIZE, ctx.s) * a.scale))
    if (st.direction === 'vertical') {
      boxes.push(verticalTextBox(
        'watermark', '水印', a.x * ctx.W, a.y * ctx.H, wm, fontSize, fontSize * st.tracking,
        verticalTextMaxHeight('watermark', ctx, a.scale), a.rotation,
      ))
    } else {
      const maxW = watermarkMaxWidth(ctx) * a.scale
      const width = lineWidth(measure, wm, fontSize, fontSize * st.tracking, maxW)
      // 水印右对齐锚点：包围盒左边界须按锚点回推
      boxes.push(boxOfText(
        'watermark', '水印', a, a.x * ctx.W - width / 2, a.y * ctx.H, width, fontSize, 1, 0,
        a.rotation, { x: a.x * ctx.W, y: a.y * ctx.H },
      ))
    }
  }

  return boxes
}

/** 自定义元素的命中几何：文字按实际断行/换列后的宽高，图形按边长 */
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
      const text = el.text.trim()
      if (el.direction === 'vertical') {
        // 竖排按可用高度换列，框宽随列数增长：与渲染层共用同一个 verticalColumns，
        // 事件里拖动、选中框与手柄因此都落在换列后的实际占位上（含 \n 强制换列）
        const box = verticalTextBox(
          id, label, cx, cy, text, size, trackPx,
          verticalTextMaxHeight('custom', ctx, a.scale), a.rotation,
        )
        return { ...box, elementId: el.id }
      }
      const maxW = customTextMaxWidth(ctx) * a.scale
      const lines = text ? wrapText(text, maxW, size, measure, trackPx) : ['']
      const width = Math.max(...lines.map((l) => measureTracked(measure, l, size, trackPx)), 1)
      const lineHeight = Math.round(size * 1.18)
      const box = boxOfText(
        id, label, a, cx, cy, Math.min(width, maxW), size, lines.length, lineHeight,
        a.rotation, { x: cx, y: cy },
      )
      return { ...box, elementId: el.id }
    }
    const size = customElementSize(el, ctx)
    let width = size
    let height = size
    // 位图保持原图比例：此前宽高都取 size，等于把任何图都按正方形硬裁（实机反馈）
    if (el.kind === 'image') {
      height = size / (el.aspect > 0 ? el.aspect : 1)
    }
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
      rotation: a.rotation,
      pivot: { x: cx, y: cy },
    }
  })
}