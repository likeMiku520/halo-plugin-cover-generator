import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HistoryBar from './HistoryBar.vue'

function mountBar(props: Partial<{ canUndo: boolean; canRedo: boolean }> = {}) {
  return mount(HistoryBar, {
    props: { canUndo: true, canRedo: true, ...props },
  })
}

const SELECTOR = {
  undo: 'button[aria-label="撤销"]',
  redo: 'button[aria-label="重做"]',
} as const

describe('HistoryBar 事件', () => {
  it('点击撤销 / 重做分别 emit,互不串事件', async () => {
    const wrapper = mountBar()

    await wrapper.find(SELECTOR.undo).trigger('click')
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('redo')).toBeUndefined()

    await wrapper.find(SELECTOR.redo).trigger('click')
    expect(wrapper.emitted('redo')).toHaveLength(1)
    expect(wrapper.emitted('undo')).toHaveLength(1)

    wrapper.unmount()
  })

  it('canUndo=false:撤销按钮 disabled、aria-disabled=true,点击不 emit', async () => {
    const wrapper = mountBar({ canUndo: false })
    const button = wrapper.find(SELECTOR.undo)

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-disabled')).toBe('true')

    await button.trigger('click')
    expect(wrapper.emitted('undo')).toBeUndefined()

    // 一把锁只锁自己:重做仍然可用
    expect(wrapper.find(SELECTOR.redo).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('canRedo=false:重做按钮 disabled、aria-disabled=true,点击不 emit', async () => {
    const wrapper = mountBar({ canRedo: false })
    const button = wrapper.find(SELECTOR.redo)

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-disabled')).toBe('true')

    await button.trigger('click')
    expect(wrapper.emitted('redo')).toBeUndefined()

    expect(wrapper.find(SELECTOR.undo).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('可用态:两个按钮都不带 disabled,aria-disabled 与之一致为 false', () => {
    const wrapper = mountBar()

    for (const selector of Object.values(SELECTOR)) {
      const button = wrapper.find(selector)
      expect(button.attributes('disabled')).toBeUndefined()
      expect(button.attributes('aria-disabled')).toBe('false')
    }

    wrapper.unmount()
  })
})

describe('HistoryBar 结构与可访问名称', () => {
  it('两个图标按钮都有 aria-label,并声明 type="button"', () => {
    const wrapper = mountBar()

    expect(wrapper.find(SELECTOR.undo).attributes('aria-label')).toBe('撤销')
    expect(wrapper.find(SELECTOR.redo).attributes('aria-label')).toBe('重做')
    for (const selector of Object.values(SELECTOR)) {
      expect(wrapper.find(selector).attributes('type')).toBe('button')
    }

    wrapper.unmount()
  })

  it('图标是 14×14 的内联 SVG 弯箭头,按钮内没有文字', () => {
    const wrapper = mountBar()

    for (const selector of Object.values(SELECTOR)) {
      const button = wrapper.find(selector)
      expect(button.text()).toBe('')

      const svg = button.find('svg')
      expect(svg.exists()).toBe(true)
      expect(svg.attributes('width')).toBe('14')
      expect(svg.attributes('height')).toBe('14')
      expect(svg.attributes('viewBox')).toBe('0 0 14 14')

      const paths = svg.findAll('path')
      expect(paths.length).toBeGreaterThan(0)
      for (const path of paths) {
        expect(path.attributes('stroke')).toBe('currentColor')
        expect(path.attributes('stroke-width')).toBe('1.4')
        expect(path.attributes('stroke-linecap')).toBe('round')
      }
    }

    wrapper.unmount()
  })

  it('根节点只是横向 flex 容器,不给自己加定位', () => {
    const wrapper = mountBar()
    const root = wrapper.find('.history-bar')
    expect(root.exists()).toBe(true)
    expect(root.element.tagName).toBe('DIV')
    expect(root.attributes('style')).toBeUndefined()
    wrapper.unmount()
  })
})