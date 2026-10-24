import { describe, it, expect } from 'vitest'
import { cssAngleToLine, gradientToSvgAttrs } from './gradient'

describe('cssAngleToLine', () => {
  it('0° 自下而上', () =>
    expect(cssAngleToLine(0, 1200, 630))
      .toEqual({ x1: 600, y1: 630, x2: 600, y2: 0 }))
  it('90° 自左向右', () =>
    expect(cssAngleToLine(90, 1200, 630))
      .toEqual({ x1: 0, y1: 315, x2: 1200, y2: 315 }))
  it('120° 端点数值正确', () => {
    // len = 1200·sin120° + 630·|cos120°| = 1039.23 + 315 = 1354.23
    const r = cssAngleToLine(120, 1200, 630)
    expect(r.x1).toBeCloseTo(13.6, 1)
    expect(r.y1).toBeCloseTo(-23.56, 1)
    expect(r.x2).toBeCloseTo(1186.4, 1)
    expect(r.y2).toBeCloseTo(653.56, 1)
  })
  it('270° 自右向左', () =>
    expect(cssAngleToLine(270, 1200, 630))
      .toEqual({ x1: 1200, y1: 315, x2: 0, y2: 315 }))
})

describe('gradientToSvgAttrs', () => {
  it('输出线性渐变定义且含色标', () => {
    const s = gradientToSvgAttrs(
      { angle: 120, stops: [{ offset: 0, color: '#f6d365' }, { offset: 100, color: '#fda085' }] },
      1200, 630)
    expect(s).toContain('<linearGradient id="bg"')
    expect(s).toContain('gradientUnits="userSpaceOnUse"')
    expect(s).toContain('#f6d365')
    expect(s).toContain('offset="100%"')
  })
  it('stop-color 经属性转义,存档注入形态无法逃逸出属性(纵深防御)', () => {
    const s = gradientToSvgAttrs(
      { angle: 0, stops: [{ offset: 0, color: '#fff"/><image href=x onerror=alert(1)>' }] },
      1200, 630)
    expect(s).not.toContain('"/><image')
    expect(s)
      .toContain('stop-color="#fff&quot;/&gt;&lt;image href=x onerror=alert(1)&gt;')
  })
})
