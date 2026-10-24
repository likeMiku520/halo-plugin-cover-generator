import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateLogoUrl, fetchLogoAsDataUrl } from './logoFetcher'

afterEach(() => vi.unstubAllGlobals())

describe('validateLogoUrl', () => {
  it('https 直链合法（返回 null）', () =>
    expect(validateLogoUrl('https://lsky.example.com/i/2026/04/22/x.png')).toBeNull())
  it('http 直链合法', () =>
    expect(validateLogoUrl('http://example.com/a.jpg')).toBeNull())
  it('空输入非法', () =>
    expect(validateLogoUrl('   ')).toBe('链接为空'))
  it('非 http(s) 协议非法', () =>
    expect(validateLogoUrl('ftp://example.com/a.png')).toContain('http'))
  it('纯文本非法', () =>
    expect(validateLogoUrl('not a url')).toContain('http'))
})

describe('fetchLogoAsDataUrl（mock fetch）', () => {
  const pngBlob = () => new Blob(['abc'], { type: 'image/png' })

  it('成功：image/* 响应转为 dataURL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => pngBlob() })))
    const dataUrl = await fetchLogoAsDataUrl('https://x.com/a.png')
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
  it('HTTP 404 给出状态码提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => pngBlob() })))
    await expect(fetchLogoAsDataUrl('https://x.com/a.png')).rejects.toThrow('404')
  })
  it('非图片 content-type 拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['<html>'], { type: 'text/html' }) })))
    await expect(fetchLogoAsDataUrl('https://x.com/a.png')).rejects.toThrow('图片')
  })
  it('超过 2MB 拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['x'.repeat(3 * 1024 * 1024)], { type: 'image/png' }) })))
    await expect(fetchLogoAsDataUrl('https://x.com/a.png')).rejects.toThrow('2MB')
  })
  it('网络失败（CORS/断网）给出本地上传指引', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(fetchLogoAsDataUrl('https://x.com/a.png')).rejects.toThrow('跨域')
  })
  it('主源 CORS 失败时自动回退 wsrv.nl 公共代理并成功', async () => {
    const realPng = new Blob(['abc'], { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://x.com/')) throw new TypeError('Failed to fetch')
      // 公共代理路径：wsrv.nl + encodeURIComponent 的目标直链
      expect(String(url)).toContain('wsrv.nl/?url=')
      expect(String(url)).toContain(encodeURIComponent('https://x.com/a.png'))
      return { ok: true, status: 200, blob: async () => realPng }
    }))
    const d = await fetchLogoAsDataUrl('https://x.com/a.png')
    expect(d.startsWith('data:image/png;base64,')).toBe(true)
  })
  it('回退代理前触发 onProxyFallback 披露回调,且早于代理请求发出(评审 M3)', async () => {
    const realPng = new Blob(['abc'], { type: 'image/png' })
    const callOrder: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://x.com/')) {
        callOrder.push('main')
        throw new TypeError('Failed to fetch')
      }
      callOrder.push('proxy')
      return { ok: true, status: 200, blob: async () => realPng }
    }))
    const onProxyFallback = vi.fn(() => callOrder.push('disclose'))
    await fetchLogoAsDataUrl('https://x.com/a.png', onProxyFallback)
    expect(onProxyFallback).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['main', 'disclose', 'proxy'])
  })
  it('主源成功不触发披露回调(未走代理)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => pngBlob() })))
    const onProxyFallback = vi.fn()
    await fetchLogoAsDataUrl('https://x.com/a.png', onProxyFallback)
    expect(onProxyFallback).not.toHaveBeenCalled()
  })
  it('HTTP 404 不回退代理,披露回调不触发', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, blob: async () => pngBlob() }))
    vi.stubGlobal('fetch', fetchMock)
    const onProxyFallback = vi.fn()
    await expect(fetchLogoAsDataUrl('https://x.com/a.png', onProxyFallback)).rejects.toThrow('404')
    expect(onProxyFallback).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('公共代理返回非图片时仍给出跨域指引', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://x.com/')) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, blob: async () => new Blob(['<html>'], { type: 'text/html' }) }
    }))
    await expect(fetchLogoAsDataUrl('https://x.com/a.png')).rejects.toThrow('跨域')
  })
  it('HTTP 层错误（404 等）不触发代理回退', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob([], { type: 'image/png' }) }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchLogoAsDataUrl('https://x.com/a.png')).rejects.toThrow('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
