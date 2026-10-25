import { describe, expect, it } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import CanvasOverlay from './CanvasOverlay.vue'
import { defaultCoverState } from '../lib/layout'
import { builtinBoxes, customBoxes } from '../lib/elementGeometry'
import { createMeasure, makeCtx } from '../lib/svgBuilder'
import type { Anchor, CoverState, CustomElement } from '../lib/types'
import type { AnchorPatch, SelectionId } from '../composables/useCanvasInteraction'

/**
 * 预览交互层。
 *
 * jsdom 没有真实布局，所有矩形都是 0，因此把交互层的矩形桩成画布尺寸：
 * 指针的 clientX/clientY 于是与画布像素一一对应，坐标断言可预测。
 * 断言落在 emit 出去的状态更新值上（写回由工作台完成），而不是「函数被调用过」。
 */
const CANVAS = { width: 1200, height: 600 }

function makeState(patch: Partial<CoverState> = {}): CoverState {
  return { ...defaultCoverState(), canvas: { ...CANVAS }, ...patch }
}

/** 与组件同源的包围盒（同一个 elementGeometry），用于算出指针该落在哪 */
function boxesOf(state: CoverState) {
  const ctx = makeCtx(state.canvas)
  const measure = createMeasure(null)
  return [
    ...builtinBoxes(state, measure, ctx, false),
    ...customBoxes(state.customElements, measure, ctx),
  ]
}

function stubRect(el: Element, width: number, height: number) {
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect
}

function mountOverlay(state: CoverState, o: {
  selected?: SelectionId | null
  guides?: boolean
  /** 内置默认 Logo 是否可用：决定 Logo 有没有命中框（也就有没有选中框与手柄） */
  hasLogo?: boolean
} = {}) {
  const wrapper = mount(CanvasOverlay, {
    props: {
      state,
      selected: o.selected ?? null,
      font: null,
      hasLogo: o.hasLogo ?? false,
      guides: o.guides ?? false,
    },
  })
  stubRect(wrapper.element, state.canvas.width, state.canvas.height)
  return wrapper
}

type AnchorEmits = [SelectionId, AnchorPatch][]
type SelectEmits = [SelectionId | null][]

const anchorEmits = (w: VueWrapper) => (w.emitted('anchor') ?? []) as AnchorEmits
const selectEmits = (w: VueWrapper) => (w.emitted('select') ?? []) as SelectEmits
/** 最后一次写回的锚点补丁（没有写回时为 undefined） */
const lastAnchor = (w: VueWrapper) => anchorEmits(w)[anchorEmits(w).length - 1]

/**
 * 派发原生指针事件。
 *
 * 不能用 VTU 的 trigger：它会先构造事件、再把 clientX 逐个赋到事件对象上，
 * 而 jsdom 的 clientX 是原型上的只读访问器，赋值直接抛 TypeError。
 */
function pointer(w: VueWrapper, type: string, init: { clientX?: number; clientY?: number } = {}) {
  const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })
  w.element.dispatchEvent(ev)
  return ev
}

/** 在某具体元素上派发事件（手柄这类子节点：要验证它们不被整层逻辑吃掉） */
function pointerOn(
  el: Element,
  type: string,
  init: { clientX?: number; clientY?: number } = {},
) {
  const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })
  el.dispatchEvent(ev)
  return ev
}

/** 指针按下 → 移动；坐标即画布像素 */
async function drag(w: VueWrapper, from: [number, number], to: [number, number]) {
  pointer(w, 'pointerdown', { clientX: from[0], clientY: from[1] })
  await nextTick()
  pointer(w, 'pointermove', { clientX: to[0], clientY: to[1] })
  await nextTick()
}

/** 标题在出厂状态下的中心（画布像素）：整块排版、居中锚点 */
const TITLE_CENTER: [number, number] = [600, 300]

const subtitleAt = (x: number, y: number, scale = 1): Anchor => ({ x, y, scale, opacity: 1, rotation: 0 })

/** 一个可命中的自定义元素（图片按边长 200px 的正方形盒子参与命中） */
function customElement(patch: Partial<CustomElement> = {}): CustomElement {
  return {
    id: 'el-1',
    kind: 'image',
    content: 'data:image/png;base64,AAAA',
    text: '',
    size: 200,
    anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
    color: '#ffffff',
    bold: false,
    tracking: 0,
    curve: 0,
    direction: 'horizontal',
    aspect: 1,
    ...patch,
  }
}

