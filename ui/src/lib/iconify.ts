/**
 * Iconify 公共 API 客户端。
 *
 * Halo Console 内置的图标选择器基于 Iconify,但那个选择器只作为宿主表单类型
 * (`$formkit: iconify`)对外提供,并未导出为可复用组件,插件无法直接挂载它。
 * 因此这里直连 Iconify 官方 API 检索同一套图标库,并把选中的图标转成
 * 自包含的 SVG 标记入库(与手工粘贴 SVG 走同一条白名单过滤)。
 */

const SEARCH_URL = 'https://api.iconify.design/search'
const SVG_URL = 'https://api.iconify.design'

/** 检索结果中的一条候选 */
export interface IconifyHit {
  /** 完整图标名,形如 `mdi:home` */
  name: string
  prefix: string
}

/** 检索失败原因中文化;网络不可用与无结果要分开说,否则用户无从下手 */
export class IconifyError extends Error {}

const TIMEOUT_MS = 8000

async function requestJson(url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new IconifyError('无法连接 Iconify 图标库(网络受限或浏览器拦截),可改用粘贴 SVG 或直链导入')
  }
  if (!res.ok) {
    throw new IconifyError(`Iconify 图标库返回 HTTP ${res.status},请稍后重试`)
  }
  try {
    return await res.json()
  } catch {
    throw new IconifyError('Iconify 返回内容无法解析')
  }
}

/**
 * 按关键词检索图标。
 * limit 上限 999(API 约定),调用方给的是展示上限,这里固定取 64 足够翻看。
 */
export async function searchIcons(keyword: string, limit = 64): Promise<IconifyHit[]> {
  const q = keyword.trim()
  if (!q) return []
  const url = `${SEARCH_URL}?query=${encodeURIComponent(q)}&limit=${Math.min(999, limit)}`
  const data = (await requestJson(url)) as { icons?: unknown }
  const icons = Array.isArray(data.icons) ? data.icons : []
  return icons
    .filter((n): n is string => typeof n === 'string' && n.includes(':'))
    .map((name) => ({ name, prefix: name.split(':')[0] }))
}

/** 取单个图标的 SVG 标记(带颜色填充,便于直接内联进封面) */
export async function fetchIconSvg(name: string, color = '#ffffff'): Promise<string> {
  const [prefix, icon] = name.split(':')
  if (!prefix || !icon) throw new IconifyError('图标名格式应为「图标集:图标」,例如 mdi:home')
  const url = `${SVG_URL}/${encodeURIComponent(prefix)}/${encodeURIComponent(icon)}.svg` +
    `?color=${encodeURIComponent(color)}`
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new IconifyError('无法下载该图标(网络受限),可稍后重试或改用粘贴 SVG')
  }
  if (!res.ok) throw new IconifyError(`图标下载失败:HTTP ${res.status}`)
  const text = await res.text()
  if (!/<svg[\s>]/i.test(text)) throw new IconifyError('图标内容不是有效的 SVG')
  return text
}