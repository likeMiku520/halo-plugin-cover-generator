import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import type { CoverState } from '../lib/types'
import { makeCoverState } from '../lib/coverState'
import { DEFAULT_COALESCE_MS, DEFAULT_HISTORY_LIMIT, useHistory } from './useHistory'

/** 每次 createHistory 都建在独立作用域里,afterEach 统一销毁,避免 watch 跨用例泄漏 */
const scopes: EffectScope[] = []

function createHistory(
  initial: Partial<CoverState> = {},
  opts: { limit?: number; coalesceMs?: number } = {},
) {
  const state = ref(makeCoverState(initial))
  const scope = effectScope()
  const history = scope.run(() => useHistory(state, opts))
  if (!history) throw new Error('useHistory 未能在作用域内初始化')
  scopes.push(scope)
  return { state, ...history, scope }
}

beforeEach(() => {
  // 合并窗口以 Date.now() 计时,假定时器同时冻结/推进它
  vi.useFakeTimers()
})

afterEach(() => {
  for (const scope of scopes) scope.stop()
  scopes.length = 0
  vi.useRealTimers()
})

describe('useHistory 基本撤销/重做', () => {
  it('undo 回到上一步,撤到底后 canUndo 归 false', () => {
    const { state, undo, canUndo } = createHistory({ titleFlow: '初始' })

    state.value.titleFlow = '第一步'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    state.value.titleFlow = '第二步'
    expect(canUndo.value).toBe(true)

    undo()
    expect(state.value.titleFlow).toBe('第一步')
    undo()
    expect(state.value.titleFlow).toBe('初始')
    expect(canUndo.value).toBe(false)

    // 空栈再撤是安全的 no-op
    undo()
    expect(state.value.titleFlow).toBe('初始')
  })

  it('redo 恢复被撤销的状态,重做到头后 canRedo 归 false', () => {
    const { state, undo, redo, canRedo } = createHistory({ titleFlow: '初始' })

    state.value.titleFlow = '改过'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    undo()
    expect(state.value.titleFlow).toBe('初始')
    expect(canRedo.value).toBe(true)

    redo()
    expect(state.value.titleFlow).toBe('改过')
    expect(canRedo.value).toBe(false)

    // 空栈再重做同样是 no-op
    redo()
    expect(state.value.titleFlow).toBe('改过')
  })

  it('默认步数上限是 50', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(50)
    expect(DEFAULT_COALESCE_MS).toBe(400)
  })
})

describe('useHistory 同一手势合并', () => {
  it('连续快速改 5 次(间隔小于窗口)只记一步:一次 undo 回到最初', () => {
    const { state, undo, canUndo } = createHistory({ titleFlow: '最初' })

    for (let i = 1; i <= 5; i++) state.value.titleFlow = `第 ${i} 次`

    undo()
    expect(state.value.titleFlow).toBe('最初')
    expect(canUndo.value).toBe(false)
  })

  it('合并组结束后的新一步,落点是合并组最后一次改动后的状态', () => {
    const { state, undo } = createHistory({ titleFlow: '最初' })

    for (let i = 1; i <= 5; i++) state.value.titleFlow = `第 ${i} 次`
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    state.value.titleFlow = '分界后的改动'

    undo()
    expect(state.value.titleFlow).toBe('第 5 次')
    undo()
    expect(state.value.titleFlow).toBe('最初')
  })

  it('窗口是开区间:间隔 399ms 仍并入上一步', () => {
    const { state, undo, canUndo } = createHistory({ titleFlow: '最初' })

    state.value.titleFlow = 'A'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS - 1)
    state.value.titleFlow = 'B'

    undo()
    expect(state.value.titleFlow).toBe('最初')
    expect(canUndo.value).toBe(false)
  })

  it('间隔达到 400ms 即起算新的一步', () => {
    const { state, undo, canUndo } = createHistory({ titleFlow: '最初' })

    state.value.titleFlow = 'A'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    state.value.titleFlow = 'B'

    undo()
    expect(state.value.titleFlow).toBe('A')
    undo()
    expect(state.value.titleFlow).toBe('最初')
    expect(canUndo.value).toBe(false)
  })
})

