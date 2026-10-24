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