import { describe, it, expect } from 'vitest'
import { fitFontSize } from './fitFontSize'

// 假度量：每字符宽 = fontSize（便于心算）
const measure = (t: string, s: number) => t.length * s

describe('fitFontSize', () => {
  it('基准字号放得下则直接用基准', () =>
    expect(fitFontSize('工具', 520, { base: 210, min: 64 }, measure))
      .toEqual({ fontSize: 210, fits: true }))
  it('超宽按比例缩小', () => {
    // 6 字 × 210 = 1260 > 520 → floor(210×520/1260)=86
    expect(fitFontSize('六个汉字标题', 520, { base: 210, min: 64 }, measure))
      .toEqual({ fontSize: 86, fits: true })
  })
  it('缩到下限仍超宽则 fits=false', () =>
    expect(fitFontSize('超'.repeat(60), 520, { base: 210, min: 64 }, measure))
      .toEqual({ fontSize: 64, fits: false }))
  it('空文本直接用基准', () =>
    expect(fitFontSize('', 520, { base: 210, min: 64 }, measure))
      .toEqual({ fontSize: 210, fits: true }))
})
