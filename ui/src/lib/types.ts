/** 渐变色标：offset 为 0–100 的百分比 */
export interface GradientStop {
  offset: number
  color: string
}

/** 线性渐变：angle 为 CSS 角度（0° 向上、顺时针） */
export interface Gradient {
  angle: number
  stops: GradientStop[]
}

/**
 * 画布坐标锚点：x/y 为相对画布的 0–1 比例值（非像素）。
 * 预览按比例缩放与导出共用同一套坐标，
 * 交互层只需把指针位移除以画布尺寸，无需知道渲染基准。
 */
export interface Anchor {
  x: number
  y: number
  /** 相对基准的字号/尺寸倍率 */
  scale: number
}

/** 画布分辨率（像素）。改变它只改变构图比例，尺寸类数值按画布比例换算 */
export interface CanvasSize {
  width: number
  height: number
}

/** 可自由定位的元素（标题在分缝模式下由锚点决定中缝位置） */
export type AnchorKey = 'logo' | 'title' | 'subtitle' | 'watermark'

export type AnchorMap = Record<AnchorKey, Anchor>

/** 标题排版模式：split 为左右两段各自求齐中缝，flow 为整块自动换行 */
export type TitleMode = 'split' | 'flow'

/** 自定义元素类型：image 位图、text 矢量文字、svg 图标 */
export type CustomKind = 'image' | 'text' | 'svg'

/**
 * 自定义元素。text 经内置字体转为矢量路径（产物自包含，不依赖系统字体）；
 * image 存 dataURL、svg 存原始标记，两者同样保证导出 SVG 无外链。
 */
export interface CustomElement {
  id: string
  kind: CustomKind
  /** image 为 dataURL；svg 为 SVG 源码；text 不使用 */
  content: string
  /** 仅 text 使用：文案 */
  text: string
  /** image/svg 为基准边长（px）；text 为字号（px） */
  size: number
  anchor: Anchor
  /** 仅 text 使用 */
  color: string
  bold: boolean
  /** 仅 text 使用：字距（em） */
  tracking: number
  /** 仅 image/svg 使用：圆形裁剪 */
  round: boolean
}

/** 封面全部可编辑状态 */
export interface CoverState {
  /** 标题左段（分缝模式下右对齐中缝） */
  titleLeft: string
  /** 标题右段（分缝模式下左对齐中缝） */
  titleRight: string
  /** 标题基准字号（100–210）；超宽时仍自动缩小兜底 */
  titleFontSize: number
  /** 标题排版模式 */
  titleMode: TitleMode
  subtitle: string
  gradient: Gradient
  /** 命中的预设 id；null 表示自定义渐变 */
  presetId: string | null
  /** 用户上传的 Logo dataURL；null 表示用内置默认 */
  logoDataUrl: string | null
  logoHidden: boolean
  /** 域名水印；空串表示不显示 */
  watermark: string
  /** 画布分辨率；默认 1200×630 */
  canvas: CanvasSize
  /** 标题/副标题/Logo/水印的位置与缩放 */
  layout: AnchorMap
  /** 用户追加的元素（图片/文字/SVG），按数组顺序叠加在最上层 */
  customElements: CustomElement[]
}

/** 标题拆分结果：左段右对齐中缝、右段左对齐中缝 */
export interface SplitResult {
  left: string
  right: string
}