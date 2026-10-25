import { afterEach, describe, expect, it, vi } from 'vitest'
import { IconifyError, fetchIconSvg, iconSvgUrl } from './iconFetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('iconSvgUrl', () => {
  it('把冒号形式转成官方 API 的斜杠形式(冒号形式会 404)', () => {
    expect(iconSvgUrl('mdi:home')).toBe('https://api.iconify.design/mdi/home.svg')
  })

  it('名称里的特殊字符会被转义,不会拼出越界路径', () => {
    expect(iconSvgUrl('my set:a b')).toBe('https://api.iconify.design/my%20set/a%20b.svg')
  })

  it('缺少图标集或图标名时抛中文错误,而不是拼出必然 404 的地址', () => {
    expect(() => iconSvgUrl('home')).toThrow(IconifyError)
    expect(() => iconSvgUrl('home')).toThrow('图标名格式应为')
    expect(() => iconSvgUrl(':home')).toThrow('图标名格式应为')
    expect(() => iconSvgUrl('mdi:')).toThrow('图标名格式应为')
  })
})

describe('fetchIconSvg', () => {
  it('默认不带颜色参数,交给 Iconify 返回 currentColor 形态', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response('<svg><path fill="currentColor"/></svg>', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const svg = await fetchIconSvg('mdi:home')

    expect(svg).toContain('currentColor')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.iconify.design/mdi/home.svg')
  })

  it('传 color 时作为查询参数带上', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response('<svg viewBox="0 0 24 24"/>', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchIconSvg('mdi:home', '#39C5BB')

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.iconify.design/mdi/home.svg?color=%2339C5BB',
    )
  })

  it('网络层失败(离线/跨域)给中文提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    await expect(fetchIconSvg('mdi:home')).rejects.toThrow('无法下载该图标')
  })

  it('HTTP 失败时如实带上状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(fetchIconSvg('mdi:nope')).rejects.toThrow('图标下载失败:HTTP 404')
  })

  it('内容是 HTML 等非 SVG 时拒绝,避免把错误页当图标入库', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body>404</body></html>', { status: 200 })))
    await expect(fetchIconSvg('mdi:home')).rejects.toThrow('图标内容不是有效的 SVG')
  })
})