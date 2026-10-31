import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ControlPanel from './ControlPanel.vue'
import type { CoverState } from '../lib/types'
import { makeCoverState } from '../lib/coverState'
import { defaultCoverState } from '../lib/layout'
import { adoptCoverState } from '../composables/useCoverState'
import { SCHEMES_STORAGE_KEY } from '../lib/schemes'

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

describe('ControlPanel Logo 取图走附件选择器(评审 M3 代理披露)', () => {
  it('主源 CORS 失败走代理兜底时,界面明示链接已发送给第三方', async () => {
    const realPng = new Blob(['abc'], { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://x.com/')) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, blob: async () => realPng }
    }))
    const wrapper = mountPanel()
    // 图片来源只剩 Halo 自带三合一,回填的是附件 URL
    wrapper.findComponent({ name: 'FormKit' }).vm.$emit('input', 'https://x.com/a.png')
    await until(() => (wrapper.emitted('update:modelValue')?.length ?? 0) > 0)

    expect(wrapper.find('.proxy-notice').exists()).toBe(true)
    expect(wrapper.find('.proxy-notice').text()).toContain('wsrv.nl')
    expect(wrapper.find('.proxy-notice').text()).toContain('第三方')
    // 取图本身仍然成功:logoDataUrl 已上抛
    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.logoDataUrl).toMatch(/^data:image\/png;base64,/)
    wrapper.unmount()
  })

  it('直连成功(未走代理)不显示披露', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, blob: async () => new Blob(['abc'], { type: 'image/png' }),
    })))
    const wrapper = mountPanel()
    wrapper.findComponent({ name: 'FormKit' }).vm.$emit('input', 'https://x.com/a.png')
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

describe('ControlPanel 标题字号单一入口(内容区滑块已移除)', () => {
  it('内容分区不再渲染「标题字号」滑杆,同一张卡片的其它控件不受影响', () => {
    const wrapper = mountPanel({ ...baseState, titleMode: 'split' })
    expect(wrapper.text()).not.toContain('标题字号')
    expect(wrapper.text()).toContain('中缝间距')
    expect(wrapper.text()).toContain('副标题')
    wrapper.unmount()
  })

  it('整块排版下同样没有标题字号入口', () => {
    const wrapper = mountPanel({ ...baseState, titleMode: 'flow' })
    expect(wrapper.text()).not.toContain('标题字号')
    // 整块排版的输入框仍在(placeholder 是属性,不在 text() 里)
    expect(wrapper.find('input[aria-label="整块标题"]').attributes('placeholder')).toContain('整块标题')
    wrapper.unmount()
  })
})

describe('ControlPanel 背景模式', () => {
  it('默认渐变:渲染渐变选择器,背景图入口不出现(只剩 Logo 那一个附件输入)', () => {
    const wrapper = mountPanel()
    expect(wrapper.findComponent({ name: 'GradientPicker' }).exists()).toBe(true)
    expect(wrapper.findAll('[data-formkit="attachment"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('图片模式:渐变选择器让位,出现背景图入口与压暗滑杆', () => {
    const wrapper = mountPanel({
      ...baseState,
      backgroundMode: 'image',
      backgroundImage: 'data:image/png;base64,AAA',
    })
    expect(wrapper.findComponent({ name: 'GradientPicker' }).exists()).toBe(false)
    expect(wrapper.findAll('[data-formkit="attachment"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('压暗')
    wrapper.unmount()
  })

  it('点击「图片」上抛 backgroundMode 变更', async () => {
    const wrapper = mountPanel()
    const seg = wrapper.find('[aria-label="背景模式"]')
    await seg.findAll('button').find((b) => b.text() === '图片')!.trigger('click')

    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.backgroundMode).toBe('image')
    wrapper.unmount()
  })

  it('切回渐变只改模式,已选背景图保留在状态里(再次切回不必重选)', async () => {
    const wrapper = mountPanel({
      ...baseState,
      backgroundMode: 'image',
      backgroundImage: 'data:image/png;base64,AAA',
    })
    const seg = wrapper.find('[aria-label="背景模式"]')
    await seg.findAll('button').find((b) => b.text() === '渐变')!.trigger('click')

    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.backgroundMode).toBe('gradient')
    expect(last.backgroundImage).toBe('data:image/png;base64,AAA')
    wrapper.unmount()
  })
})

/** 方案条目:默认一份可用的「周报」,按用例覆盖字段 */
function schemeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scheme-1',
    name: '周报',
    savedAt: new Date(2026, 9, 31, 12, 30).toISOString(),
    state: makeCoverState(),
    ...overrides,
  }
}

