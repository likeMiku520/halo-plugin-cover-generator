import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CoverState } from './types'
import { makeCoverState } from './coverState'
import {
  MAX_SCHEMES,
  SCHEMES_STORAGE_KEY,
  SCHEME_NAME_MAX,
  deleteScheme,
  findScheme,
  formatSchemeTime,
  listSchemes,
  saveScheme,
  validateSchemeName,
} from './schemes'

/** 直接读原始 JSON:用于断言真正落盘的内容,而不是模块返回的内存视图 */
function persisted(): unknown {
  const raw = localStorage.getItem(SCHEMES_STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

function persistedList(): Array<Record<string, unknown>> {
  return persisted() as Array<Record<string, unknown>>
}

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('schemes 保存', () => {
  it('保存新增一条,完整字段落盘且可读回', () => {
    const state: CoverState = makeCoverState({ titleFlow: '周报封面', watermark: 'blog.example.com' })
    const result = saveScheme('周报', state)

    expect(result.ok).toBe(true)
    expect(result.replaced).toBe(false)
    expect(result.evicted).toBeNull()
    expect(result.message).toContain('已保存')

    const list = listSchemes()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('周报')
    expect(list[0].id).toBeTruthy()
    expect(Number.isNaN(Date.parse(list[0].savedAt))).toBe(false)
    expect(list[0].state.titleFlow).toBe('周报封面')
    expect(list[0].state.watermark).toBe('blog.example.com')

    const raw = persistedList()
    expect(raw).toHaveLength(1)
    expect(raw[0].id).toBe(list[0].id)
    expect(raw[0].name).toBe('周报')
    expect((raw[0].state as CoverState).titleFlow).toBe('周报封面')
  })

  it('同名(trim 后)保存覆盖原条目:条数不变、id 保留、savedAt 更新、状态替换', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T08:00:00.000Z'))
    const first = saveScheme('海报', makeCoverState({ titleFlow: '旧标题' }))
    expect(first.scheme).not.toBeNull()
    const id = first.scheme!.id
    const savedAt = first.scheme!.savedAt

    vi.setSystemTime(new Date('2026-10-31T09:00:00.000Z'))
    const second = saveScheme('  海报  ', makeCoverState({ titleFlow: '新标题' }))

    expect(second.ok).toBe(true)
    expect(second.replaced).toBe(true)
    expect(second.message).toContain('更新')
    const list = listSchemes()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].savedAt).not.toBe(savedAt)
    expect(list[0].state.titleFlow).toBe('新标题')
  })

  it('名字 trim 后入库;空名与超长名拒绝且不改动已存列表', () => {
    const accepted = saveScheme('  活动  ', makeCoverState())
    expect(accepted.ok).toBe(true)
    expect(accepted.scheme!.name).toBe('活动')

    const before = listSchemes()
    const blank = saveScheme('   ', makeCoverState())
    expect(blank.ok).toBe(false)
    expect(blank.message).toContain('请输入方案名')
    expect(listSchemes()).toHaveLength(before.length)

    const tooLong = saveScheme('长'.repeat(SCHEME_NAME_MAX + 1), makeCoverState())
    expect(tooLong.ok).toBe(false)
    expect(tooLong.message).toContain(String(SCHEME_NAME_MAX))
    expect(listSchemes()).toHaveLength(before.length)

    // 边界值 40 字必须放行
    const edge = saveScheme('名'.repeat(SCHEME_NAME_MAX), makeCoverState())
    expect(edge.ok).toBe(true)
  })

  it('validateSchemeName 独立可用:返回 trim 后的名字或可展示原因', () => {
    expect(validateSchemeName('  周报  ')).toEqual({ ok: true, name: '周报' })
    expect(validateSchemeName('')).toEqual({ ok: false, message: '请输入方案名' })
    expect(validateSchemeName('   ').ok).toBe(false)
    expect(validateSchemeName('字'.repeat(SCHEME_NAME_MAX + 1)).ok).toBe(false)
  })
})

