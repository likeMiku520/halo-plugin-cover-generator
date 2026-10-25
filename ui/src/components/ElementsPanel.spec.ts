import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementsPanel from './ElementsPanel.vue'
import { makeCoverState } from '../lib/coverState'
import type { SelectionId } from '../composables/useCanvasInteraction'
import type { CoverState } from '../lib/types'

function mountPanel(selected: SelectionId | null, overrides: Partial<CoverState> = {}) {
  return mount(ElementsPanel, {
    props: { modelValue: makeCoverState(overrides), selected },
  })
}

describe('ElementsPanel 滑杆命名', () => {
  it('位置与大小滑杆都带可见名称(一排无名拖动条无法分辨)', () => {
    const wrapper = mountPanel('subtitle')
    const labels = wrapper.findAll('.sf-label').map((n) => n.text())
    expect(labels).toContain('水平')
    expect(labels).toContain('垂直')
    expect(labels).toContain('大小')
    wrapper.unmount()
  })
})

describe('ElementsPanel 文字排版控件', () => {
  it('选中标题时出现字间距 / 弯曲度 / 旋转 / 方向', () => {
    const wrapper = mountPanel('title')
    expect(wrapper.text()).toContain('文字排版')
    for (const label of ['字间距', '弯曲度', '旋转', '横排', '竖排']) {
      expect(wrapper.text()).toContain(label)
    }
    wrapper.unmount()
  })

  it('副标题与水印同样可调', () => {
    const ids: SelectionId[] = ['subtitle', 'watermark']
    for (const id of ids) {
      const wrapper = mountPanel(id)
      expect(wrapper.text()).toContain('弯曲度')
      wrapper.unmount()
    }
  })

  it('选中 Logo 时不出现文字排版分组(它没有一行字可排)', () => {
    const wrapper = mountPanel('logo')
    expect(wrapper.text()).not.toContain('弯曲度')
    wrapper.unmount()
  })

  it('选中自定义图片元素时同样不出现', () => {
    const wrapper = mountPanel('custom:img1', {
      customElements: [{
        id: 'img1', kind: 'image', content: 'data:image/png;base64,AA', text: '', size: 120,
        anchor: { x: 0.5, y: 0.5, scale: 1 }, color: '#ffffff',
        bold: false, tracking: 0,
      }],
    })
    expect(wrapper.text()).not.toContain('弯曲度')
    wrapper.unmount()
  })

  it('自定义文字元素不套用内置文字那套样式', () => {
    const wrapper = mountPanel('custom:x1', {
      customElements: [{
        id: 'x1', kind: 'text', content: '', text: 'hi', size: 48,
        anchor: { x: 0.5, y: 0.5, scale: 1 }, color: '#ffffff',
        bold: true, tracking: 0,
      }],
    })
    expect(wrapper.text()).not.toContain('弯曲度')
    wrapper.unmount()
  })

  it('点击竖排只改该元素的 direction，不波及其它元素', async () => {
    const wrapper = mountPanel('watermark')
    const seg = wrapper.find('[aria-label="文字排列方向"]')
    await seg.findAll('button').find((b) => b.text() === '竖排')!.trigger('click')

    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.textStyles.watermark.direction).toBe('vertical')
    expect(last.textStyles.title.direction).toBe('horizontal')
    expect(last.textStyles.subtitle.direction).toBe('horizontal')
    wrapper.unmount()
  })

  it('字间距滑杆上抛的是该元素自己的 tracking', async () => {
    const wrapper = mountPanel('title')
    const slider = wrapper.findAll('.slider-field')
      .find((f) => f.find('.sf-label').text() === '字间距')!
    await slider.find('input[type="number"]').setValue('0.4')
    await slider.find('input[type="number"]').trigger('change')

    const last = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(last.textStyles.title.tracking).toBeCloseTo(0.4, 5)
    wrapper.unmount()
  })
})

describe('ElementsPanel 大小滑杆去重与圆形裁剪移除', () => {
  const SVG_ELEMENT = {
    id: 's1', kind: 'svg' as const,
    content: '<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>',
    text: '', size: 120, anchor: { x: 0.5, y: 0.5, scale: 1 },
    color: '#ffffff', bold: false, tracking: 0,
  }
  const IMAGE_ELEMENT = {
    id: 'i1', kind: 'image' as const, content: 'data:image/png;base64,AA',
    text: '', size: 120, anchor: { x: 0.5, y: 0.5, scale: 1 },
    color: '#ffffff', bold: false, tracking: 0,
  }

  it('SVG 元素只有「边长(px)」一条大小滑杆,不再与「大小(%)」并存', () => {
    const wrapper = mountPanel('custom:s1', { customElements: [SVG_ELEMENT] })
    const labels = wrapper.findAll('.sf-label').map((n) => n.text())
    expect(labels).toContain('边长')
    expect(labels.filter((l) => l === '大小')).toHaveLength(0)
    wrapper.unmount()
  })

  it('图片元素同上', () => {
    const wrapper = mountPanel('custom:i1', { customElements: [IMAGE_ELEMENT] })
    const labels = wrapper.findAll('.sf-label').map((n) => n.text())
    expect(labels).toContain('边长')
    expect(labels.filter((l) => l === '大小')).toHaveLength(0)
    wrapper.unmount()
  })

  it('内置元素仍保留「大小(%)」', () => {
    const wrapper = mountPanel('logo')
    expect(wrapper.findAll('.sf-label').map((n) => n.text())).toContain('大小')
    wrapper.unmount()
  })

  it('圆形裁剪开关已移除,图片与 SVG 都不再出现', () => {
    for (const [id, el] of [['custom:i1', IMAGE_ELEMENT], ['custom:s1', SVG_ELEMENT]] as const) {
      const wrapper = mountPanel(id, { customElements: [el] })
      expect(wrapper.text()).not.toContain('圆形裁剪')
      wrapper.unmount()
    }
  })

  it('自定义文字元素保留加粗开关', () => {
    const wrapper = mountPanel('custom:t1', {
      customElements: [{
        id: 't1', kind: 'text', content: '', text: 'hi', size: 48,
        anchor: { x: 0.5, y: 0.5, scale: 1 }, color: '#ffffff', bold: true, tracking: 0,
      }],
    })
    expect(wrapper.text()).toContain('加粗')
    wrapper.unmount()
  })
})