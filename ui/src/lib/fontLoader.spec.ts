import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { parseFont, textToPathData } from './fontLoader'

// 字体已出包至插件 JAR 静态资源(M7);vitest 以 ui/ 为工作目录,路径指回仓库内资产
const FONT_PATH = '../src/main/resources/static/fonts/DouyinSansBold.otf'
const hasFont = existsSync(FONT_PATH)

const loadFixture = () => {
  const buf = readFileSync(FONT_PATH)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe.skipIf(!hasFont)('fontLoader（需字体资产）', () => {
  it('解析真实字体成功', () => {
    const font = parseFont(loadFixture())
    expect(font.unitsPerEm).toBeGreaterThan(0)
  })
  it('textToPathData 产出路径且锚点偏移正确', () => {
    const font = parseFont(loadFixture())
    const d = textToPathData(font, '工具', 560, 350, 210, 'end')
    expect(d.startsWith('M') || d.startsWith('m')).toBe(true)
    const dMid = textToPathData(font, '工具', 600, 350, 210, 'middle')
    expect(dMid).not.toBe(d)
  })
  it('全字号范围序列化不产生 NaN（opentype toPathData 缓存舍入缺陷回归）', () => {
    const font = parseFont(loadFixture())
    // svgBuilder 的 pathText 以 x=0 原点生成路径——坐标集合与带偏移时不同
    for (let size = 60; size <= 210; size++) {
      const d = textToPathData(font, '标题', 0, 350, size, 'start')
      expect(d, `fontSize=${size}`).not.toMatch(/NaN|Infinity/)
    }
  })
  it('序列化段数与命令数一致（无丢失字形轮廓）', () => {
    const font = parseFont(loadFixture())
    const p = font.getPath('标题', 0, 350, 140)
    const d = textToPathData(font, '标题', 0, 350, 140, 'start')
    const segs = d.match(/[MLCQZ]/g)!.length
    expect(segs).toBe(p.commands.length)
  })
  it('损坏字体数据抛错', () => {
    expect(() => parseFont(new ArrayBuffer(4))).toThrow()
  })
})
