import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { CoverState } from '../lib/types'

/** 撤销栈默认步数上限:再往回翻也记不住,只是白占内存 */
export const DEFAULT_HISTORY_LIMIT = 50

/**
 * 同一手势的合并窗口(毫秒)。
 *
 * 拖一条滑杆每秒会写出几十次状态,若每次都压栈,撤销一次只退一个像素。
 * 这里以「相邻两次变化的间隔」判定是否仍在同一手势:小于窗口就并入上一步。
 * 400ms 远大于一帧(约 16ms),又小于人停一下再动手的间隔,正好把
 * 「一口气拖完」与「改一下、停一下、再改一下」分开。
 */
export const DEFAULT_COALESCE_MS = 400

export interface UseHistoryOptions {
  /** 撤销步数上限,默认 50;超出丢最旧的 */
  limit?: number
  /** 连续变化的合并窗口(毫秒),默认 400;0 表示每步都单独立账 */
  coalesceMs?: number
}

export interface UseHistoryApi {
  undo: () => void
  redo: () => void
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** 清空两侧栈,并以当前状态作为新的起点(切换文档/载入存档时用) */
  clear: () => void
}

/**
 * 深拷贝:只复制容器(对象/数组),字符串等原始值按不可变语义共享引用。
 * CoverState 的结构全是 JSON 形状的数据,这比 JSON 往返便宜得多——
 * Logo 的 dataURL 动辄上百 KB,不必在每次拖动时重新抄一遍字符。
 */
function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item))
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) copy[key] = cloneValue(item)
    return copy
  }
  return value
}

function cloneState(state: CoverState): CoverState {
  return cloneValue(state) as CoverState
}

/** 读上限:非有限值收回到默认档,免得 NaN/Infinity 让栈永不裁剪 */
function readLimit(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_HISTORY_LIMIT
  return Math.max(0, Math.floor(v))
}

/** 读合并窗口:负数按 0(不合并)处理 */
function readCoalesceMs(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_COALESCE_MS
  return Math.max(0, v)
}

/**
 * 为一份可变的 CoverState 提供撤销 / 重做。
 *
 * 设计要点:
 * - 撤销栈里存的是「变化前」的独立快照,当前状态永远不进栈;
 *   只有在 undo/redo 时才把当前状态抄进另一侧栈。
 * - `baseline` 记录「上一次观察到的状态」。同一手势内的后续变化不压栈,
 *   但必须把 baseline 推进到最新值——否则手势结束后的下一步,落点会
 *   错成手势开始之前的状态(合并组中间的改动就被跳过了)。
 * - 恢复历史时先深拷贝再写回 state:栈里的快照与工作状态不共享任何对象,
 *   恢复后继续编辑不会反过来改写历史。
 * - undo/redo 之后把合并窗口重置为「没有上一次变化」,使紧接着的编辑
 *   必定新起一步并清空重做栈,而不是被并进刚撤销的那一步。
 *
 * watch 用 `flush: 'sync'` 而不是默认的异步批处理:`applying` 守卫必须在
 * 写回 state 的同一段同步代码里拦住回调,否则恢复动作会被自己记成一次
 * 用户改动(异步回调时守卫早已复位)。
 */
export function useHistory(
  state: Ref<CoverState>,
  opts: { limit?: number; coalesceMs?: number } = {},
): UseHistoryApi {
  const limit = readLimit(opts.limit)
  const coalesceMs = readCoalesceMs(opts.coalesceMs)

  // shallowRef + 整体换数组:快照本身不需要成为响应式代理,
  // 只有栈长度参与 canUndo/canRedo 的计算
  const undoStack = shallowRef<CoverState[]>([])
  const redoStack = shallowRef<CoverState[]>([])

  /** 上一次已知状态的快照:下一步撤销要回到的位置 */
  let baseline = cloneState(state.value)
  /** 上一次观察到变化的时间;null 表示窗口已关闭(初始化/撤销恢复之后) */
  let lastChangeAt: number | null = null
  /** 正在把历史写回 state:此时的 watch 触发不是用户改动 */
  let applying = false

  /** 入栈并按上限裁掉最旧的 */
  function appendTo(stack: CoverState[], snapshot: CoverState): CoverState[] {
    const next = [...stack, snapshot]
    return next.length > limit ? next.slice(next.length - limit) : next
  }

  /** 把快照写回 state,并把它当作新的观察基线 */
  function restore(snapshot: CoverState) {
    const restored = cloneState(snapshot)
    applying = true
    try {
      state.value = restored
    } finally {
      applying = false
    }
    baseline = cloneState(restored)
    // 恢复之后重新开窗:紧接着的编辑必须自成一个撤销步骤
    lastChangeAt = null
  }

  const stop = watch(
    state,
    () => {
      if (applying) return
      const now = Date.now()
      const within = lastChangeAt !== null && now - lastChangeAt < coalesceMs
      // 任何用户改动都作废重做分支:undo 之后的新改动尤其如此,
      // 否则 redo 会跳到已经被改过、不再相关的分支上
      if (redoStack.value.length > 0) redoStack.value = []
      if (!within) undoStack.value = appendTo(undoStack.value, baseline)
      // 同一手势内也要推进基线:下一次新起一步的「变化前」就是此刻
      baseline = cloneState(state.value)
      lastChangeAt = now
    },
    { deep: true, flush: 'sync' },
  )

  function undo() {
    const stack = undoStack.value
    if (stack.length === 0) return
    const snapshot = stack[stack.length - 1]
    // 当前状态先入重做栈,再恢复被撤销的那一步
    redoStack.value = [...redoStack.value, cloneState(state.value)]
    undoStack.value = stack.slice(0, -1)
    restore(snapshot)
  }

  function redo() {
    const stack = redoStack.value
    if (stack.length === 0) return
    const snapshot = stack[stack.length - 1]
    undoStack.value = appendTo(undoStack.value, cloneState(state.value))
    redoStack.value = stack.slice(0, -1)
    restore(snapshot)
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
    baseline = cloneState(state.value)
    lastChangeAt = null
  }

  // 组件作用域销毁(离开工作台)时停掉 watch;不在作用域里调用时不吵
  onScopeDispose(stop, true)

  return {
    undo,
    redo,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    clear,
  }
}