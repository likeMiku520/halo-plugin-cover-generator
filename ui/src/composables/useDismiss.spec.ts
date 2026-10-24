import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useDismiss } from './useDismiss'

type CloseReason = 'outside' | 'escape'

/** 挂载最小宿主:el 为根 div,open 受控,浮层内容随 open 渲染 */
function mountHost(open: Ref<boolean>, onClose: (r: CloseReason) => void) {
  const Host = defineComponent({
    setup() {
      const el = ref<HTMLElement>()
      useDismiss(el, open, onClose)
      return () => h('div', { ref: el, 'data-testid': 'root' }, open.value ? 'pop' : 'hidden')
    },
  })
  return mount(Host, { attachTo: document.body })
}

describe('useDismiss(评审M12:监听挂/卸生命周期与关闭原因)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('open 期间 document 挂 pointerdown/keydown 监听;Esc 触发 onClose("escape")', async () => {
    const addDoc = vi.spyOn(document, 'addEventListener')
    const onClose = vi.fn<(r: CloseReason) => void>()
    const open = ref(false)
    const wrapper = mountHost(open, onClose)
    expect(addDoc.mock.calls.filter(([name]) => name === 'pointerdown' || name === 'keydown')).toHaveLength(0)

    open.value = true
    await wrapper.vm.$nextTick()
    expect(addDoc.mock.calls.some(([name]) => name === 'pointerdown')).toBe(true)
    expect(addDoc.mock.calls.some(([name]) => name === 'keydown')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledWith('escape')
    wrapper.unmount()
  })

  it('open 置 false 即摘除监听(同引用),此后 Esc 不再触发', async () => {
    const addDoc = vi.spyOn(document, 'addEventListener')
    const rmDoc = vi.spyOn(document, 'removeEventListener')
    const onClose = vi.fn<(r: CloseReason) => void>()
    const open = ref(true)
    const wrapper = mountHost(open, onClose)
    await wrapper.vm.$nextTick()

    const pointerdownFn = addDoc.mock.calls.find(([name]) => name === 'pointerdown')?.[1]
    const keydownFn = addDoc.mock.calls.find(([name]) => name === 'keydown')?.[1]
    expect(pointerdownFn).toBeTypeOf('function')
    expect(keydownFn).toBeTypeOf('function')

    open.value = false
    await wrapper.vm.$nextTick()
    expect(rmDoc).toHaveBeenCalledWith('pointerdown', pointerdownFn)
    expect(rmDoc).toHaveBeenCalledWith('keydown', keydownFn)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('组件卸载兜底摘除监听(防 I2 式泄漏)', async () => {
    const rmDoc = vi.spyOn(document, 'removeEventListener')
    const onClose = vi.fn<(r: CloseReason) => void>()
    const open = ref(true)
    const wrapper = mountHost(open, onClose)
    await wrapper.vm.$nextTick()

    wrapper.unmount()
    expect(rmDoc).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(rmDoc).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('pointerdown 落在 el 外触发 onClose("outside");落在 el 内不关', async () => {
    const onClose = vi.fn<(r: CloseReason) => void>()
    const open = ref(true)
    const wrapper = mountHost(open, onClose)
    await wrapper.vm.$nextTick()

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('outside')

    // el 内(根 div 自身)不触发
    wrapper.find('[data-testid="root"]').element.dispatchEvent(
      new Event('pointerdown', { bubbles: true }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
