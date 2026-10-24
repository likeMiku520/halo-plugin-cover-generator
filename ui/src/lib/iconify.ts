/**
 * Iconify 图标库客户端。
 *
 * Halo Console 自带的图标选择器基于 Iconify,但它只作为宿主表单类型
 * (`$formkit: iconify`)存在、未导出为可复用组件,插件无法直接挂载,
 * 因此这里直连 Iconify 官方 API 浏览同一套图标库(200+ 图标集),
 * 并把选中的图标取回为自包含的 SVG 标记(与手工粘贴走同一条白名单过滤)。
 */

const API = 'https://api.iconify.design'
const TIMEOUT_MS = 10000

/** 单个图标集 */
export interface IconSet {
  prefix: string
  name: string
  total: number
  author: string
  license: string
}

/** 检索结果中的一条候选 */
export interface IconifyHit {
  /** 完整图标名,形如 `mdi:home` */
  name: string
  prefix: string
}

/** 失败原因中文化;网络不可用与无结果分开说,否则用户无从下手 */
export class IconifyError extends Error {}

async function requestJson(url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new IconifyError('无法连接 Iconify 图标库(网络受限),可改用粘贴 SVG 或直链导入')
  }
  if (!res.ok) throw new IconifyError(`Iconify 图标库返回 HTTP ${res.status},请稍后重试`)
  try {
    return await res.json()
  } catch {
    throw new IconifyError('Iconify 返回内容无法解析')
  }
}

interface RawCollection {
  name?: string
  total?: number
  author?: { name?: string }
  license?: { title?: string }
}

/**
 * 拉取全部图标集并排序:先按图标数量降序,数量相同时按名称。
 * 图标多的集合通常也是用户最常找的(如 Material Design Icons / Tabler),
 * 排前面可以减少翻找。
 */
export async function listIconSets(): Promise<IconSet[]> {
  const data = (await requestJson(`${API}/collections`)) as Record<string, RawCollection>
  return Object.entries(data)
    .map(([prefix, meta]) => ({
      prefix,
      name: meta.name ?? prefix,
      total: typeof meta.total === 'number' ? meta.total : 0,
      author: meta.author?.name ?? '',
      license: meta.license?.title ?? '',
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** 取某个图标集的全部图标名(含未分类与分类下的图标) */
export async function listIconsOfSet(prefix: string): Promise<string[]> {
  const data = (await requestJson(`${API}/collection?prefix=${encodeURIComponent(prefix)}`)) as {
    uncategorized?: unknown
    categories?: Record<string, unknown>
    aliases?: Record<string, unknown>
  }
  const names: string[] = []
  const push = (list: unknown) => {
    if (Array.isArray(list)) {
      for (const n of list) if (typeof n === 'string') names.push(n)
    }
  }
  push(data.uncategorized)
  for (const group of Object.values(data.categories ?? {})) push(group)
  push(Object.keys(data.aliases ?? {}))
  return [...new Set(names)].map((n) => `${prefix}:${n}`)
}

/** 按关键词检索图标;limit 上限 999(API 约定) */
export async function searchIcons(keyword: string, limit = 120): Promise<IconifyHit[]> {
  const q = keyword.trim()
  if (!q) return []
  const url = `${API}/search?query=${encodeURIComponent(q)}&limit=${Math.min(999, limit)}`
  const data = (await requestJson(url)) as { icons?: unknown }
  const icons = Array.isArray(data.icons) ? data.icons : []
  return icons
    .filter((n): n is string => typeof n === 'string' && n.includes(':'))
    .map((name) => ({ name, prefix: name.split(':')[0] }))
}

/** 取单个图标的 SVG 标记(带填充色,便于直接内联进封面) */
export async function fetchIconSvg(name: string, color = '#ffffff'): Promise<string> {
  const [prefix, icon] = name.split(':')
  if (!prefix || !icon) throw new IconifyError('图标名格式应为「图标集:图标」,例如 mdi:home')
  const url = `${API}/${encodeURIComponent(prefix)}/${encodeURIComponent(icon)}.svg` +
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

/** 预览缩略图地址:Iconify 的 CSS API,<i> 元素即可渲染,无需 JS 运行时 */
export function iconPreviewUrl(name: string, height = 24): string {
  return `${API}/${name.replace(':', '/')}.svg?height=${height}`
}