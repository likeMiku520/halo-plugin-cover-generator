/** XML 属性/文本转义的单一事实源(评审M4:此前 gradient.ts 与 svgBuilder.ts
 *  各持一份且已分叉——gradient 份缺单引号转义)。两处同源引用,防再漂移。 */
export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