describe('schemes 数量上限', () => {
  /** 造 30 条 saveAt 递增的旧方案(数组顺序即插入顺序) */
  function seedFullList() {
    vi.useFakeTimers()
    for (let i = 0; i < MAX_SCHEMES; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, i, 0)))
      const result = saveScheme(`旧方案 ${i}`, makeCoverState())
      expect(result.ok).toBe(true)
    }
  }

  it(`超过 ${MAX_SCHEMES} 条时顶掉 savedAt 最旧的一条,列表仍为 ${MAX_SCHEMES} 条`, () => {
    seedFullList()
    expect(listSchemes()).toHaveLength(MAX_SCHEMES)

    vi.setSystemTime(new Date('2026-10-31T12:00:00.000Z'))
    const result = saveScheme('新方案', makeCoverState())

    expect(result.ok).toBe(true)
    expect(result.evicted?.name).toBe('旧方案 0')
    expect(result.message).toContain('顶替')
    const list = listSchemes()
    expect(list).toHaveLength(MAX_SCHEMES)
    expect(list.some((scheme) => scheme.name === '旧方案 0')).toBe(false)
    expect(list[0].name).toBe('新方案')
  })

  it('满额时同名覆盖只更新、不触发淘汰', () => {
    seedFullList()
    vi.setSystemTime(new Date('2026-10-31T12:00:00.000Z'))
    const result = saveScheme('旧方案 5', makeCoverState({ titleFlow: '改过' }))

    expect(result.ok).toBe(true)
    expect(result.replaced).toBe(true)
    expect(result.evicted).toBeNull()
    const list = listSchemes()
    expect(list).toHaveLength(MAX_SCHEMES)
    expect(list.find((scheme) => scheme.name === '旧方案 5')?.state.titleFlow).toBe('改过')
  })
})

describe('schemes 删除与查询', () => {
  it('按 id 删除并落盘;未知 id 给出提示且不改动列表', () => {
    const a = saveScheme('甲', makeCoverState()).scheme!
    saveScheme('乙', makeCoverState())

    const removed = deleteScheme(a.id)
    expect(removed.ok).toBe(true)
    expect(removed.message).toContain('甲')
    expect(listSchemes().map((scheme) => scheme.name)).toEqual(['乙'])
    expect(persistedList()).toHaveLength(1)

    const missing = deleteScheme('not-exist')
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('不存在')
    expect(listSchemes()).toHaveLength(1)
  })

  it('findScheme 按 id 返回原条目,找不到返回 null(载入仍由调用方收敛)', () => {
    const state = makeCoverState({ titleFlow: '原始' })
    const saved = saveScheme('原样', state).scheme!
    expect(findScheme(saved.id)?.state.titleFlow).toBe('原始')
    expect(findScheme('nope')).toBeNull()
  })
})

describe('schemes 损坏存储', () => {
  it('非 JSON 与非数组都视为空,之后仍可正常保存', () => {
    localStorage.setItem(SCHEMES_STORAGE_KEY, '{oops')
    expect(listSchemes()).toEqual([])

    localStorage.setItem(SCHEMES_STORAGE_KEY, JSON.stringify({ name: '不是数组' }))
    expect(listSchemes()).toEqual([])

    localStorage.setItem(SCHEMES_STORAGE_KEY, JSON.stringify([1, null, 'x']))
    expect(listSchemes()).toEqual([])

    const result = saveScheme('恢复', makeCoverState())
    expect(result.ok).toBe(true)
    expect(listSchemes()).toHaveLength(1)
  })

  it('数组中缺字段/类型错误的元素被忽略,能救的条目继续可用', () => {
    const good = saveScheme('可用', makeCoverState({ titleFlow: '保留' })).scheme!
    const goodRaw = persistedList()[0]
    const savedAt = new Date().toISOString()
    localStorage.setItem(
      SCHEMES_STORAGE_KEY,
      JSON.stringify([
        goodRaw,
        null,
        42,
        'oops',
        {},
        { id: good.id }, // 与好条目同 id,且缺其余字段
        { id: 'no-name', savedAt, state: makeCoverState() },
        { id: 'no-time', name: '缺时间', state: makeCoverState() },
        { id: 'no-state', name: '缺状态', savedAt },
        { id: 'bad-state', name: '状态非对象', savedAt, state: 'not-an-object' },
      ]),
    )

    const list = listSchemes()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('可用')
    expect(findScheme(good.id)?.state.titleFlow).toBe('保留')
  })

  it('localStorage 读写抛异常时不崩:读为空,写失败给出可读提示', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(listSchemes()).toEqual([])
    getSpy.mockRestore()

    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const result = saveScheme('写不进', makeCoverState())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('失败')
    expect(listSchemes()).toEqual([])
    setSpy.mockRestore()
  })
})

describe('schemes 时间展示', () => {
  it('按本地时区显示 MM-DD HH:mm;非法时间有兜底', () => {
    // 用本地时间构造,断言不依赖运行环境的时区
    const local = new Date(2026, 9, 31, 12, 30)
    expect(formatSchemeTime(local.toISOString())).toBe('10-31 12:30')
    expect(formatSchemeTime('not-a-date')).toBe('时间未知')
  })
})