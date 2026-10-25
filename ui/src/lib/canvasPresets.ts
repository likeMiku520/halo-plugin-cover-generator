import type { CanvasSize } from './types'

/**
 * 画布分辨率预设。
 *
 * 宽度统一取 1200，只变高度：字号与图形尺寸都按画布比例存盘，
 * 所以换预设只改变构图比例，不会把元素「放大到画布外」。
 * 1:1 与 4:3 这类矮画布上，纵向可用空间变小，锚点仍按比例落位。
 */
export interface CanvasPreset {
  id: string
  label: string
  ratio: string
  width: number
  height: number
  /** 自定义模式：宽高由用户输入，不参与「按尺寸反查预设」 */
  custom?: boolean
}

const p = (id: string, label: string, ratio: string, height: number): CanvasPreset => ({
  id, label, ratio, width: 1200, height,
})

export const CANVAS_PRESETS: CanvasPreset[] = [
  p('og', '横版 OG', '1.91:1', 630),
  p('wide16x9', '宽屏', '16:9', 675),
  p('wide16x10', '宽屏 16:10', '16:10', 750),
  p('wide3x2', '相机横拍', '3:2', 800),
  p('wide4x3', '传统横版', '4:3', 900),
  p('square', '正方形', '1:1', 1200),
  p('tall4x5', '竖版 4:5', '4:5', 1500),
  p('tall3x4', '竖版 3:4', '3:4', 1600),
  p('story9x16', '故事/短视频', '9:16', 2133),
]

/**
 * 自定义模式。
 *
 * 单独一项而不是把尺寸直接塞进前八个：1200×675 既可能来自「宽屏」预设、
 * 也可能是用户手填的同一组数字，只有记住「选的是哪个模式」才能把选中态画对。
 */
export const CUSTOM_CANVAS_PRESET: CanvasPreset = {
  id: 'custom', label: '自定义', ratio: '自定', width: 1200, height: 675, custom: true,
}

/** 出厂分辨率：宽屏 16:9（1200×675） */
export const DEFAULT_CANVAS_PRESET: CanvasPreset =
  CANVAS_PRESETS.find((c) => c.id === 'wide16x9') ?? CANVAS_PRESETS[0]

/** 自定义模式的出厂宽高：与默认预设同尺寸，用户改起来有个参照 */
export const CUSTOM_CANVAS_DEFAULT = { width: CUSTOM_CANVAS_PRESET.width, height: CUSTOM_CANVAS_PRESET.height }

export function findPreset(size: CanvasSize): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((c) => c.width === size.width && c.height === size.height)
}

export function presetOfId(id: string): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((c) => c.id === id)
}

/** 当前画布的可读描述，供面板与输出条显示 */
export function describeCanvas(size: CanvasSize): string {
  const preset = findPreset(size)
  const ratio = preset ? preset.ratio : (size.width / size.height).toFixed(2) + ':1'
  return `${size.width} × ${size.height} · ${ratio}`
}