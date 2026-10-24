import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GradientPicker from './GradientPicker.vue'
import { PRESETS } from '../lib/presets'
import type { CoverState } from '../lib/types'
import { makeCoverState } from '../lib/coverState'

/** 以指定预设为当前选中态的受控模型(presetId 传 null 即自定义渐变) */
function stateOf(presetId: string | null): CoverState {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  return makeCoverState({
    titleLeft: '',
    titleRight: '',
    titleFontSize: 210,
    subtitle: '',
    gradient: { angle: preset.angle, stops: preset.stops.map((s) => ({ ...s })) },
    presetId,
    logoDataUrl: null,
    logoHidden: false,
    watermark: '',
  })
}

describe('GradientPicker 渐变随机换色', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('点击「随机」应用一个预设:∈ PRESETS 且 ≠ 当前 presetId(确定性 mock Math.random)', async () => {
    for (const r of [0, 0.2, 0.5, 0.8, 0.9999]) {
      vi.spyOn(Math, 'random').mockReturnValue(r)
      const wrapper = mount(GradientPicker, { props: { modelValue: stateOf('sunset') } })
      const randomBtn = wrapper.findAll('button').find((b) => b.text() === '随机')
      expect(randomBtn, `Math.random=${r} 时应存在「随机」按钮`).toBeDefined()
      await randomBtn!.trigger('click')

      const events = wrapper.emitted('update:modelValue')
      expect(events, '随机必须产生一次状态更新').toHaveLength(1)
      const next = events![0][0] as CoverState
      expect(PRESETS.some((p) => p.id === next.presetId)).toBe(true)
      expect(next.presetId, '随机结果不得与当前预设重复').not.toBe('sunset')
      wrapper.unmount()
    }
  })

  it('随机命中与对应预设的渐变完全一致(经预设点击同款代码路径)', async () => {
    // Math.random=0 ⇒ 排除当前 sunset 后取候选第一个:dusk
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf('sunset') } })
    await wrapper.findAll('button').find((b) => b.text() === '随机')!.trigger('click')

    const dusk = PRESETS.find((p) => p.id === 'dusk')!
    const next = wrapper.emitted('update:modelValue')![0][0] as CoverState
    expect(next.presetId).toBe('dusk')
    expect(next.gradient).toEqual({ angle: dusk.angle, stops: dusk.stops })
    wrapper.unmount()
  })

  it('当前为自定义渐变(presetId=null)时随机仍命中合法预设', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf(null) } })
    await wrapper.findAll('button').find((b) => b.text() === '随机')!.trigger('click')

    const next = wrapper.emitted('update:modelValue')![0][0] as CoverState
    expect(PRESETS.some((p) => p.id === next.presetId)).toBe(true)
    expect(next.presetId).not.toBeNull()
    wrapper.unmount()
  })
})

describe('GradientPicker 自定义/CSS 粘贴与预设选中态(评审#2/#3/#4)', () => {
  beforeEach(() => localStorage.clear())

  it('「止」取色器在空 stops 时对称构造合法 stops,不再静默失效(评审#2 防御层)', async () => {
    const empty = stateOf(null)
    empty.gradient = { angle: 90, stops: [] }
    const wrapper = mount(GradientPicker, { props: { modelValue: empty } })
    const colorInputs = wrapper.findAll('input[type="color"]')
    await colorInputs[1].setValue('#123456') // 「止」

    const next = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(next.gradient.stops).toEqual([
      { offset: 0, color: '#123456' },
      { offset: 100, color: '#123456' },
    ])
    wrapper.unmount()
  })

  it('起/止取色器正常路径分别替换 stops 首尾', async () => {
    const base = stateOf(null)
    const wrapper = mount(GradientPicker, { props: { modelValue: base } })
    const colorInputs = wrapper.findAll('input[type="color"]')
    await colorInputs[0].setValue('#aaaaaa') // 起
    await colorInputs[1].setValue('#bbbbbb') // 止

    const events = wrapper.emitted('update:modelValue')!
    const afterStart = events[0][0] as CoverState
    expect(afterStart.gradient.stops[0]).toEqual({ offset: 0, color: '#aaaaaa' })
    expect(afterStart.gradient.stops[1].color).toBe(base.gradient.stops[1].color)
    const afterEnd = events.at(-1)![0] as CoverState
    expect(afterEnd.gradient.stops[1]).toEqual({ offset: 100, color: '#bbbbbb' })
    expect(afterEnd.presetId).toBeNull() // 自定义编辑清除选中态
    wrapper.unmount()
  })

  it('角度输入越界值收敛到 0-360(999 → 279,周期等价)', async () => {
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf(null) } })
    await wrapper.find('input[type="number"]').setValue('999')

    const next = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(next.gradient.angle).toBe(279)
    wrapper.unmount()
  })

  it('CSS 粘贴:合法输入 emit 解析后的渐变并清选中态;非法输入显示错误行', async () => {
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf('sunset') } })
    const input = wrapper.find('input[aria-label="粘贴 CSS 渐变"]')

    await input.setValue('linear-gradient(45deg, #112233 0%, #445566 100%)')
    await wrapper.findAll('button').find((b) => b.text() === '应用')!.trigger('click')
    const next = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(next.gradient).toEqual({
      angle: 45,
      stops: [{ offset: 0, color: '#112233' }, { offset: 100, color: '#445566' }],
    })
    expect(next.presetId).toBeNull()

    await input.setValue('linear-gradient(oops)')
    await wrapper.findAll('button').find((b) => b.text() === '应用')!.trigger('click')
    expect(wrapper.find('.error').exists()).toBe(true)
    wrapper.unmount()
  })

  it('CSS 输入为空时按 Enter 不报错(与「应用」按钮禁用语义一致,评审M11)', async () => {
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf(null) } })
    await wrapper.find('input[aria-label="粘贴 CSS 渐变"]').trigger('keydown.enter')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('.error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('swatch 选中态经 aria-pressed 暴露,点击后翻转(评审#3)', async () => {
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf('sunset') } })
    const swatches = wrapper.findAll('.swatch')
    expect(swatches[0].attributes('aria-pressed')).toBe('true') // sunset 选中
    expect(swatches[1].attributes('aria-pressed')).toBe('false')

    await swatches[1].trigger('click')
    const reSwatches = wrapper.findAll('.swatch')
    expect(reSwatches[0].attributes('aria-pressed')).toBe('false')
    expect(reSwatches[1].attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('点击预设写入最近使用(独立 localStorage 键,评审#4 覆盖)', async () => {
    const wrapper = mount(GradientPicker, { props: { modelValue: stateOf(null) } })
    await wrapper.findAll('.swatch')[1].trigger('click') // dusk

    const recent = JSON.parse(
      localStorage.getItem('halo-plugin-cover-generator/recent-presets/v1')!,
    )
    expect(recent).toContain('dusk')
    wrapper.unmount()
  })
})
