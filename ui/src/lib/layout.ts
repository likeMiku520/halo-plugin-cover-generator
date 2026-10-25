import { DEFAULT_PRESET } from './presets'
import { DEFAULT_CANVAS_PRESET } from './canvasPresets'
import { HEX6 } from './svgColor'
import type {
  Anchor, AnchorMap, CanvasSize, CoverState, LayerKey, TextTarget, TextStyle, TextStyleMap, TitleMode,
} from './types'

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
  /** 背景图默认压暗强度与上限(%) */
  BACKGROUND_SCRIM: 20,
  BACKGROUND_SCRIM_MAX: 60,
  SEG_MAX_FRACTION: 0.4333,
  /** 整块标题可用宽度占画布宽的比例 */
  FULL_MAX_FRACTION: 0.9333,
  /** 水印可用宽度占画布宽的比例 */
  WM_MAX_FRACTION: 0.35,
  /** 自定义文字断行上限占画布宽的比例 */
  CUSTOM_TEXT_MAX_FRACTION: 0.75,
  /** 锚点取值边界：0 表示不预留裁切保护，元素可以贴到画布边缘 */
  MARGIN_X: 0,
  MARGIN_Y: 0,
  /** 不透明度上限（面板用百分比显示，存的是 0–1） */
  OPACITY_MAX: 100,
} as const

/** 副标题字距（em）与自定义元素默认字距基准 */
export const SUB_TRACK = 0.3
export const WM_TRACK = 0.08

/**
 * 「大小」的百分比上下限。
 *
 * 面板滑杆与预览滚轮共用这一份：两处各写一套的话，滚轮能把元素放到滑杆够不到的位置，
 * 面板就会显示一个被夹住的假值。
 *
 * 注意标题不在其中：标题的大小由 `titleFontSize` 单独承担（边界是
 * CANVAS.TITLE_MIN–TITLE_BASE，即 64–210px），滚轮在标题上会把倍率折算成字号，
 * 这里只用来决定「一次滚动走多少」。别以为标题也受 20–300 约束。
 */
export const ELEMENT_SCALE_LIMITS = {
  subtitle: { min: 1, max: 100 },
  watermark: { min: 1, max: 300 },
  other: { min: 20, max: 300 },
} as const

/**
 * 按元素取「大小」上下限。
 *
 * 面板滑杆、预览滚轮、以及将来的任何入口都走这一个函数：
 * 「哪个元素用哪一档」只写在这里，不留第二份映射。
 */
export function scaleLimitsOf(id: string | null | undefined): { min: number; max: number } {
  if (id === 'subtitle') return ELEMENT_SCALE_LIMITS.subtitle
  if (id === 'watermark') return ELEMENT_SCALE_LIMITS.watermark
  return ELEMENT_SCALE_LIMITS.other
}

/**
 * 自定义元素「边长/宽度(px)」的上下限。
 *
 * 与 scaleLimitsOf 同理：面板滑杆、预览滚轮、选中框的拉大手柄都读这一份，
 * 任何一处自己抄一套数字，滚轮与滑杆就会在边界上打架。
 */
export const CUSTOM_SIZE_LIMITS = {
  text: { min: 16, max: 200 },
  other: { min: 24, max: 600 },
} as const

/** 按自定义元素类型取边长/宽度上下限（文字是字号，图片与 SVG 是边长/宽度） */
export function customSizeLimitsOf(kind: string | null | undefined): { min: number; max: number } {
  return kind === 'text' ? CUSTOM_SIZE_LIMITS.text : CUSTOM_SIZE_LIMITS.other
}

const anchor = (x: number, y: number, scale = 1): Anchor => ({
  x, y, scale, opacity: 1, rotation: 0,
})

/**
 * 默认锚点：整数百分比，重置后每个数值框里都是干净整数。
 * 标题与 Logo 居中(50/50)、副标题落在 80% 高度、水印贴右下(95/95)；
 * 副标题倍率 0.5 对应「大小 50%」，是它的出厂观感。
 */
