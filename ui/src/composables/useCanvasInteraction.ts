import { computed, ref } from 'vue'
import type { AnchorKey, AnchorMap } from '../lib/types'

/** 可交互目标：四个内置元素 + 自定义元素 */
export type SelectionId = AnchorKey | `custom:${string}`

export const ANCHOR_KEYS: AnchorKey[] = ['logo', 'title', 'subtitle', 'watermark']

const SELECTION_LABEL: Record<AnchorKey, string> = {
  logo: 'Logo',
  title: '标题',
  subtitle: '副标题',
  watermark: '水印',
}

export function anchorLabel(key: AnchorKey): string {
  return SELECTION_LABEL[key]
}

/** 微调步长：方向键 1 步，Shift+方向键 10 步（单位为画布宽/高的千分之一） */
const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

/**
 * 画布选中态与键盘微调。
 *
 * 选中只由「元素」面板驱动（画布是纯预览，不接收点击），
 * 因此这里不持有指针会话，只维护当前选中项与位置微调。
 */
export function useCanvasInteraction() {
  const selected = ref<SelectionId | null>(null)

  const hasSelection = computed(() => selected.value !== null)

  function select(id: SelectionId | null) {
    selected.value = id
  }

  /**
   * 键盘微调：方向键移动选中元素，Shift 加大步长。
   * 返回更新后的锚点与目标 id；非方向键或未选中时返回 null。
   */
  function nudge(
    ev: KeyboardEvent,
    layout: AnchorMap,
  ): { id: SelectionId; anchor: { x: number; y: number; scale: number } } | null {
    const id = selected.value
    if (!id) return null
    const step = (ev.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP) / 1000
    const current = anchorOf(layout, id)
    if (!current) return null
    let dx = 0
    let dy = 0
    switch (ev.key) {
      case 'ArrowLeft': dx = -step; break
      case 'ArrowRight': dx = step; break
      case 'ArrowUp': dy = -step; break
      case 'ArrowDown': dy = step; break
      default: return null
    }
    ev.preventDefault()
    return { id, anchor: { ...current, x: current.x + dx, y: current.y + dy } }
  }

  return { selected, hasSelection, select, nudge }
}

/** 从布局表中取某目标锚点；自定义元素不在其中，由调用方单独处理 */
export function anchorOf(layout: AnchorMap, id: SelectionId) {
  const key = id as AnchorKey
  return ANCHOR_KEYS.includes(key) ? layout[key] : null
}