import { describe, expect, it } from 'vitest'
import { HEX6, firstMarkupColor, recolorSvgMarkup } from './svgColor'

describe('firstMarkupColor', () => {
  it('取标记里第一个写死的填充色', () => {
    expect(firstMarkupColor('<svg><path fill="#39C5BB" d="M0 0"/></svg>')).toBe('#39C5BB')
  })

  it('也认描边色(线性图标把颜色放在 stroke 上)', () => {
    expect(firstMarkupColor('<svg><path fill="none" stroke="#ff0000" d="M0 0"/></svg>')).toBe('#ff0000')
  })

  it('只有 currentColor 时返回空串', () => {
    expect(firstMarkupColor('<svg><path fill="currentColor" d="M0 0"/></svg>')).toBe('')
  })

  it('带 alpha 的颜色只取前 6 位', () => {
    expect(firstMarkupColor('<svg><path fill="#f59e0bff" d="M0 0"/></svg>')).toBe('#f59e0b')
  })
})

describe('recolorSvgMarkup', () => {
  it('把写死的颜色换成 currentColor', () => {
    expect(recolorSvgMarkup('<path fill="#39C5BB" d="M0 0"/>', '#39C5BB', 'currentColor'))
      .toBe('<path fill="currentColor" d="M0 0"/>')
  })

  it('大小写不敏感', () => {
    expect(recolorSvgMarkup('<path fill="#39c5bb" d="M0 0"/>', '#39C5BB', 'currentColor'))
      .toBe('<path fill="currentColor" d="M0 0"/>')
  })

  it('多色图标只换同色部分,其余颜色保持原样', () => {
    const markup = '<path fill="#ffffff" d="M0 0"/><path fill="#ff0000" d="M1 1"/>'
    const out = recolorSvgMarkup(markup, '#ffffff', 'currentColor')
    expect(out).toContain('fill="currentColor"')
    expect(out).toContain('fill="#ff0000"')
  })

  it('不把 #rrggbb 当作 #rrggbbaa 的前缀替换,避免留下 currentColorff 残片', () => {
    const markup = '<path fill="#f59e0bff" d="M0 0"/>'
    expect(recolorSvgMarkup(markup, '#f59e0b', 'currentColor')).toBe(markup)
  })

  it('颜色不在标记里时原样返回(currentColor 标记上是无操作)', () => {
    const markup = '<path fill="currentColor" d="M0 0"/>'
    expect(recolorSvgMarkup(markup, '#ffffff', '#000000')).toBe(markup)
  })

  it('from 为空串时不做替换', () => {
    const markup = '<path fill="#ffffff" d="M0 0"/>'
    expect(recolorSvgMarkup(markup, '', '#000000')).toBe(markup)
  })
})

describe('HEX6', () => {
  it('只接受恰好 6 位十六进制颜色', () => {
    expect(HEX6.test('#39C5BB')).toBe(true)
    expect(HEX6.test('#39c5bb')).toBe(true)
    expect(HEX6.test('#fff')).toBe(false)
    expect(HEX6.test('#39C5BBFF')).toBe(false)
    expect(HEX6.test('39C5BB')).toBe(false)
  })
})