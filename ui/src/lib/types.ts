import type { TextDirection } from './textLayout'

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

/** 图层键：内置元素用自身键，自定义元素用 `custom:<id>` */
export type LayerKey = AnchorKey | `custom:${string}`

/** 标题排版模式：split 为左右两段各自求齐中缝，flow 为整块自动换行 */
export type TitleMode = 'split' | 'flow'

/** 背景模式：gradient 用渐变，image 用自定义背景图 */
export type BackgroundMode = 'gradient' | 'image'

/** 可单独调排版的三个内置文字元素 */
export type TextTarget = 'title' | 'subtitle' | 'watermark'

/**
 * 文字排版样式。三个文字元素各存一份：
 * 字号/位置/大小是「这块放在哪」，本结构是「这行字怎么排」。
 */
export interface TextStyle {
  /** 字距（em）：正数更疏，负数更紧 */
  tracking: number
  /** 弯曲度（-100–100）：0 为直线，正负决定弧向；仅横排生效 */
  curve: number
  /** 旋转角度（-180–180，顺时针为正） */
  rotation: number
  /** 排列方向：横排或竖排 */
  direction: TextDirection
}

export type TextStyleMap = Record<TextTarget, TextStyle>

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
  /** text 的文字颜色;svg 的图标颜色(标记按 currentColor 入库,渲染期由它解析) */
  color: string
  bold: boolean
  /** 仅 text 使用：字距（em） */
  tracking: number
}

/** 封面全部可编辑状态 */
export interface CoverState {
  /** 分缝模式的左段（与整块模式各自独立，切换模式互不覆盖） */
  titleLeft: string
  /** 分缝模式的右段 */
  titleRight: string
  /** 整块模式的标题文本 */
  titleFlow: string
  /** 分缝中缝两侧的间距（px，按参考画布宽） */
  seamGap: number
  /** 标题基准字号（100–210）；超宽时仍自动缩小兜底 */
  titleFontSize: number
  /** 标题排版模式 */
  titleMode: TitleMode
  subtitle: string
  gradient: Gradient
  /** 命中的预设 id；null 表示自定义渐变 */
  presetId: string | null
  /** 背景模式；image 时必定存在 backgroundImage（校验层维持该不变式） */
  backgroundMode: BackgroundMode
  /** 背景图 dataURL；null 表示未设置。与 Logo 同一边界：只接受内嵌图，不写外链 */
  backgroundImage: string | null
  /** 背景图之上的压暗遮罩强度（0–60 %）：照片明暗不可控，不压暗时白字常读不出来 */
  backgroundScrim: number
  /** 标题 / 副标题 / 水印各自的排版样式（字距、弯曲、旋转、方向） */
  textStyles: TextStyleMap
  /** 用户上传的 Logo dataURL；null 表示用内置默认 */
  logoDataUrl: string | null
  logoHidden: boolean
  /** 域名水印；空串表示不显示 */
  watermark: string
  /** 画布分辨率；默认 1200×630 */
  canvas: CanvasSize
  /** 标题/副标题/Logo/水印的位置与缩放 */
  layout: AnchorMap
  /** 自定义元素；按数组顺序即默认叠放顺序 */
  customElements: CustomElement[]
  /** 图层顺序：数组靠后者绘制在上层，可含内置元素与自定义元素 */
  layers: LayerKey[]
}

/** 标题拆分结果：左段右对齐中缝、右段左对齐中缝 */
export interface SplitResult {
  left: string
  right: string
}