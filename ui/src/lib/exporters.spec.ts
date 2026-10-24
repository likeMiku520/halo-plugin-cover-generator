import { describe, it, expect, vi } from 'vitest'
import { svgFileName, coverAttachmentFileName, downloadSvg, downloadPng, svgToPngBlob } from './exporters'
import type { CanvasSize } from './types'

/** 默认 OG 分辨率；导出尺寸断言以它为基准 */
const OG: CanvasSize = { width: 1200, height: 630 }

describe('svgFileName', () => {
  it('保留中文并替换非法字符', () =>
    expect(svgFileName('工具/推荐:*?', 'svg')).toBe('工具-推荐.svg'))
  it('空白转连字符并去首尾', () =>
    expect(svgFileName('  hello world  ', 'png')).toBe('hello-world.png'))
  it('连续连字符合并', () =>
    expect(svgFileName('a---b', 'svg')).toBe('a-b.svg'))
  it('空标题兜底 cover', () =>
    expect(svgFileName('///', 'svg')).toBe('cover.svg'))
})

describe('coverAttachmentFileName(附件名,-cover 后缀)', () => {
  it('普通标题插入 -cover 后缀', () =>
    expect(coverAttachmentFileName('工具/推荐')).toBe('工具-推荐-cover.png'))
  it('标题本身为 cover 时正常叠加(用户输入优先)', () =>
    expect(coverAttachmentFileName('cover')).toBe('cover-cover.png'))
  it('空标题兜底 cover.png,不产生 cover-cover 叠词', () =>
    expect(coverAttachmentFileName('')).toBe('cover.png'))
  it('净化后为空(纯非法字符)同样兜底 cover.png', () =>
    expect(coverAttachmentFileName('///')).toBe('cover.png'))
})

describe('downloadPng', () => {
  it('canvas 2D 上下文不可用时给出明确错误而非裸 TypeError', async () => {
    class FakeImage {
      onload: () => void = () => {}
      onerror: () => void = () => {}
      set src(_: string) { this.onload() }
    }
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) })
    try {
      await expect(downloadPng('<svg/>', OG, 'a.png')).rejects.toThrow('Canvas')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('svgToPngBlob', () => {
  it('PNG @2x:画布尺寸为 2400×1260(scale 传播到 canvas)', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' })
    class FakeImage {
      onload: () => void = () => {}
      onerror: () => void = () => {}
      set src(_: string) { this.onload() }
    }
    const canvases: { width: number; height: number }[] = []
    const drawImage = vi.fn<() => void>()
    const scale = vi.fn<(x: number, y: number) => void>()
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('document', {
      createElement: () => {
        const c = {
          width: 0, height: 0,
          getContext: () => ({ drawImage, scale }),
          toBlob: (ok: (b: Blob) => void) => ok(png),
        }
        canvases.push(c)
        return c
      },
    })
    try {
      await svgToPngBlob('<svg/>', OG, 2)
      expect(canvases[0].width).toBe(2400) // 1200 × 2
      expect(canvases[0].height).toBe(1260) // 630 × 2
      expect(scale).toHaveBeenCalledWith(2, 2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('canvas 绘制后返回 PNG Blob 并释放 blob URL', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' })
    class FakeImage {
      onload: () => void = () => {}
      onerror: () => void = () => {}
      set src(_: string) { this.onload() }
    }
    const revoke = vi.fn<(url: string) => void>()
    const drawImage = vi.fn<() => void>()
    const scale = vi.fn<(x: number, y: number) => void>()
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke })
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage, scale }),
        toBlob: (ok: (b: Blob) => void) => ok(png),
      }),
    })
    try {
      await expect(svgToPngBlob('<svg/>', OG, 2)).resolves.toBe(png)
      expect(scale).toHaveBeenCalledWith(2, 2)
      expect(drawImage).toHaveBeenCalledOnce()
      expect(revoke).toHaveBeenCalledWith('blob:x')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('自定义分辨率(正方形)决定 PNG 像素尺寸', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' })
    class FakeImage {
      onload: () => void = () => {}
      onerror: () => void = () => {}
      set src(_: string) { this.onload() }
    }
    const canvases: { width: number; height: number }[] = []
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('document', {
      createElement: () => {
        const c = {
          width: 0, height: 0,
          getContext: () => ({ drawImage: vi.fn(), scale: vi.fn() }),
          toBlob: (ok: (b: Blob) => void) => ok(png),
        }
        canvases.push(c)
        return c
      },
    })
    try {
      await svgToPngBlob('<svg/>', { width: 1200, height: 1200 })
      expect(canvases[0].width).toBe(1200)
      expect(canvases[0].height).toBe(1200)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('downloadSvg', () => {
  it('创建 Blob 下载链接触发点击', () => {
    const click = vi.fn()
    const created: { href: string; download: string; click: () => void; remove: () => void } = {
      href: '', download: '', click, remove: () => {},
    }
    const append = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('document', { createElement: () => created, body: { appendChild: append } })
    try {
      downloadSvg('<svg/>', 'a.svg')
      expect(click).toHaveBeenCalledOnce()
      expect(created.download).toBe('a.svg')
      expect(created.href).toBe('blob:x')
      expect(append).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
