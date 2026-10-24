import type { CanvasSize } from './types'

const ILLEGAL = /[/\\:*?"<>|\s]+/g

/** 非法字符与空白转连字符、合并去重、修剪首尾 */
const sanitizeBase = (title: string) =>
  title.replace(ILLEGAL, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/** 由标题生成下载文件名：非法字符与空白转连字符、合并去重、空结果兜底 cover */
export function svgFileName(title: string, ext: 'svg' | 'png'): string {
  return `${sanitizeBase(title) || 'cover'}.${ext}`
}

/** 附件文件名:净化后的标题插入 -cover 后缀;净化为空(含空标题)兜底 cover.png,
 *  不产生 cover-cover 叠词(评审附注)。附件名区别于本地下载名,便于站内辨识 */
export function coverAttachmentFileName(title: string): string {
  const base = sanitizeBase(title)
  return base ? `${base}-cover.png` : 'cover.png'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadSvg(svg: string, filename: string) {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

/** SVG 全自包含（文字为 path、Logo 与自定义图片为 dataURL），canvas 绘制无跨域污染。
 *  画布尺寸取自当前分辨率设置，与 SVG 的 viewBox 同源，避免两者静默失配 */
export async function svgToPngBlob(svg: string, canvas: CanvasSize, scale = 1): Promise<Blob> {
  const W = canvas.width, H = canvas.height
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((ok, err) => {
      img.onload = () => ok()
      img.onerror = () => err(new Error('SVG 渲染失败'))
      img.src = blobUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D 上下文不可用，PNG 导出失败')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, W, H)
    const pngBlob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/png'))
    if (!pngBlob) throw new Error('PNG 编码失败')
    return pngBlob
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

export async function downloadPng(svg: string, canvas: CanvasSize, filename: string, scale = 1) {
  triggerDownload(await svgToPngBlob(svg, canvas, scale), filename)
}