export function defaultAnchors(): AnchorMap {
  return {
    logo: anchor(0.5, 0.5),
    title: anchor(0.5, 0.5),
    subtitle: anchor(0.5, 0.8, 0.5),
    watermark: anchor(0.95, 0.95),
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** 锚点归一：数值越界（不可信存档或拖拽溢出）收敛回安全域，倍率限定 0.1–5 */
export function normalizeAnchor(a: Anchor): Anchor {
  return {
    x: clamp(a.x, CANVAS.MARGIN_X, 1 - CANVAS.MARGIN_X),
    y: clamp(a.y, CANVAS.MARGIN_Y, 1 - CANVAS.MARGIN_Y),
    scale: clamp(a.scale, 0.1, 5),
    // 透明度与旋转是后加字段：旧档缺失时给默认值，不因此判整条元素非法
    opacity: typeof a.opacity === 'number' && Number.isFinite(a.opacity)
      ? clamp(a.opacity, 0, 1)
      : 1,
    rotation: normalizeRotation(a.rotation),
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

/** 背景压暗强度收敛进 0–上限 */
export function normalizeBackgroundScrim(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CANVAS.BACKGROUND_SCRIM
  return Math.min(CANVAS.BACKGROUND_SCRIM_MAX, Math.max(0, Math.round(value)))
}

/** 文字排版的取值域：UI 滑杆与状态校验共用，避免两处各写一份边界 */
export const TEXT_STYLE_LIMITS = {
  TRACKING_MIN: -0.2,
  TRACKING_MAX: 1.5,
  CURVE_MIN: -100,
  CURVE_MAX: 100,
  ROTATION_MIN: -180,
  ROTATION_MAX: 180,
} as const

const clampTo = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** 单个文字样式的默认值：副标题/水印沿用各自原有的字距观感，标题原本无字距 */
function defaultTextStyle(target: TextTarget): TextStyle {
  return {
    tracking: target === 'subtitle' ? SUB_TRACK : target === 'watermark' ? WM_TRACK : 0,
    curve: 0,
    direction: 'horizontal',
    color: '#ffffff',
    // 出厂不加粗：内置字体本身已是粗体，再加一层合成就比设计稿更重
    bold: false,
  }
}

export function defaultTextStyles(): TextStyleMap {
  return {
    title: defaultTextStyle('title'),
    subtitle: defaultTextStyle('subtitle'),
    watermark: defaultTextStyle('watermark'),
  }
}

/** 旋转角收敛进 ±180：渲染层单独用它(不经过整个 TextStyle) */
export function normalizeRotation(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.round(clampTo(value, TEXT_STYLE_LIMITS.ROTATION_MIN, TEXT_STYLE_LIMITS.ROTATION_MAX))
}

/** 把不可信/缺失的文字样式收敛进安全域；逐字段回落，不整块丢弃 */
export function normalizeTextStyle(value: unknown, fallback: TextStyle): TextStyle {
  if (typeof value !== 'object' || value === null) return { ...fallback }
  const s = value as Record<string, unknown>
  const num = (raw: unknown, def: number) =>
    (typeof raw === 'number' && Number.isFinite(raw) ? raw : def)
  const L = TEXT_STYLE_LIMITS
  return {
    tracking: clampTo(num(s.tracking, fallback.tracking), L.TRACKING_MIN, L.TRACKING_MAX),
    curve: Math.round(clampTo(num(s.curve, fallback.curve), L.CURVE_MIN, L.CURVE_MAX)),
    direction: s.direction === 'vertical' ? 'vertical' : 'horizontal',
    // 颜色会被写进 SVG 的 fill 属性，只接受 #rrggbb
    color: typeof s.color === 'string' && HEX6.test(s.color) ? s.color : fallback.color,
    bold: typeof s.bold === 'boolean' ? s.bold : fallback.bold,
  }
}

/** 新建存档的完整默认状态 */
export function defaultCoverState(): CoverState {
  return {
    titleLeft: '',
    titleRight: '',
    // 出厂即整块排版，内容七个字(便于一眼看出换行与弯曲效果)
    titleFlow: '标题只有七个字',
    seamGap: CANVAS.SEAM_GAP,
    // 标题大小滑杆显示的是相对 TITLE_BASE 的百分比，出厂 50%
    titleFontSize: Math.round(CANVAS.TITLE_BASE / 2),
    titleMode: 'flow',
    subtitle: '',
    gradient: { angle: DEFAULT_PRESET.angle, stops: DEFAULT_PRESET.stops.map((s) => ({ ...s })) },
    presetId: DEFAULT_PRESET.id,
    backgroundMode: 'gradient',
    backgroundImage: null,
    backgroundScrim: CANVAS.BACKGROUND_SCRIM,
    textStyles: defaultTextStyles(),
    // 智能参考线默认关闭：不请自来的吸附线会干扰已有手感
    smartGuides: false,
    logoDataUrl: null,
    logoHidden: false,
    watermark: '',
    canvas: { width: DEFAULT_CANVAS_PRESET.width, height: DEFAULT_CANVAS_PRESET.height },
    canvasPresetId: DEFAULT_CANVAS_PRESET.id,
    layout: defaultAnchors(),
    customElements: [],
    layers: defaultLayers(),
  }
}

/** 画布尺寸合法域：兜住不可信存档，避免 0 或负数把渲染算成 NaN */
export const CANVAS_SIDE_MIN = 200
export const CANVAS_SIDE_MAX = 4096
const MIN_SIDE = CANVAS_SIDE_MIN
const MAX_SIDE = CANVAS_SIDE_MAX

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