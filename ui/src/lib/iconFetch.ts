/**
 * Iconify 图标的取回。
 *
 * 内置选择器开 `format: "svg"` 时会在「确认」那一步自己下载标记,而它拼出的
 * 地址是 `/{prefix}:{name}.svg`;Iconify 官方 API 只认斜杠形式,冒号形式一律
 * 404,于是点确定必然弹「Request failed with status code 404」(halo 2.26 实测,
 * 见 formkit/inputs/iconify/IconConfirmPanel.vue 的 handleConfirm)。
 *
 * 因此这里开 `format: "name"`:确认时不发请求,只回填图标名,标记由本模块按
 * 正确地址取回。附带好处是取回时不带颜色,得到 `currentColor` 形态——颜色
 * 留给渲染期解析,改色不必重新联网,同一份标记也不会按颜色重复存储。
 */

const API = 'https://api.iconify.design'
const TIMEOUT_MS = 10000

/** 图标取回失败;消息为可直接展示的中文 */
export class IconifyError extends Error {}

/**
 * 图标名(`mdi:home`)→ 官方 SVG 地址。
 * 名称不合法时抛错而不是拼出一个必然 404 的地址,失败原因才不会错位。
 */
export function iconSvgUrl(name: string): string {
  const trimmed = name.trim()
  const [prefix, icon] = trimmed.split(':')
  if (!prefix || !icon) {
    throw new IconifyError('图标名格式应为「图标集:图标」,例如 mdi:home')
  }
  return `${API}/${encodeURIComponent(prefix)}/${encodeURIComponent(icon)}.svg`
}

/** 取图标标记;传 color 则写死颜色,不传则保留 currentColor */
export async function fetchIconSvg(name: string, color?: string): Promise<string> {
  const url = iconSvgUrl(name) + (color ? `?color=${encodeURIComponent(color)}` : '')
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new IconifyError('无法下载该图标(网络受限),可改用粘贴 SVG 或直链导入')
  }
  if (!res.ok) throw new IconifyError(`图标下载失败:HTTP ${res.status}`)
  const text = await res.text()
  // 宽松判据:只为挡住 HTML 错误页,自闭合的 <svg/> 同样算合法标记
  if (!/<svg[\s/>]/i.test(text)) throw new IconifyError('图标内容不是有效的 SVG')
  return text
}