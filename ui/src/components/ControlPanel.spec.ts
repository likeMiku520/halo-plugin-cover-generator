import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ControlPanel from './ControlPanel.vue'
import type { CoverState } from '../lib/types'
import { makeCoverState } from '../lib/coverState'

// GradientPicker 内含 CSS 解析与预设,与面板级用例无关,以桩隔离
vi.mock('./GradientPicker.vue', () => ({ default: { name: 'GradientPicker', template: '<section />' } }))

const baseState: CoverState = makeCoverState({
  titleLeft: '', titleRight: '', titleFontSize: 210, subtitle: '',
  gradient: { angle: 120, stops: [{ offset: 0, color: '#f6d365' }, { offset: 100, color: '#fda085' }] },
  presetId: null, logoDataUrl: null, logoHidden: false,
  watermark: '',
})

function mountPanel(modelValue: CoverState = baseState, props: Record<string, unknown> = {}) {
  return mount(ControlPanel, {
    props: {
      modelValue,
      defaultLogoUrl: '',
      fontStatus: 'ready',
      ...props,
    },
    attachTo: document.body,
  })
}

/** 轮询等待:UI 侧异步链路(FileReader 等)经由多个宏任务,固定单拍等待不可靠 */
async function until(cond: () => boolean, ms = 500) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    await flushPromises()
  }
}

describe('ControlPanel Logo 从链接导入(评审 M3 代理披露)', () => {
  it('主源 CORS 失败走代理兜底时,界面明示链接已发送给第三方', async () => {
    const realPng = new Blob(['abc'], { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://x.com/')) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, blob: async () => realPng }
    }))
    const wrapper = mountPanel()
    // 链接导入是常驻输入框(A2 打磨),直接录入
    await wrapper.find('input[aria-label="Logo 图片链接"]').setValue('https://x.com/a.png')
    await wrapper.findAll('button').find((b) => b.text() === '导入')!.trigger('click')
    // 导入完成以 update:modelValue 上抛为准(FileReader 链路经多个宏任务)
    await until(() => (wrapper.emitted('update:modelValue')?.length ?? 0) > 0)

    expect(wrapper.find('.proxy-notice').exists()).toBe(true)
    expect(wrapper.find('.proxy-notice').text()).toContain('wsrv.nl')
    expect(wrapper.find('.proxy-notice').text()).toContain('第三方')
    // 导入本身仍然成功:logoDataUrl 已上抛
    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.logoDataUrl).toMatch(/^data:image\/png;base64,/)
    wrapper.unmount()
  })

  it('直连成功(未走代理)不显示披露', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, blob: async () => new Blob(['abc'], { type: 'image/png' }),
    })))
    const wrapper = mountPanel()
    await wrapper.find('input[aria-label="Logo 图片链接"]').setValue('https://x.com/a.png')
    await wrapper.findAll('button').find((b) => b.text() === '导入')!.trigger('click')
    await until(() => (wrapper.emitted('update:modelValue')?.length ?? 0) > 0)
    await flushPromises()

    expect(wrapper.find('.proxy-notice').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ControlPanel Logo 开关与恢复默认(A2)', () => {
  it('开关以 aria-checked 表达显示/隐藏,切换时上抛 logoHidden', async () => {
    const wrapper = mountPanel()
    const sw = wrapper.find('button[role="switch"]')
    expect(sw.attributes('aria-checked')).toBe('true') // 默认显示态

    await sw.trigger('click')
    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.logoHidden).toBe(true)
    wrapper.unmount()
  })

  it('已设置自定义 Logo 时出现「恢复默认」;点击清空自定义并按默认图有无决定显隐', async () => {
    const wrapper = mountPanel({ ...baseState, logoDataUrl: 'data:image/png;base64,abc' })
    expect(wrapper.findAll('button').some((b) => b.text() === '恢复默认')).toBe(true)

    // 有内置默认:恢复后保持显示态
    await wrapper.setProps({ defaultLogoUrl: 'data:image/png;base64,default' })
    await wrapper.findAll('button').find((b) => b.text() === '恢复默认')!.trigger('click')
    let last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.logoDataUrl).toBeNull()
    expect(last.logoHidden).toBe(false)
    wrapper.unmount()

    // 无内置默认:恢复后回退隐藏态
    const wrapper2 = mountPanel({ ...baseState, logoDataUrl: 'data:image/png;base64,abc' })
    await wrapper2.findAll('button').find((b) => b.text() === '恢复默认')!.trigger('click')
    last = wrapper2.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.logoHidden).toBe(true)
    wrapper2.unmount()
  })

  it('缩略图展示当前生效 Logo(自定义优先,回退内置默认)', () => {
    const wrapper = mountPanel({ ...baseState, logoDataUrl: 'data:image/png;base64,abc' })
    const thumb = wrapper.find('.logo-thumb')
    expect(thumb.attributes('style')).toContain('data:image/png;base64,abc')

    const wrapper2 = mountPanel()
    // 无自定义 Logo 时占位符出现,不展示任何外链
    expect(wrapper2.find('.logo-thumb .logo-mark').exists()).toBe(true)
    wrapper.unmount()
    wrapper2.unmount()
  })
})

describe('ControlPanel 字体加载状态外显(C3)', () => {
  it('loading 时头部显示「字体加载中…」;error 时显示「字体不可用」;ready 无状态文案', () => {
    const loading = mountPanel(baseState, { fontStatus: 'loading' })
    expect(loading.text()).toContain('字体加载中…')
    loading.unmount()

    const error = mountPanel(baseState, { fontStatus: 'error' })
    expect(error.text()).toContain('字体不可用')
    error.unmount()

    const ready = mountPanel(baseState, { fontStatus: 'ready' })
    expect(ready.text()).not.toContain('字体加载中')
    expect(ready.text()).not.toContain('字体不可用')
    ready.unmount()
  })
})