/** 取内联样式:DOMWrapper 的 element 声明类型不含 HTMLElement 的 style */
const inlineStyle = (w: DOMWrapper<Element>) => (w.element as unknown as HTMLElement).style

describe('CanvasOverlay 拖动改位置', () => {
  it('按住元素拖动,按指针位移写回新位置(比例值)', async () => {
    const state = makeState()
    // 前置条件：标题确实在按下点处有命中框，否则用例会在空处按下而失去意义
    const title = boxesOf(state).find((b) => b.id === 'title')!
    expect(TITLE_CENTER[0]).toBeGreaterThan(title.x)
    expect(TITLE_CENTER[0]).toBeLessThan(title.x + title.width)

    const w = mountOverlay(state, { selected: 'title' })
    await drag(w, TITLE_CENTER, [840, 300])

    // 位移 240px / 1200px = 0.2 比例 ⇒ 0.5 + 0.2
    expect(lastAnchor(w)).toEqual(['title', { x: 0.7, y: 0.5 }])
  })

  it('点未选中的元素:先选中它再拖(一次手势完成选中与移动)', async () => {
    const w = mountOverlay(makeState(), { selected: 'logo' })
    await drag(w, TITLE_CENTER, [720, 300])

    expect(selectEmits(w)).toEqual([['title']])
    expect(lastAnchor(w)?.[0]).toBe('title')
  })

  it('元素已选中时拖动不重复发出选中事件', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })
    await drag(w, TITLE_CENTER, [720, 300])

    expect(w.emitted('select')).toBeUndefined()
  })

  it('点空白处:不拖动,并取消选中(没有选中时也不必发事件)', async () => {
    const w = mountOverlay(makeState(), { selected: null })
    pointer(w, 'pointerdown', { clientX: 60, clientY: 540 })
    await nextTick()
    pointer(w, 'pointermove', { clientX: 840, clientY: 300 })
    await nextTick()
    pointer(w, 'pointerup')

    expect(w.emitted('anchor')).toBeUndefined()
    // 本来就没选中：不发无意义的事件
    expect(w.emitted('select')).toBeUndefined()

    const selected = mountOverlay(makeState(), { selected: 'title' })
    pointer(selected, 'pointerdown', { clientX: 60, clientY: 540 })
    await nextTick()

    expect(selectEmits(selected)).toEqual([[null]])
    expect(selected.emitted('anchor')).toBeUndefined()
  })

  it('点中元素仍不取消选中(与空白处相反)', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    pointer(w, 'pointerdown', { clientX: TITLE_CENTER[0], clientY: TITLE_CENTER[1] })
    await nextTick()

    expect(w.emitted('select')).toBeUndefined()
  })

  it('点在选中框自身(外扩的那几像素)上也当作选中该元素,不取消', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })
    // 选中框比图元外扩 6px：点框的左边缘落在图元之外，但不该把选中弄丢
    const ring = w.find('.ring').element
    pointerOn(ring, 'pointerdown', { clientX: 300, clientY: 300 })
    await nextTick()

    expect(w.emitted('select')).toBeUndefined()
  })

  it('拖动中坐标夹在 0–100%(拖出画布不越界)', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    await drag(w, TITLE_CENTER, [5000, 5000])
    expect(lastAnchor(w)).toEqual(['title', { x: 1, y: 1 }])

    await drag(w, TITLE_CENTER, [-5000, -5000])
    expect(lastAnchor(w)).toEqual(['title', { x: 0, y: 0 }])
  })

  it('自定义元素同样可拖动,写回的是它自己的 id', async () => {
    const el = customElement()
    const state = makeState({ customElements: [el] })
    const box = boxesOf(state).find((b) => b.id === 'custom:el-1')!
    const w = mountOverlay(state, { selected: null })

    // 从自定义元素中心向上拖 60px(0.1 高度比例)
    await drag(w, [box.x + box.width / 2, box.y + box.height / 2], [box.x + box.width / 2, 240])

    expect(selectEmits(w)).toEqual([['custom:el-1']])
    expect(lastAnchor(w)).toEqual(['custom:el-1', { x: 0.5, y: 0.4 }])
  })

  it('抬起或取消后不再跟随指针', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })
    await drag(w, TITLE_CENTER, [720, 300])
    pointer(w, 'pointerup')
    await nextTick()
    pointer(w, 'pointermove', { clientX: 1080, clientY: 300 })
    await nextTick()

    expect(anchorEmits(w)).toHaveLength(1)

    await drag(w, TITLE_CENTER, [720, 300])
    pointer(w, 'pointercancel')
    await nextTick()
    pointer(w, 'pointermove', { clientX: 1080, clientY: 300 })
    await nextTick()

    expect(anchorEmits(w)).toHaveLength(2)
  })
})

