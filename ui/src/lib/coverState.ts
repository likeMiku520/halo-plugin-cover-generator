import type { CoverState } from './types'
import { defaultCoverState } from './layout'

/**
 * 构造完整 CoverState 的测试工厂。
 *
 * 状态对象在本次改造中扩了字段（标题模式、锚点布局、自定义元素），
 * 若各 spec 继续手写整个字面量，每加一个字段就要全量修改一遍；
 * 统一走工厂 + 覆盖片段，新增字段只需在这里补默认值。
 */
export function makeCoverState(overrides: Partial<CoverState> = {}): CoverState {
  const base = defaultCoverState()
  return {
    ...base,
    ...overrides,
    layout: { ...base.layout, ...overrides.layout },
    customElements: overrides.customElements ?? base.customElements,
  }
}