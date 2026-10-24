import type { Gradient, GradientStop } from './types'

const MAX_STOPS = 8
const DIRECTIONS: Record<string, number> = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
}

const normAngle = (a: number) => ((a % 360) + 360) % 360

function hexColor(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('')
  const rgb = s.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(n => Number.isFinite(n) && n >= 0 && n <= 255))
      return '#' + parts.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('')
  }
  return null
}

/** 解析 CSS linear-gradient 文本；失败返回 ok:false 与中文原因，不抛异常 */
export function parseCssGradient(
  input: string,
): { ok: true; gradient: Gradient } | { ok: false; error: string } {
  const text = input.trim()
  if (!text) return { ok: false, error: '输入为空' }
  if (!text.toLowerCase().startsWith('linear-gradient'))
    return { ok: false, error: '仅支持 linear-gradient(...) 格式' }
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open === -1 || close <= open) return { ok: false, error: '缺少括号内容' }
  const inner = text.slice(open + 1, close)
  // 按顶层逗号切分：跳过 rgb()/rgba() 括号内的逗号
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else { cur += ch }
  }
  if (cur.trim()) parts.push(cur.trim())
  // 空段（连续逗号）直接忽略，不参与颜色解析与色标计数
  const segments = parts.filter(Boolean)

  // 首段：角度 / 方向关键字 /（省略时首段即色标，默认 180° = to bottom）
  let angle = 180
  let stopParts = segments
  const first = segments[0]
  const deg = first.match(/^(-?[\d.]+)deg$/i)
  if (deg) {
    angle = normAngle(parseFloat(deg[1]))
    stopParts = segments.slice(1)
  } else if (DIRECTIONS[first.toLowerCase()] !== undefined) {
    angle = DIRECTIONS[first.toLowerCase()]
    stopParts = segments.slice(1)
  } else if (/^to\s+\S+\s+\S+$/i.test(first)) {
    return { ok: false, error: '不支持对角方向（如 to top left），请改用 deg 角度' }
  }

  // 上限按真实色标数判(扣掉角度/方向段):此前在切分段上判,无角度形式会多放行一个(评审M3)
  if (stopParts.length > MAX_STOPS) return { ok: false, error: `色标过多（最多 ${MAX_STOPS} 个）` }
  if (stopParts.length < 2) return { ok: false, error: '至少需要 2 个色标' }
  const colorAndOffset = stopParts.map(p => {
    const m = p.match(/^(.*?)(?:\s+([\d.]+)%)?$/)
    return { colorRaw: m![1].trim(), offset: m![2] !== undefined ? parseFloat(m![2]) : null }
  })

  const colors = colorAndOffset.map(s => ({ ...s, color: hexColor(s.colorRaw) }))
  const bad = colors.find(c => c.color === null)
  if (bad) return { ok: false, error: `无法识别的颜色：${bad.colorRaw}（支持 #hex / rgb() / rgba()）` }

  // 缺省 offset：首 0、末 100、中间按索引均分
  const n = colors.length
  const offsets = colors.map((c, i) => c.offset ?? Math.round((i / (n - 1)) * 100))
  for (let i = 1; i < offsets.length; i++)
    if (offsets[i] <= offsets[i - 1])
      return { ok: false, error: `色标百分比必须严格递增（第 ${i + 1} 个 ${offsets[i]}% ≤ 前一个 ${offsets[i - 1]}%）` }

  const stops: GradientStop[] = colors.map((c, i) => ({ offset: offsets[i], color: c.color! }))
  return { ok: true, gradient: { angle, stops } }
}