describe('CanvasOverlay 滚轮改大小', () => {
  /** 直接派发原生滚轮事件：需要读到 defaultPrevented，trigger() 不返回事件对象 */
  async function wheel(w: VueWrapper, init: WheelEventInit) {
    const ev = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init })
    w.element.dispatchEvent(ev)
    await nextTick()
    return ev
  }

  it('选中元素时滚轮改变它的大小,并阻止页面滚动', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    const ev = await wheel(w, { deltaY: -100 })

    expect(lastAnchor(w)).toEqual(['title', { scale: 1.02 }])
    expect(ev.defaultPrevented).toBe(true)
  })

  it('下滚变小,且倍率落在整数百分比上', async () => {
    const w = mountOverlay(makeState(), { selected: 'logo' })

    await wheel(w, { deltaY: 100 })

    const patch = lastAnchor(w)?.[1]
    expect(patch?.scale).toBeCloseTo(0.98, 10)
    expect(Math.abs(patch!.scale! * 100 - Math.round(patch!.scale! * 100))).toBeLessThan(1e-9)
  })

  it('没有选中元素时完全不介入(不阻止页面滚动)', async () => {
    const w = mountOverlay(makeState(), { selected: null })

    const ev = await wheel(w, { deltaY: -100 })

    expect(w.emitted('anchor')).toBeUndefined()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('只作用于选中元素:倍率以该元素自己的当前值为起点', async () => {
    // 副标题出厂大小 50%：滚一格应得到 52%，而不是从 100% 起算
    const state = makeState({ subtitle: '副标题', layout: { ...defaultCoverState().layout, subtitle: subtitleAt(0.5, 0.8, 0.5) } })
    const w = mountOverlay(state, { selected: 'subtitle' })

    await wheel(w, { deltaY: -100 })

    expect(lastAnchor(w)).toEqual(['subtitle', { scale: 0.52 }])
    expect(w.emitted('anchor')).toHaveLength(1)
  })

  it('横向滚动不拦截(交还页面)', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    const ev = await wheel(w, { deltaY: 0, deltaX: 120 })

    expect(w.emitted('anchor')).toBeUndefined()
    expect(ev.defaultPrevented).toBe(false)
  })

  it('边界按选中元素取:副标题到 100% 即停,不再写回(与面板滑杆一致)', async () => {
    const subtitleState = (scale: number) => makeState({
      subtitle: '副标题',
      layout: { ...defaultCoverState().layout, subtitle: subtitleAt(0.5, 0.8, scale) },
    })

    // 99% 起:滚一格刚好停在面板上限 100%
    const at99 = mountOverlay(subtitleState(0.99), { selected: 'subtitle' })
    await wheel(at99, { deltaY: -100 })
    expect(lastAnchor(at99)).toEqual(['subtitle', { scale: 1 }])
    at99.unmount()

    // 已在 100%:不再产生写回(预览层是受控组件,状态得由 props 给出)
    const atMax = mountOverlay(subtitleState(1), { selected: 'subtitle' })
    await wheel(atMax, { deltaY: -100 })
    expect(atMax.emitted('anchor')).toBeUndefined()
    atMax.unmount()
  })
})

