import type { Anchor, AnchorMap, CanvasSize, CoverState, LayerKey, TitleMode } from './types'

/**
 * 画布基准与版式常量。
 *
 * 锚点用 0–1 比例表达位置，像素只在这里换算；尺寸类数值（字号/边长/间距）
 * 一律以「参考画布」为基准存盘，渲染时按当前画布等比缩放。
 * 宽度基准与高度基准分开，是因为三种元素对长宽比的敏感度不同：
 * 文字跟着高度走才读得清，图标与间距跟宽度走才不被压扁或撑爆。
 */
export const REF_W = 1200
export const REF_H = 630

export const CANVAS = {
  /** 文字与纵向间距按高度缩放 */
  TITLE_BASE: 210,
  TITLE_MIN: 64,
  SUB_BASE: 34,
  SUB_MIN: 24,
  SUB_LINE_W: 46,
  SUB_LINE_GAP: 18,
  WM_SIZE: 26,
  /** 图形类尺寸按宽度缩放 */
  LOGO_SIZE: 200,
  /** 分缝中缝默认留白(按宽度) */
  SEAM_GAP: 80,
  SEAM_GAP_MIN: 0,
  SEAM_GAP_MAX: 400,
  SEG_MAX_FRACTION: 0.4333,
  /** 整块标题可用宽度占画布宽的比例 */
  FULL_MAX_FRACTION: 0.9333,
  /** 水印可用宽度占画布宽的比例 */
  WM_MAX_FRACTION: 0.35,
  /** 自定义文字断行上限占画布宽的比例 */
  CUSTOM_TEXT_MAX_FRACTION: 0.75,
  /** 锚点允许的取值边界，防止元素被拖出画布 */
  MARGIN_X: 0.02,
  MARGIN_Y: 0.03,
} as const

/** 副标题字距（em）与自定义元素默认字距基准 */
export const SUB_TRACK = 0.3
export const WM_TRACK = 0.08

const anchor = (x: number, y: number, scale = 1): Anchor => ({ x, y, scale })

/**
 * 默认锚点：取值等价于改造前 1200×630 的硬编码布局。
 * 锚点是比例值，换分辨率后各元素仍落在画布的相对同一处。
 */
export function defaultAnchors(): AnchorMap {
  return {
    logo: anchor(0.5, 0.5238),
    title: anchor(0.5, 0.5556),
    subtitle: anchor(0.5, 0.8016),
    watermark: anchor(0.9567, 0.9365),
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** 锚点归一：数值越界（不可信存档或拖拽溢出）收敛回安全域，倍率限定 0.1–5 */
export function normalizeAnchor(a: Anchor): Anchor {
  return {
    x: clamp(a.x, CANVAS.MARGIN_X, 1 - CANVAS.MARGIN_X),
    y: clamp(a.y, CANVAS.MARGIN_Y, 1 - CANVAS.MARGIN_Y),
    scale: clamp(a.scale, 0.1, 5),
  }
}

/** 当前画布下的尺寸换算系数：w 供图形与间距，h 供文字 */
export interface SizeScale {
  w: number
  h: number
}

/** 渲染上下文与 CanvasSize 共用的最小形状：只要宽高 */
export interface HasSize {
  width: number
  height: number
}

export function scaleOf(size: HasSize): SizeScale {
  return { w: size.width / REF_W, h: size.height / REF_H }
}

/** 按高度换算文字尺寸（下限跟着一起缩放，避免小画布被下限顶穿） */
export function byHeight(value: number, s: SizeScale, min = 0): number {
  return Math.max(min * s.h, value * s.h)
}

/** 按宽度换算图形尺寸 */
export function byWidth(value: number, s: SizeScale, min = 0): number {
  return Math.max(min * s.w, value * s.w)
}

/** 单侧可用宽度（px）：分缝模式中缝两侧各自的上限 */
export function segmentMaxWidth(size: HasSize): number {
  return size.width * CANVAS.SEG_MAX_FRACTION
}

/** 整块标题可用宽度（px） */
export function fullMaxWidth(size: HasSize): number {
  return size.width * CANVAS.FULL_MAX_FRACTION
}

/** 水印可用宽度（px） */
export function watermarkMaxWidth(size: HasSize): number {
  return size.width * CANVAS.WM_MAX_FRACTION
}

/** 自定义文字断行上限（px） */
export function customTextMaxWidth(size: HasSize): number {
  return size.width * CANVAS.CUSTOM_TEXT_MAX_FRACTION
}

export const TITLE_MODE_LABEL: Record<TitleMode, string> = {
  split: '左右分缝',
  flow: '整块排版',
}

/** 默认图层顺序：等价于改造前的绘制次序（副标题→Logo→标题→水印，自定义元素在最上层） */
export function defaultLayers(customIds: string[] = []): LayerKey[] {
  return ['subtitle', 'logo', 'title', 'watermark', ...customIds.map((id) => `custom:${id}` as LayerKey)]
}

/** 中缝间距收敛进安全域 */
export function normalizeSeamGap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CANVAS.SEAM_GAP
  return Math.min(CANVAS.SEAM_GAP_MAX, Math.max(CANVAS.SEAM_GAP_MIN, Math.round(value)))
}

/** 新建存档的完整默认状态 */
export function defaultCoverState(): CoverState {
  return {
    titleLeft: '',
    titleRight: '',
    titleFlow: '',
    seamGap: CANVAS.SEAM_GAP,
    titleFontSize: CANVAS.TITLE_BASE,
    titleMode: 'split',
    subtitle: '',
    gradient: { angle: 120, stops: [{ offset: 0, color: '#f6d365' }, { offset: 100, color: '#fda085' }] },
    presetId: null,
    logoDataUrl: null,
    logoHidden: false,
    watermark: '',
    canvas: { width: REF_W, height: REF_H },
    layout: defaultAnchors(),
    customElements: [],
    layers: defaultLayers(),
  }
}

/** 画布尺寸合法域：兜住不可信存档，避免 0 或负数把渲染算成 NaN */
const MIN_SIDE = 200
const MAX_SIDE = 4096

export function isValidCanvasSize(v: unknown): v is CanvasSize {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return typeof c.width === 'number' && Number.isFinite(c.width)
    && typeof c.height === 'number' && Number.isFinite(c.height)
    && c.width >= MIN_SIDE && c.width <= MAX_SIDE
    && c.height >= MIN_SIDE && c.height <= MAX_SIDE
}

export function normalizeCanvasSize(v: unknown): CanvasSize {
  if (!isValidCanvasSize(v)) return { width: REF_W, height: REF_H }
  return { width: Math.round(v.width), height: Math.round(v.height) }
}