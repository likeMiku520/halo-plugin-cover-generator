import { describe, it, expect } from 'vitest'
import { readViewBox, sanitizeSvgMarkup } from './svgSanitizer'

/**
 * 自定义图标来自用户粘贴或远程下载，属于不可信输入。
 * 这些用例锁定「危险标记不得进入导出产物」这条边界。
 */
describe('sanitizeSvgMarkup 白名单过滤', () => {
  it('保留普通图形与其几何属性', () => {
    const r = sanitizeSvgMarkup('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#39c5bb"/></svg>')
    expect(r.ok).toBe(true)
    expect(r.markup).toContain('<circle')
    expect(r.markup).toContain('viewBox="0 0 24 24"')
    expect(r.markup).toContain('#39c5bb')
  })

  it('剥离 <script> 且不保留其内容', () => {
    const r = sanitizeSvgMarkup(
      '<svg viewBox="0 0 24 24"><script>alert(1)</script><rect width="4" height="4"/></svg>',
    )
    expect(r.ok).toBe(true)
    expect(r.markup).not.toContain('script')
    expect(r.markup).not.toContain('alert')
    expect(r.markup).toContain('<rect')
  })

  it('剥离 on* 事件属性', () => {
    const r = sanitizeSvgMarkup('<svg viewBox="0 0 24 24"><rect width="4" height="4" onload="evil()"/></svg>')
    expect(r.ok).toBe(true)
    expect(r.markup).not.toContain('onload')
    expect(r.markup).not.toContain('evil')
  })

  it('丢弃 javascript: 协议链接（<a> 不在白名单，整棵子树被移除）', () => {
    const r = sanitizeSvgMarkup(
      '<svg viewBox="0 0 24 24"><a href="javascript:alert(1)"><rect width="4" height="4"/></a></svg>',
    )
    // 未知元素整体丢弃：保留子节点会让它们继承被移除父节点的定位语义，反而产生意外布局
    expect(r.ok).toBe(false)
    expect(r.markup).toBe('')
  })

  it('剥离危险链接的同时保留同层的安全图形', () => {
    const r = sanitizeSvgMarkup(
      '<svg viewBox="0 0 24 24"><a href="javascript:alert(1)"><rect width="4" height="4"/></a>' +
      '<circle r="3"/></svg>',
    )
    expect(r.ok).toBe(true)
    expect(r.markup).not.toContain('javascript:')
    expect(r.markup).not.toContain('href')
    expect(r.markup).toContain('<circle')
  })

  it('拒绝外链 href，保留同文档片段引用', () => {
    const external = sanitizeSvgMarkup('<svg viewBox="0 0 24 24"><image href="https://evil.example/x.png"/></svg>')
    expect(external.ok).toBe(false)

    const internal = sanitizeSvgMarkup(
      '<svg viewBox="0 0 24 24"><defs><path id="p" d="M0 0h4v4z"/></defs><use href="#p"/></svg>',
    )
    expect(internal.ok).toBe(true)
    expect(internal.markup).toContain('href="#p"')
  })

  it('丢弃未知元素整棵子树（foreignObject 内的 HTML）', () => {
    const r = sanitizeSvgMarkup(
      '<svg viewBox="0 0 24 24"><foreignObject><div>hello</div></foreignObject><circle r="3"/></svg>',
    )
    expect(r.ok).toBe(true)
    expect(r.markup).not.toContain('foreignObject')
    expect(r.markup).not.toContain('hello')
    expect(r.markup).toContain('<circle')
  })

  it('保留样式类属性以便图标正常着色', () => {
    const r = sanitizeSvgMarkup(
      '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M2 2h20v20H2z"/></g></svg>',
    )
    expect(r.ok).toBe(true)
    expect(r.markup).toContain('stroke="currentColor"')
    expect(r.markup).toContain('stroke-width="2"')
  })

  it('片段输入被包进带 viewBox 的外壳', () => {
    const r = sanitizeSvgMarkup('<path d="M2 2h20v20H2z"/>')
    expect(r.ok).toBe(true)
    expect(r.markup).toContain('viewBox="0 0 24 24"')
    expect(r.markup).toContain('<path')
  })

  it('空内容与无图形片段都给出中文原因', () => {
    expect(sanitizeSvgMarkup('   ').ok).toBe(false)
    expect(sanitizeSvgMarkup('   ').reason).toContain('为空')
    // 非标记文本无法成为合法 SVG 片段：解析失败与空图形都算明确拒绝，不抛异常
    const textOnly = sanitizeSvgMarkup('这不是 SVG')
    expect(textOnly.ok).toBe(false)
    expect(textOnly.reason).toMatch(/解析失败|图形元素/)
  })

  it('合法但只含元信息的片段按「无图形元素」拒绝', () => {
    const r = sanitizeSvgMarkup('<title>只是标题</title>')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('图形元素')
  })

  it('没有任何可用图形元素时拒绝', () => {
    const r = sanitizeSvgMarkup('<svg viewBox="0 0 24 24"><script>x</script></svg>')
    expect(r.ok).toBe(false)
  })

  it('解析失败的标记不抛异常，返回中文原因', () => {
    const r = sanitizeSvgMarkup('<svg viewBox="0 0 24 24"><circle r="3"')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('解析')
  })
})

describe('readViewBox', () => {
  it('读取真实 viewBox', () => {
    expect(readViewBox('<svg viewBox="0 0 48 24">')).toEqual([0, 0, 48, 24])
  })

  it('逗号分隔与负数原点同样支持', () => {
    expect(readViewBox('<svg viewBox="-2,-4,20,10">')).toEqual([-2, -4, 20, 10])
  })

  it('缺失或非法时回退 24 网格', () => {
    expect(readViewBox('<svg>')).toEqual([0, 0, 24, 24])
    expect(readViewBox('<svg viewBox="0 0 0 10">')).toEqual([0, 0, 24, 24])
    expect(readViewBox('<svg viewBox="a b c d">')).toEqual([0, 0, 24, 24])
  })
})