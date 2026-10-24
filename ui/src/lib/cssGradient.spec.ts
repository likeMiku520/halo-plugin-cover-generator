import { describe, it, expect } from 'vitest'
import { parseCssGradient } from './cssGradient'

const ok = (s: string) => parseCssGradient(s) as Extract<ReturnType<typeof parseCssGradient>, { ok: true }>

describe('parseCssGradient 合法输入', () => {
  it('解析用户示例：deg + 百分比色标', () => {
    expect(ok('linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)')).toEqual({
      ok: true,
      gradient: {
        angle: 45,
        stops: [
          { offset: 0, color: '#ff9a9e' },
          { offset: 99, color: '#fad0c4' },
          { offset: 100, color: '#fad0c4' },
        ],
      },
    })
  })
  it('缺省百分比：首 0、末 100、中间均分', () => {
    const r = ok('linear-gradient(90deg, #111111, #222222, #333333)')
    expect(r.gradient.stops.map(s => s.offset)).toEqual([0, 50, 100])
  })
  it('混合缺省与显式百分比', () => {
    const r = ok('linear-gradient(120deg, #f6d365, #fda085 60%)')
    expect(r.gradient.stops).toEqual([
      { offset: 0, color: '#f6d365' }, { offset: 60, color: '#fda085' },
    ])
  })
  it('负角度与小数角度归一 0–360', () => {
    expect(ok('linear-gradient(-45deg, #111111, #222222)').gradient.angle).toBe(315)
    expect(ok('linear-gradient(405.5deg, #111111, #222222)').gradient.angle).toBe(45.5)
  })
  it('方向关键字 to top/right/bottom/left', () => {
    expect(ok('linear-gradient(to top, #111111, #222222)').gradient.angle).toBe(0)
    expect(ok('linear-gradient(to right, #111111, #222222)').gradient.angle).toBe(90)
    expect(ok('linear-gradient(to bottom, #111111, #222222)').gradient.angle).toBe(180)
    expect(ok('linear-gradient(to left, #111111, #222222)').gradient.angle).toBe(270)
  })
  it('rgb/rgba 颜色转十六进制', () => {
    const r = ok('linear-gradient(45deg, rgb(255,154,158) 0%, rgba(250,208,196,1) 100%)')
    expect(r.gradient.stops.map(s => s.color)).toEqual(['#ff9a9e', '#fad0c4'])
  })
  it('省略角度默认 180（to bottom）', () => {
    expect(ok('linear-gradient(#111111, #222222)').gradient.angle).toBe(180)
  })
  it('空段（连续逗号）被忽略不参与解析与计数', () => {
    const r = ok('linear-gradient(45deg, #111111, , #222222)')
    expect(r.gradient.stops).toEqual([
      { offset: 0, color: '#111111' }, { offset: 100, color: '#222222' },
    ])
  })
})

describe('parseCssGradient 非法输入（返回 ok:false 不抛异常）', () => {
  it('空输入与空白', () => {
    expect(parseCssGradient('').ok).toBe(false)
    expect(parseCssGradient('   ').ok).toBe(false)
  })
  it('非 linear-gradient 文本', () =>
    expect(parseCssGradient('radial-gradient(circle, #fff, #000)').ok).toBe(false))
  it('无色标', () =>
    expect(parseCssGradient('linear-gradient(45deg)').ok).toBe(false))
  it('非法颜色', () =>
    expect(parseCssGradient('linear-gradient(45deg, #xyz, #222222)').ok).toBe(false))
  it('色标百分比乱序', () =>
    expect(parseCssGradient('linear-gradient(45deg, #111111 50%, #222222 20%)').ok).toBe(false))
  it('不支持的对角方向给出指引', () => {
    const r = parseCssGradient('linear-gradient(to top left, #111111, #222222)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('deg')
  })
  it('超多色标（>8）拒绝', () =>
    expect(parseCssGradient('linear-gradient(45deg, #111111, #222222, #333333, #444444, #555555, #666666, #777777, #888888, #999999)').ok).toBe(false))
})