function seedSchemes(items: unknown[]) {
  localStorage.setItem(SCHEMES_STORAGE_KEY, JSON.stringify(items))
}

describe('ControlPanel 方案保存与载入', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('方案分区位于最顶部:第一个眉标是「方案」,其后才是「画布」', () => {
    const wrapper = mountPanel()
    const headings = wrapper.findAll('.eyebrow').map((node) => node.text())
    expect(headings[0]).toBe('方案')
    expect(headings[1]).toBe('画布')
    expect(wrapper.find('input[aria-label="方案名"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('保存:列表新增一条并清空输入,名字 trim 后展示,成功提示可见', async () => {
    const wrapper = mountPanel({ ...baseState, titleFlow: '周报封面' })
    expect(wrapper.text()).toContain('还没有保存的方案')

    await wrapper.find('input[aria-label="方案名"]').setValue('  周报封面  ')
    await wrapper.find('button[aria-label="保存当前方案"]').trigger('click')

    expect(wrapper.findAll('.scheme-item')).toHaveLength(1)
    expect(wrapper.find('.scheme-name').text()).toBe('周报封面')
    expect(wrapper.find('.scheme-time').text()).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/)
    expect((wrapper.find('input[aria-label="方案名"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.scheme-notice').text()).toContain('已保存')
    expect(wrapper.find('.scheme-notice').classes()).not.toContain('is-error')

    const stored = JSON.parse(localStorage.getItem(SCHEMES_STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('周报封面')
    expect(stored[0].state.titleFlow).toBe('周报封面')
    wrapper.unmount()
  })

  it('空名拒绝保存:不写存储、列表仍为空、提示可见', async () => {
    const wrapper = mountPanel()
    await wrapper.find('input[aria-label="方案名"]').setValue('   ')
    await wrapper.find('button[aria-label="保存当前方案"]').trigger('click')

    expect(wrapper.findAll('.scheme-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('还没有保存的方案')
    expect(wrapper.find('.scheme-notice').text()).toContain('请输入方案名')
    expect(wrapper.find('.scheme-notice').classes()).toContain('is-error')
    expect(localStorage.getItem(SCHEMES_STORAGE_KEY)).toBeNull()
    wrapper.unmount()
  })

  it('同名覆盖:列表仍一条、savedAt 更新、状态替换并提示覆盖', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T08:00:00.000Z'))
    const wrapper = mountPanel({ ...baseState, titleFlow: '旧标题' })
    const input = wrapper.find('input[aria-label="方案名"]')
    await input.setValue('封面')
    await wrapper.find('button[aria-label="保存当前方案"]').trigger('click')
    const firstSavedAt = JSON.parse(localStorage.getItem(SCHEMES_STORAGE_KEY)!)[0].savedAt as string

    vi.setSystemTime(new Date('2026-10-31T09:00:00.000Z'))
    await wrapper.setProps({ modelValue: { ...baseState, titleFlow: '新标题' } })
    await input.setValue('  封面  ')
    await wrapper.find('button[aria-label="保存当前方案"]').trigger('click')

    const stored = JSON.parse(localStorage.getItem(SCHEMES_STORAGE_KEY)!)
    expect(stored).toHaveLength(1)
    expect(stored[0].savedAt).not.toBe(firstSavedAt)
    expect(stored[0].state.titleFlow).toBe('新标题')
    expect(wrapper.findAll('.scheme-item')).toHaveLength(1)
    expect(wrapper.find('.scheme-notice').text()).toContain('更新')
    wrapper.unmount()
  })

  it('载入:emit 整份且已收敛的状态(故意越界的存档被修好)', async () => {
    const raw = makeCoverState({
      titleFlow: '载入我',
      titleFontSize: 9999,
      gradient: {
        angle: 725,
        stops: [
          { offset: -20, color: '#ffffff' },
          { offset: 300, color: '#000000' },
        ],
      },
    })
    seedSchemes([schemeEntry({ state: raw })])
    const wrapper = mountPanel()
    expect(wrapper.findAll('.scheme-item')).toHaveLength(1)

    await wrapper.find('button[aria-label="载入方案 周报"]').trigger('click')

    const payload = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as CoverState
    // 与「存档载入」共用 adoptCoverState 的结果,不是原样塞回受控状态
    expect(payload).toEqual(adoptCoverState(raw).state)
    expect(payload.titleFontSize).toBe(210)
    expect(payload.gradient.angle).toBe(5)
    expect(payload.gradient.stops.map((stop) => stop.offset)).toEqual([0, 100])
    // 完整替换:新结构字段一个不少(而不是只回填被改动的字段)
    expect(Object.keys(payload).sort()).toEqual(Object.keys(defaultCoverState()).sort())
    expect(wrapper.find('.scheme-notice').text()).toContain('已载入')
    expect(wrapper.find('.scheme-notice').text()).toContain('修正')
    wrapper.unmount()
  })

  it('删除:条目消失、存储同步、提示可见', async () => {
    seedSchemes([schemeEntry(), schemeEntry({ id: 'scheme-2', name: '活动' })])
    const wrapper = mountPanel()
    expect(wrapper.findAll('.scheme-item')).toHaveLength(2)

    await wrapper.find('button[aria-label="删除方案 周报"]').trigger('click')

    expect(wrapper.findAll('.scheme-item')).toHaveLength(1)
    expect(wrapper.find('.scheme-item').text()).not.toContain('周报')
    expect(wrapper.find('.scheme-notice').text()).toContain('已删除')
    expect(JSON.parse(localStorage.getItem(SCHEMES_STORAGE_KEY)!)).toHaveLength(1)
    wrapper.unmount()
  })

  it('存储损坏(非 JSON / 非数组 / 元素缺字段)不崩,界面照常可用', async () => {
    localStorage.setItem(SCHEMES_STORAGE_KEY, '{oops')
    const brokenJson = mountPanel()
    expect(brokenJson.text()).toContain('方案')
    expect(brokenJson.text()).toContain('还没有保存的方案')
    brokenJson.unmount()

    localStorage.setItem(SCHEMES_STORAGE_KEY, JSON.stringify({ not: 'an array' }))
    const notArray = mountPanel()
    expect(notArray.text()).toContain('还没有保存的方案')
    notArray.unmount()

    seedSchemes([
      schemeEntry(),
      { id: 'missing-fields' },
      { id: 'bad-state', name: '坏状态', savedAt: new Date().toISOString(), state: 42 },
    ])
    const partial = mountPanel()
    expect(partial.findAll('.scheme-item')).toHaveLength(1)
    expect(partial.find('.scheme-name').text()).toBe('周报')

    // 坏数据被忽略后仍能保存新方案
    await partial.find('input[aria-label="方案名"]').setValue('新方案')
    await partial.find('button[aria-label="保存当前方案"]').trigger('click')
    expect(partial.findAll('.scheme-item')).toHaveLength(2)
    partial.unmount()
  })

  it('存储写入失败:给出失败提示且列表不新增', async () => {
    const wrapper = mountPanel()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await wrapper.find('input[aria-label="方案名"]').setValue('写不进')
    await wrapper.find('button[aria-label="保存当前方案"]').trigger('click')

    expect(wrapper.findAll('.scheme-item')).toHaveLength(0)
    expect(wrapper.find('.scheme-notice').text()).toContain('失败')
    expect(wrapper.find('.scheme-notice').classes()).toContain('is-error')
    setItem.mockRestore()
    wrapper.unmount()
  })
})