describe('CanvasOverlay 智能参考线', () => {
  const guideEls = (w: VueWrapper) => w.findAll('.guide')

  it('关闭时不吸附、也不画线(默认关闭)', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    await drag(w, TITLE_CENTER, [606, 480])

    // 原始位置 0.505 原样写回，没有被吸到中线上
    expect(lastAnchor(w)?.[1].x).toBeCloseTo(0.505, 10)
    expect(guideEls(w)).toHaveLength(0)
  })

  it('开启时吸附到画布中线,并以主题色画出居中细线', async () => {
    const w = mountOverlay(makeState(), { selected: 'title', guides: true })

    await drag(w, TITLE_CENTER, [606, 480])

    expect(lastAnchor(w)?.[1].x).toBeCloseTo(0.5, 10)
    expect(guideEls(w)).toHaveLength(1)
    const guide = guideEls(w)[0]
    expect(guide.classes()).toContain('guide-x') // 垂直线：对齐的是横坐标
    const style = inlineStyle(guide)
    expect(style.left).toBe('50%')
    expect(style.width).toBe('1px')
    expect(style.background).toContain('57, 197, 187') // #39C5BB
  })

  it('与其他元素对齐时吸附到它的中心并画出该线', async () => {
    const state = makeState({
      subtitle: '副标题',
      layout: { ...defaultCoverState().layout, subtitle: subtitleAt(0.3, 0.8) },
    })
    const w = mountOverlay(state, { selected: 'title', guides: true })

    // 指针落在副标题中心(0.3)右侧 2.4px 处
    await drag(w, TITLE_CENTER, [362.4, 240])

    expect(lastAnchor(w)?.[1].x).toBeCloseTo(0.3, 10)
    expect(guideEls(w)).toHaveLength(1)
    expect(parseFloat(inlineStyle(guideEls(w)[0]).left)).toBeCloseTo(30, 6)
  })

  it('松手后参考线消失,但位置仍停在吸附结果上', async () => {
    const w = mountOverlay(makeState(), { selected: 'title', guides: true })
    await drag(w, TITLE_CENTER, [606, 480])
    expect(w.element.classList.contains('is-dragging')).toBe(true)
    expect(guideEls(w)).toHaveLength(1)

    await w.trigger('pointerup')

    expect(guideEls(w)).toHaveLength(0)
    expect(w.element.classList.contains('is-dragging')).toBe(false)
    expect(lastAnchor(w)?.[1].x).toBeCloseTo(0.5, 10)
  })

  it('开关关闭后即使仍在拖动也不显示参考线', async () => {
    const w = mountOverlay(makeState(), { selected: 'title', guides: true })
    await drag(w, TITLE_CENTER, [606, 480])
    expect(guideEls(w)).toHaveLength(1)

    await w.setProps({ guides: false })

    expect(guideEls(w)).toHaveLength(0)
  })
})

describe('CanvasOverlay 交互信号(工作台据此让预览跟手)', () => {
  it('拖动开始与结束各发一次,中间不重复', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    await drag(w, TITLE_CENTER, [720, 300])
    expect(w.emitted('interacting')).toEqual([[true]])

    pointer(w, 'pointerup')
    await nextTick()
    expect(w.emitted('interacting')).toEqual([[true], [false]])
  })

  it('点在空白处不进入交互(不误报拖动)', async () => {
    const w = mountOverlay(makeState(), { selected: null })

    pointer(w, 'pointerdown', { clientX: 60, clientY: 540 })
    await nextTick()

    expect(w.emitted('interacting')).toBeUndefined()
  })

  it('滚轮也标记为交互中(窗口由交互层自行收起)', async () => {
    const w = mountOverlay(makeState(), { selected: 'title' })

    const ev = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true })
    w.element.dispatchEvent(ev)
    await nextTick()

    expect(w.emitted('interacting')).toEqual([[true]])
  })
})

