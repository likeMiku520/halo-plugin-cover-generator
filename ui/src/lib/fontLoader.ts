// opentype.js 的 ESM 构建无 default 导出，必须命名导入（rollup 严格校验）
import { parse as opentypeParse } from 'opentype.js'
import type { Font as OpentypeFont } from 'opentype.js'

export type { OpentypeFont }

/**
 * 内置封面字体的运行时地址(M7 字体出包):字体文件随插件 JAR 的
 * static/fonts 分发,经 extensions/reverseproxy.yaml 的 ReverseProxy
 * 规则暴露;UI 产物不再内联 2MB 字体。根路径绝对式,与 Console 同源。
 */
export const BUILTIN_FONT_URL = '/plugins/cover-generator/assets/fonts/DouyinSansBold.otf'

/** 纯解析（双端可用：Node 测试直接喂 fs 读出的 buffer） */
export function parseFont(buf: ArrayBuffer): OpentypeFont {
  return opentypeParse(buf) // 损坏数据会抛错，由调用方降级
}

/** 运行时加载：url 为 Vite ?url 导入的资产地址（构建后内联为 dataURL，file:// 亦可 fetch） */
export async function loadCoverFont(url: string): Promise<OpentypeFont> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`字体加载失败：HTTP ${res.status}`)
  return parseFont(await res.arrayBuffer())
}

/** 轮廓命令的最小结构（opentype Path.commands） */
export interface PathCommandLike {
  type: string
  x?: number; y?: number
  x1?: number; y1?: number; x2?: number; y2?: number
}

/**
 * 自写序列化：绕开 opentype.js toPathData 的 roundDecimal 全局缓存——
 * 该缓存在特定字号/坐标组合下会把 NaN 写入并扩散，导致文字碎片化。
 */
export function pathToD(path: { commands: PathCommandLike[] }): string {
  const r = (n: number) => String(Math.round(n * 100) / 100)
  let d = ''
  for (const c of path.commands) {
    switch (c.type) {
      case 'M': d += `M${r(c.x!)} ${r(c.y!)}`; break
      case 'L': d += `L${r(c.x!)} ${r(c.y!)}`; break
      case 'C': d += `C${r(c.x1!)} ${r(c.y1!)} ${r(c.x2!)} ${r(c.y2!)} ${r(c.x!)} ${r(c.y!)}`; break
      case 'Q': d += `Q${r(c.x1!)} ${r(c.y1!)} ${r(c.x!)} ${r(c.y!)}`; break
      case 'Z': d += 'Z'; break
    }
  }
  return d
}

export function textToPathData(
  font: OpentypeFont, text: string,
  x: number, y: number, fontSize: number,
  anchor: 'start' | 'middle' | 'end',
): string {
  const w = font.getAdvanceWidth(text, fontSize)
  const shift = anchor === 'end' ? -w : anchor === 'middle' ? -w / 2 : 0
  // 直接在 (x+shift, y) 处生成绝对坐标路径；svgBuilder 另用原点+transform 方案做水平压缩
  return pathToD(font.getPath(text, x + shift, y, fontSize))
}
