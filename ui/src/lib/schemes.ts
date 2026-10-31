import type { CoverState } from './types'

/**
 * 「方案」:把当前全部参数存成命名快照,之后一键整份载入。
 *
 * 与存档(localStorage 的 state/v1)分开存:存档是唯一的活动状态,方案是用户
 * 主动命名的多个快照,互不干扰——保存方案不会改变当前工作状态,载入方案也不
 * 会(除整份替换外)触碰存档的持久化链路。
 */
export const SCHEMES_STORAGE_KEY = 'halo-plugin-cover-generator/schemes/v1'

/**
 * 方案数量上限。
 *
 * 选择「顶掉最旧」而不是「拒绝」:方案是工作快照而非唯一数据源,拒绝会让第 31 次
 * 保存莫名失败;顶掉最旧的最坏代价是丢一条旧快照,用户仍可重新保存当前状态。
 * 该规则同时兼作损坏存档的自愈——手工写入超过上限的数组会在下一次保存时收敛。
 */
export const MAX_SCHEMES = 30

/** 方案名长度上限(trim 后按 UTF-16 长度计,与输入框 maxlength 一致) */
export const SCHEME_NAME_MAX = 40

/** 一条已命名方案:保存时的完整状态 + 标识/名字/时间 */
export interface SavedScheme {
  id: string
  name: string
  /** ISO 8601 时间串;仅用于展示与「最旧」判定 */
  savedAt: string
  /** 保存瞬间的完整 CoverState(读取时属于不可信 JSON,载入须过 adoptCoverState) */
  state: CoverState
}

export interface SchemeSaveResult {
  ok: boolean
  /** 可直接展示给用户的结果说明(成功、覆盖、淘汰、失败) */
  message: string
  /** 操作后已落盘的列表(失败时为当前实际存储内容) */
  schemes: SavedScheme[]
  /** 本次保存的条目(失败为 null) */
  scheme: SavedScheme | null
  /** 是否命中了同名方案并覆盖 */
  replaced: boolean
  /** 为守住上限而被顶掉的最旧方案(没有则为 null) */
  evicted: SavedScheme | null
}

export interface SchemeDeleteResult {
  ok: boolean
  message: string
  schemes: SavedScheme[]
  removed: SavedScheme | null
}

export type SchemeNameCheck =
  | { ok: true; name: string }
  | { ok: false; message: string }

/**
 * 名字校验:trim 后必填、1–40 字符。
 * 同名判定也以这里返回的 trim 结果为准(精确匹配,区分大小写)。
 */
export function validateSchemeName(raw: string): SchemeNameCheck {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) return { ok: false, message: '请输入方案名' }
  if (name.length > SCHEME_NAME_MAX) {
    return { ok: false, message: `方案名最多 ${SCHEME_NAME_MAX} 个字符` }
  }
  return { ok: true, name }
}

/**
 * 读取全部方案。存储是不可信输入:解析失败、不是数组、元素缺字段都只丢弃坏数据,
 * 不让界面崩掉;能识别出 id/name/savedAt/state 的条目继续可用。
 */
export function listSchemes(): SavedScheme[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(SCHEMES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const schemes: SavedScheme[] = []
    const seenIds = new Set<string>()
    for (const item of parsed) {
      const scheme = toScheme(item)
      // 重复 id 只保留先出现的一条:后续操作都以 id 为键,重复会让删除/载入歧义
      if (!scheme || seenIds.has(scheme.id)) continue
      seenIds.add(scheme.id)
      schemes.push(scheme)
    }
    return schemes
  } catch {
    return []
  }
}

/**
 * 按 id 找一条方案;找不到(含被手工删掉)返回 null。
 * 返回的 state 仍是不可信 JSON:调用方载入前必须走 adoptCoverState,不要直接塞进受控状态。
 */
export function findScheme(id: string): SavedScheme | null {
  return listSchemes().find((scheme) => scheme.id === id) ?? null
}

/**
 * 保存方案。
 *
 * - 名字 trim 后为空/超长:不写存储,返回可展示的失败原因;
 * - 同名(trim 后精确匹配):替换现有条目的 state 与 savedAt,不产生第二条;
 * - 新方案:插到列表最前(最新优先);超过 MAX_SCHEMES 时顶掉 savedAt 最旧的一条。
 */