describe('CanvasOverlay 选中框手柄', () => {
  /** 元素锚点在画布上的像素位置：旋转以它为圆心 */
  const anchorPx = (state: CoverState, id: SelectionId) => {
    const box = boxesOf(state).find((b) => b.id === id)!
    return box.pivot ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  it('未选中时不渲染任何手柄', () => {
    const w = mountOverlay(makeState(), { selected: null })

    expect(w.find('.handle-rotate').exists()).toBe(false)
    expect(w.find('.handle-delete').exists()).toBe(false)
  })

  it('选中后右下角是旋转手柄、右上角是删除按钮,都带可访问名称', () => {
    const w = mountOverlay(makeState({ subtitle: '副标题' }), { selected: 'subtitle' })

    expect(w.find('.handle-rotate').attributes('aria-label')).toBe('旋转元素')
    expect(w.find('.handle-delete').attributes('aria-label')).toBe('删除元素')
    // 手柄是真实按钮：键盘也能聚焦并触发
    expect(w.find('.handle-rotate').element.tagName).toBe('BUTTON')
    expect(w.find('.handle-delete').element.tagName).toBe('BUTTON')
  })

  it('标题不渲染删除按钮(标题不可删除),其余元素都有', () => {
    const title = mountOverlay(makeState(), { selected: 'title' })
    expect(title.find('.handle-delete').exists()).toBe(false)
    expect(title.find('.handle-rotate').exists()).toBe(true)

    const logo = mountOverlay(makeState(), { selected: 'logo', hasLogo: true })
    expect(logo.find('.handle-delete').exists()).toBe(true)

    const custom = mountOverlay(makeState({ customElements: [customElement()] }), {
      selected: 'custom:el-1',
    })
    expect(custom.find('.handle-delete').exists()).toBe(true)
  })

  it('拖旋转手柄写回 anchor.rotation,并即时进入交互态', async () => {
    const state = makeState()
    const w = mountOverlay(state, { selected: 'title' })
    const center = anchorPx(state, 'title')

    // 在手柄上按下：以「圆心正右方」为起始角
    pointerOn(w.find('.handle-rotate').element, 'pointerdown', {
      clientX: center.x + 100, clientY: center.y,
    })
    await nextTick()
    // 按下手柄不改变选中、也不进入拖动
    expect(w.emitted('select')).toBeUndefined()
    expect(w.emitted('interacting')).toEqual([[true]])

    // 指针转到圆心正下方 ⇒ 90°
    pointer(w, 'pointermove', { clientX: center.x, clientY: center.y + 100 })
    await nextTick()

    expect(lastAnchor(w)).toEqual(['title', { rotation: 90 }])
  })

  it('旋转能到 ±180,越界收敛,松手结束交互', async () => {
    const state = makeState()
    const w = mountOverlay(state, { selected: 'title' })
    const center = anchorPx(state, 'title')

    pointerOn(w.find('.handle-rotate').element, 'pointerdown', {
      clientX: center.x - 100, clientY: center.y, // 起始角 180°
    })
    await nextTick()
    pointer(w, 'pointermove', { clientX: center.x, clientY: center.y - 100 }) // 转到 −90°
    await nextTick()

    // 180° → −90° 是 −270°，收敛到 −180°
    expect(lastAnchor(w)).toEqual(['title', { rotation: -180 }])

    pointer(w, 'pointerup')
    await nextTick()
    expect(w.emitted('interacting')).toEqual([[true], [false]])
  })

  it('旋转后再拖动位置仍是同一个元素(两个会话互不干扰)', async () => {
    const state = makeState()
    const w = mountOverlay(state, { selected: 'title' })
    const center = anchorPx(state, 'title')

    pointerOn(w.find('.handle-rotate').element, 'pointerdown', {
      clientX: center.x + 100, clientY: center.y,
    })
    await nextTick()
    pointer(w, 'pointermove', { clientX: center.x, clientY: center.y + 100 })
    await nextTick()
    pointer(w, 'pointerup')
    await nextTick()

    await drag(w, TITLE_CENTER, [720, 300])

    expect(lastAnchor(w)).toEqual(['title', { x: 0.6, y: 0.5 }])
  })

  it('点删除按钮上报意图(策略由 deleteSelection 决定,画布不自己删)', async () => {
    // 副标题要有文本才有命中框，也就才有选中框与手柄
    const w = mountOverlay(makeState({ subtitle: '副标题' }), { selected: 'subtitle' })

    await w.find('.handle-delete').trigger('click')

    expect((w.emitted('delete') ?? []) as [SelectionId][]).toEqual([['subtitle']])
    // 只上报:画布不写状态、也不改选中
    expect(w.emitted('anchor')).toBeUndefined()
    expect(w.emitted('select')).toBeUndefined()
  })
})