import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SliderField from './SliderField.vue'

function mountField(props: Record<string, unknown> = {}) {
  return mount(SliderField, {
    props: { modelValue: 50, min: 0, max: 100, step: 5, label: '水平', ...props },
  })
}

async function typeNumber(wrapper: ReturnType<typeof mount>, value: string) {
  const input = wrapper.find('input[type="number"]')
  await input.setValue(value)
  await input.trigger('change')
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0]
}

describe('SliderField 命名与吸附', () => {
  it('标签可见:一排滑杆必须能分辨各自控制什么', () => {
    const wrapper = mountField({ label: '弯曲度' })
    expect(wrapper.find('.sf-label').text()).toBe('弯曲度')
    wrapper.unmount()
  })

  it('数值框手动输入后吸附到最近刻度,不留下 47.3 这种值', async () => {
    const wrapper = mountField({ step: 5 })
    expect(await typeNumber(wrapper, '47.3')).toBe(45)
    expect(await typeNumber(wrapper, '48')).toBe(50)
    wrapper.unmount()
  })

  it('小数步长同样吸附(字距一类的 em 值)', async () => {
    const wrapper = mountField({ min: -0.2, max: 1.5, step: 0.05, modelValue: 0 })
    expect(await typeNumber(wrapper, '0.37')).toBeCloseTo(0.35, 6)
    wrapper.unmount()
  })

  it('吸附后仍收敛在上下限内', async () => {
    const wrapper = mountField({ step: 5, modelValue: 100 })
    expect(await typeNumber(wrapper, '999')).toBe(100)
    expect(await typeNumber(wrapper, '-40')).toBe(0)
    wrapper.unmount()
  })

  it('滑杆按 step 吸附(浏览器原生行为,断言属性透传)', () => {
    const wrapper = mountField({ step: 5 })
    const range = wrapper.find('input[type="range"]')
    expect(range.attributes('step')).toBe('5')
    expect(range.attributes('min')).toBe('0')
    expect(range.attributes('max')).toBe('100')
    wrapper.unmount()
  })
})