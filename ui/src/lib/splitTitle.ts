import type { SplitResult } from './types'

// CJK（含全角）记宽 1，其余记 0.5
const isWide = (ch: string) => /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)
const isAlnum = (ch?: string) => !!ch && /[A-Za-z0-9]/.test(ch)

export function splitTitle(raw: string): SplitResult {
  const title = raw.trim()
  if (!title) return { left: '', right: '' }
  if (title.includes('|')) {
    const i = title.indexOf('|')
    return { left: title.slice(0, i).trim(), right: title.slice(i + 1).trim() }
  }
  const chars = [...title]
  const total = chars.reduce((a, c) => a + (isWide(c) ? 1 : 0.5), 0)
  let acc = 0
  let cut = chars.length
  for (let i = 0; i < chars.length; i++) {
    if (acc >= total / 2) { cut = i; break }
    acc += isWide(chars[i]) ? 1 : 0.5
  }
  // 切点落在拉丁单词内部时，向左回退到最近的非字母数字处；退无可退则硬切
  if (isAlnum(chars[cut - 1]) && isAlnum(chars[cut])) {
    let j = cut - 1
    while (j > 0 && isAlnum(chars[j - 1])) j--
    if (j > 0) cut = j
  }
  return { left: chars.slice(0, cut).join('').trim(), right: chars.slice(cut).join('').trim() }
}
