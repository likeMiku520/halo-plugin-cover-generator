/**
 * 自定义 SVG 图标的白名单过滤。
 *
 * 图标来源包括用户粘贴的标记与远程下载的 SVG 文件，两者都属于不可信输入：
 * 直接内联进导出产物会带入 <script>、on* 事件、外链 <image>/<use> 等，
 * 既能在预览 iframe/img 之外执行脚本，也会破坏「导出 SVG 自包含」的承诺。
 * 这里按元素与属性白名单重建，未知节点整体丢弃（而非保留标签），
 * 属性值再做一次协议校验，双层过滤下漏网标记无法进入产物。
 */

/** 允许保留的元素：形状、文本、分组与渐变/裁剪/遮罩定义 */
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'symbol', 'use',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
  'feMerge', 'feMergeNode', 'feFlood', 'feComposite',
])

/** 允许保留的属性；href/xlink:href 单独校验，只接受同文档引用 */
const ALLOWED_ATTRS = new Set([
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'transform', 'viewBox', 'preserveAspectRatio',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity', 'opacity',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'patternUnits', 'patternContentUnits', 'clipPathUnits',
  'maskUnits', 'maskContentUnits', 'clip-path', 'mask', 'filter', 'id',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
  'letter-spacing', 'stdDeviation', 'dx', 'dy', 'result', 'in', 'in2', 'mode',
  'values', 'type', 'flood-color', 'flood-opacity', 'operator', 'k1', 'k2', 'k3', 'k4',
])

/** 属性值禁止出现的协议与样式注入入口 */
const FORBIDDEN_VALUE = /(javascript:|data:text\/html|vbscript:|expression\s*\(|url\s*\(\s*['"]?\s*(?:https?:)?\/\/)/i

/** 仅允许同文档片段引用，挡住 <use href="http://..."> 之类的外链依赖 */
function isSafeHref(value: string): boolean {
  const v = value.trim()
  return v.startsWith('#')
}

/** 把标签名转成规范大小写，便于与白名单比对 */
function canonicalTag(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'clippath') return 'clipPath'
  if (lower === 'lineargradient') return 'linearGradient'
  if (lower === 'radialgradient') return 'radialGradient'
  return lower
}

const ATTR_CANON: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  spreadmethod: 'spreadMethod',
  patternunits: 'patternUnits',
  patterncontentunits: 'patternContentUnits',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits',
  'clip-path': 'clip-path',
  stddeviation: 'stdDeviation',
  floodcolor: 'flood-color',
  floodopacity: 'flood-opacity',
  stopcolor: 'stop-color',
  stopopacity: 'stop-opacity',
  fillopacity: 'fill-opacity',
  fillrule: 'fill-rule',
  strokewidth: 'stroke-width',
  strokelinecap: 'stroke-linecap',
  strokelinejoin: 'stroke-linejoin',
  strokedasharray: 'stroke-dasharray',
  strokeopacity: 'stroke-opacity',
  textanchor: 'text-anchor',
  dominantbaseline: 'dominant-baseline',
  letterspacing: 'letter-spacing',
  fontfamily: 'font-family',
  fontsize: 'font-size',
  fontweight: 'font-weight',
  femerge: 'feMerge',
}

function canonicalAttr(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower === 'href' || lower === 'xlink:href') return 'href'
  const canon = ATTR_CANON[lower] ?? name
  return ALLOWED_ATTRS.has(canon) ? canon : null
}

function copySafeAttributes(src: Element, dst: Element): void {
  for (const attr of Array.from(src.attributes)) {
    const name = canonicalAttr(attr.name)
    if (!name) continue
    const value = attr.value
    if (FORBIDDEN_VALUE.test(value)) continue
    if (name === 'href' && !isSafeHref(value)) continue
    try {
      dst.setAttribute(name, value)
    } catch {
      // 非法属性名（含命名空间前缀等）直接跳过，不让异常中断整个过滤
    }
  }
}

function rebuild(src: Element, doc: Document): Element | null {
  const tag = canonicalTag(src.tagName)
  // 未知元素整体丢弃：保留标签壳会连带保留其子节点语义（如 <foreignObject> 内的 HTML）
  if (!ALLOWED_TAGS.has(tag)) return null
  const dst = doc.createElementNS('http://www.w3.org/2000/svg', tag)
  copySafeAttributes(src, dst)
  for (const child of Array.from(src.children)) {
    const built = rebuild(child, doc)
    if (built) dst.appendChild(built)
  }
  return dst
}

/** 过滤结果：ok 为可内联的标记，ok=false 时 reason 为中文原因 */
export interface SanitizeResult {
  ok: boolean
  markup: string
  reason: string
}

/** 能真正画出东西的元素；仅有元信息(<title>/<desc>)的片段视为空图标 */
const DRAWABLE_TAGS = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'image', 'use',
])

function hasDrawable(root: Element): boolean {
  if (DRAWABLE_TAGS.has(canonicalTag(root.tagName))) return true
  return Array.from(root.getElementsByTagName('*'))
    .some((el) => DRAWABLE_TAGS.has(canonicalTag(el.tagName)))
}

/**
 * 过滤 SVG 标记。传入内容可以是完整 <svg> 或一段片段；
 * 片段会被包进带 viewBox 的 <svg> 外壳，便于按尺寸缩放渲染。
 */
export function sanitizeSvgMarkup(input: string): SanitizeResult {
  const raw = input.trim()
  if (!raw) return { ok: false, markup: '', reason: 'SVG 内容为空' }
  if (typeof DOMParser === 'undefined') {
    return { ok: false, markup: '', reason: '当前环境不支持解析 SVG' }
  }
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  } catch {
    return { ok: false, markup: '', reason: 'SVG 解析失败' }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, markup: '', reason: 'SVG 解析失败，请检查标记是否完整' }
  }
  const root = doc.documentElement
  if (!root || canonicalTag(root.tagName) !== 'svg') {
    // 片段输入：包一层外壳后再按同一白名单过滤
    const wrapped = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    wrapped.setAttribute('viewBox', '0 0 24 24')
    try {
      const frag = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`,
        'image/svg+xml',
      )
      if (frag.getElementsByTagName('parsererror').length > 0) {
        return { ok: false, markup: '', reason: 'SVG 解析失败，请检查标记是否完整' }
      }
      for (const child of Array.from(frag.documentElement.children)) {
        const built = rebuild(child, doc)
        if (built) wrapped.appendChild(built)
      }
    } catch {
      return { ok: false, markup: '', reason: 'SVG 解析失败' }
    }
    if (!hasDrawable(wrapped)) {
      return { ok: false, markup: '', reason: 'SVG 中没有可用的图形元素' }
    }
    return { ok: true, markup: new XMLSerializer().serializeToString(wrapped), reason: '' }
  }
  const out = rebuild(root, doc)
  if (!out) return { ok: false, markup: '', reason: 'SVG 中没有可用的图形元素' }
  // 过滤后可能只剩 <title>/<desc> 等元信息：这种图标渲染出来是空白，按无图形拒绝
  if (!hasDrawable(out)) {
    return { ok: false, markup: '', reason: 'SVG 中没有可用的图形元素' }
  }
  return { ok: true, markup: new XMLSerializer().serializeToString(out), reason: '' }
}

/** 从 SVG 标记中取 viewBox，缺失时回退 0 0 24 24（多数图标默认网格） */
export function readViewBox(markup: string): [number, number, number, number] {
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(markup)
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return [parts[0], parts[1], parts[2], parts[3]]
    }
  }
  return [0, 0, 24, 24]
}