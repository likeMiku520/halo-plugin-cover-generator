/**
 * SVG 标记的颜色改写。
 *
 * 图标选择器取回的标记把颜色写死在 fill/stroke 上;这里把它改写成
 * currentColor,颜色从此只由渲染期的 color 属性解析——于是「改颜色」只改元素
 * 状态,既不必重新联网取图,存档里也不会按颜色存出多份标记。
 * 粘贴/上传的标记与旧档里的标记走「旧色 → 新色」的同一条改写,否则详情里的
 * 取色器会看起来「调了没反应」。
 */

/** 恰好 #rrggbb:元素颜色字段的合法形态(与 useCoverState 的校验同源) */
export const HEX6 = /^#[0-9a-fA-F]{6}$/

/** 标记里第一个写死的颜色;alpha 一并吃掉,避免只取到前 6 位 */
const MARKUP_HEX = /(?:fill|stroke)="(#[0-9a-fA-F]{6})[0-9a-fA-F]{0,2}"/

/** 取标记里第一个写死的颜色;标记只用了 currentColor 时返回空串 */
export function firstMarkupColor(markup: string): string {
  return MARKUP_HEX.exec(markup)?.[1] ?? ''
}

/**
 * 把标记里的 from 颜色换成 to;from 不在标记里时原样返回,
 * 因此在 currentColor 标记上调用是安全的无操作。
 *
 * 末尾排除十六进制字符:否则 #rrggbb 会被当成 #rrggbbaa 的前缀,
 * 替换后留下 "currentColorff" 这样的残片。代价是带 alpha 的写死颜色
 * (如 #ffffff80)不会被改写——宁可少改一处,也不产出损坏的标记。
 */
export function recolorSvgMarkup(markup: string, from: string, to: string): string {
  if (!from) return markup
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return markup.replace(new RegExp(`${escaped}(?![0-9a-fA-F])`, 'gi'), to)
}