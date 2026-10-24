import type { Gradient } from './types'
import { esc } from './esc'

/** CSS 角度 θ（0° 向上、顺时针）→ SVG userSpaceOnUse 渐变线两端点 */
export function cssAngleToLine(angle: number, width: number, height: number) {
  const rad = (angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const len = Math.abs(width * dx) + Math.abs(height * dy)
  const cx = width / 2
  const cy = height / 2
  // || 0 把 -0 归一为 0，避免 SVG 输出 "x2=-0"
  const round = (n: number) => Math.round(n * 100) / 100 || 0
  return {
    x1: round(cx - (dx * len) / 2), y1: round(cy - (dy * len) / 2),
    x2: round(cx + (dx * len) / 2), y2: round(cy + (dy * len) / 2),
  }
}

// 转义走共享单源 lib/esc.ts(评审M4)。纵深防御:存档校验层之下的最后防线,
// 防止颜色字段未来被绕过校验直插标记(评审 M2)

export function gradientToSvgAttrs(g: Gradient, width: number, height: number): string {
  const { x1, y1, x2, y2 } = cssAngleToLine(g.angle, width, height)
  const stops = g.stops
    .map(s => `<stop offset="${s.offset}%" stop-color="${esc(s.color)}"/>`)
    .join('')
  return `<linearGradient id="bg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
    `gradientUnits="userSpaceOnUse">${stops}</linearGradient>`
}