describe('useHistory 分支与上限', () => {
  it('undo 之后马上改:不被并进已撤销的那一步,且清空重做栈', () => {
    const { state, undo, redo, canRedo, canUndo } = createHistory({ titleFlow: '初始' })

    state.value.titleFlow = '改过'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    undo()
    expect(canRedo.value).toBe(true)

    // 与上一次变化同一时刻:窗口已因 undo 重置,这里必须新起一步
    state.value.titleFlow = '撤销后的新改动'
    expect(canRedo.value).toBe(false)

    // 重做栈已作废,redo 不得把状态跳回旧分支
    redo()
    expect(state.value.titleFlow).toBe('撤销后的新改动')

    undo()
    expect(state.value.titleFlow).toBe('初始')
    expect(canUndo.value).toBe(false)
  })

  it('超过 limit 丢最旧的:只能退回到保留窗口的边界', () => {
    const { state, undo, canUndo } = createHistory({ titleFlow: 'S0' }, { limit: 3 })

    for (let i = 1; i <= 5; i++) {
      state.value.titleFlow = `S${i}`
      vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    }

    undo()
    expect(state.value.titleFlow).toBe('S4')
    undo()
    expect(state.value.titleFlow).toBe('S3')
    undo()
    expect(state.value.titleFlow).toBe('S2')
    expect(canUndo.value).toBe(false)

    // S0/S1 已被裁掉,再撤也不会回到更早的分支
    undo()
    expect(state.value.titleFlow).toBe('S2')
  })

  it('快照是独立深拷贝:改恢复出来的嵌套对象,不污染历史里的另一步', () => {
    const { state, undo } = createHistory({ titleFlow: '初始' })
    const firstStop = state.value.gradient.stops[0].color

    // 第一步只改嵌套字段
    state.value.layout.title.scale = 2
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    // 第二步再改另一个字段,把「scale=2」那一刻压进撤销栈
    state.value.subtitle = '第二段'

    undo()
    expect(state.value.layout.title.scale).toBe(2)

    // 直接改恢复出来的对象:它必须与栈里的快照不共享任何嵌套容器
    state.value.layout.title.scale = 9
    state.value.gradient.stops[0].color = '#123456'

    undo() // 撤掉这次就地改动,回到刚恢复的那份快照
    expect(state.value.layout.title.scale).toBe(2)

    undo() // 再退一步到最初:最早那份快照不得被刚才的修改改写
    expect(state.value.layout.title.scale).toBe(1)
    expect(state.value.gradient.stops[0].color).toBe(firstStop)
    expect(state.value.subtitle).toBe('')
  })

  it('clear 清空两侧栈,并以当前状态作为新基线', () => {
    const { state, clear, undo, canUndo, canRedo } = createHistory({ titleFlow: '初始' })

    state.value.titleFlow = 'A'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)
    undo()
    expect(canRedo.value).toBe(true)

    clear()
    expect(canUndo.value).toBe(false)
    expect(canRedo.value).toBe(false)

    // clear 后的首次改动,撤销落点是 clear 那一刻的状态
    state.value.titleFlow = 'B'
    undo()
    expect(state.value.titleFlow).toBe('初始')
  })
})

describe('useHistory 生命周期', () => {
  it('作用域销毁后停掉 watch:销毁后的改动不再入账', () => {
    const { state, scope, undo, canRedo } = createHistory({ titleFlow: '初始' })

    state.value.titleFlow = '销毁前'
    vi.advanceTimersByTime(DEFAULT_COALESCE_MS)

    scope.stop()
    // 若 watch 没停,这一步会再压一个「销毁前」快照,undo 就只会退到这里
    state.value.titleFlow = '销毁后'

    undo()
    expect(state.value.titleFlow).toBe('初始')
    expect(canRedo.value).toBe(true)
  })
})