export function saveScheme(name: string, state: CoverState): SchemeSaveResult {
  const checked = validateSchemeName(name)
  if (!checked.ok) {
    return {
      ok: false,
      message: checked.message,
      schemes: listSchemes(),
      scheme: null,
      replaced: false,
      evicted: null,
    }
  }

  const current = listSchemes()
  const existing = current.find((scheme) => scheme.name === checked.name) ?? null
  const scheme: SavedScheme = {
    // 覆盖时沿用原 id:它标识「这一条方案」,不是「这一次保存」
    id: existing?.id ?? createSchemeId(),
    name: checked.name,
    savedAt: new Date().toISOString(),
    state,
  }
  // 同名旧条目全部移除(存储可能被手工编辑出重复名),只保留刚更新的这一条
  const merged = [scheme, ...current.filter((item) => item.name !== checked.name)]
  const { list, evicted } = enforceLimit(merged)

  if (!writeSchemes(list)) {
    return {
      ok: false,
      message: '保存失败：本地存储不可用（可能是空间不足或隐私模式）',
      schemes: current,
      scheme: null,
      replaced: false,
      evicted: null,
    }
  }

  const replacedNames = current.some((item) => item.name === checked.name)
  let message = replacedNames ? `已更新同名方案「${checked.name}」` : `已保存「${checked.name}」`
  if (evicted && !replacedNames) {
    message = `已保存「${checked.name}」，并顶替最旧的「${evicted.name}」`
  }
  return { ok: true, message, schemes: list, scheme, replaced: replacedNames, evicted }
}

/** 删除一条方案;写存储失败时返回可展示的失败原因,列表保持原样 */
export function deleteScheme(id: string): SchemeDeleteResult {
  const current = listSchemes()
  const removed = current.find((scheme) => scheme.id === id) ?? null
  if (!removed) {
    return { ok: false, message: '方案不存在或已被删除', schemes: current, removed: null }
  }
  const list = current.filter((scheme) => scheme.id !== id)
  if (!writeSchemes(list)) {
    return {
      ok: false,
      message: '删除失败：本地存储不可用（可能是空间不足或隐私模式）',
      schemes: current,
      removed: null,
    }
  }
  return { ok: true, message: `已删除「${removed.name}」`, schemes: list, removed }
}

/** 保存时间显示为 MM-DD HH:mm(本地时区);非法时间不抛错,给一句兜底 */
export function formatSchemeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未知'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把单条不可信元素收成 SavedScheme;缺任一必需字段即判为救不了,丢弃 */
function toScheme(value: unknown): SavedScheme | null {
  if (!isRecord(value)) return null
  const { id, name, savedAt, state } = value
  if (typeof id !== 'string' || !id) return null
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed) return null
  if (typeof savedAt !== 'string' || !savedAt) return null
  // state 只要求是对象:内容级修复统一交给 adoptCoverState,此处不另写校验
  if (!isRecord(state)) return null
  return {
    id,
    name: trimmed.slice(0, SCHEME_NAME_MAX),
    savedAt,
    state: state as unknown as CoverState,
  }
}

/** 按 savedAt 找最旧的一条并顶掉;时间非法视为最旧,同刻优先顶列表尾部 */
function enforceLimit(input: SavedScheme[]): { list: SavedScheme[]; evicted: SavedScheme | null } {
  const list = [...input]
  let evicted: SavedScheme | null = null
  while (list.length > MAX_SCHEMES) {
    let oldestIndex = list.length - 1
    let oldestAt = Number.POSITIVE_INFINITY
    for (let i = 0; i < list.length; i++) {
      const parsed = Date.parse(list[i].savedAt)
      const at = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
      // <= 让同刻时选列表更靠后的条目:新方案插在最前,不会被自己顶掉
      if (at <= oldestAt) {
        oldestAt = at
        oldestIndex = i
      }
    }
    const [removed] = list.splice(oldestIndex, 1)
    evicted = removed
  }
  return { list, evicted }
}

function writeSchemes(schemes: SavedScheme[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(SCHEMES_STORAGE_KEY, JSON.stringify(schemes))
    return true
  } catch {
    return false
  }
}

/** 稳定 id:优先 crypto.randomUUID;测试/旧环境回落到时间 + 随机串 */
function createSchemeId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID()
  return `scheme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}