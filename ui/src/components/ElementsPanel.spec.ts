import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementsPanel from './ElementsPanel.vue'
import { makeCoverState } from '../lib/coverState'
import { defaultAnchors, defaultTextStyles } from '../lib/layout'
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
    // 2.0 起分为「外观」（透明度/旋转，所有元素通用）与「文字」（排版）两组
    expect(wrapper.text()).toContain('外观')
    expect(wrapper.text()).toContain('文字')
    for (const label of ['透明度', '旋转', '字间距', '弯曲度', '横排', '竖排', '颜色', '加粗']) {
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
        anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, color: '#ffffff',
        bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
      }],
    })
    expect(wrapper.text()).not.toContain('弯曲度')
    wrapper.unmount()
  })

  it('自定义文字元素拥有与内置文字完全相同的排版控件', () => {
    const wrapper = mountPanel('custom:x1', {
      customElements: [{
        id: 'x1', kind: 'text', content: '', text: 'hi', size: 48,
        anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, color: '#ffffff',
        bold: true, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
      }],
    })
    // 需求 6：自定义文字要拥有标题那套全部能力，面板里就是同一组控件
    for (const label of ['透明度', '旋转', '字间距', '弯曲度', '横排', '竖排', '颜色', '加粗']) {
      expect(wrapper.text()).toContain(label)
    }
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
    text: '', size: 120, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
    color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
  }
  const IMAGE_ELEMENT = {
    id: 'i1', kind: 'image' as const, content: 'data:image/png;base64,AA',
    text: '', size: 120, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
    color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
  }

  it('SVG 元素只有「边长(px)」一条大小滑杆,不再与「大小(%)」并存', () => {
    const wrapper = mountPanel('custom:s1', { customElements: [SVG_ELEMENT] })
    const labels = wrapper.findAll('.sf-label').map((n) => n.text())
    expect(labels).toContain('边长')
    expect(labels.filter((l) => l === '大小')).toHaveLength(0)
    wrapper.unmount()
  })

  it('图片元素同上（图片这条是宽度，高度按原图比例算）', () => {
    const wrapper = mountPanel('custom:i1', { customElements: [IMAGE_ELEMENT] })
    const labels = wrapper.findAll('.sf-label').map((n) => n.text())
    expect(labels).toContain('宽度')
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
        anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, color: '#ffffff', bold: true, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
      }],
    })
    expect(wrapper.text()).toContain('加粗')
    wrapper.unmount()
  })
})

describe('ElementsPanel 添加元素区（只留 Halo 官方三合一入口）', () => {
  /** 类型分段控件：切到某一类录入方式 */
  async function pickKind(wrapper: ReturnType<typeof mountPanel>, label: string) {
    const seg = wrapper.find('[aria-label="选择要添加的元素类型"]')
    await seg.findAll('button').find((b) => b.text() === label)!.trigger('click')
  }

  it('文字：仍是「添加文字元素」按钮，且不渲染任何 FormKit 输入', () => {
    const wrapper = mountPanel(null)
    expect(wrapper.findAll('button').some((b) => b.text() === '添加文字元素')).toBe(true)
    expect(wrapper.find('[data-formkit]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('图片：只剩三合一附件输入(accepts 限定 image/*)，自建导入入口已删', async () => {
    const wrapper = mountPanel(null)
    await pickKind(wrapper, '图片')

    const fk = wrapper.findComponent({ name: 'FormKit' })
    expect(fk.props('type')).toBe('attachment')
    expect(fk.props('accepts')).toEqual(['image/*'])
    // 已删:上传按钮、隐藏 file input、图片直链输入框与「导入」按钮
    expect(wrapper.text()).not.toContain('上传图片')
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    expect(wrapper.find('input[aria-label="图片直链"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === '导入')).toBe(false)
    wrapper.unmount()
  })

  it('SVG：只剩 iconify 选择器 + 「选择 .svg 文件」按钮，手写/粘贴/直链入口已删', async () => {
    const wrapper = mountPanel(null)
    await pickKind(wrapper, 'SVG 图标')

    const fk = wrapper.findComponent({ name: 'FormKit' })
    expect(fk.props('type')).toBe('iconify')
    expect(fk.props('format')).toBe('name')
    // 本地 .svg 文件入口仍在（标签内嵌 file input，是这一类唯一的文件来源）
    const fileLabel = wrapper.findAll('label').find((l) => l.text().includes('选择 .svg 文件'))!
    expect(fileLabel.find('input[type="file"]').attributes('accept')).toBe('.svg,image/svg+xml')
    // 已删:折叠手写入口、源码 textarea、「添加粘贴的 SVG」、SVG 直链导入行
    expect(wrapper.text()).not.toContain('手写')
    expect(wrapper.find('textarea[aria-label="SVG 源码"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('添加粘贴的 SVG')
    expect(wrapper.find('input[aria-label="SVG 直链"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === '导入')).toBe(false)
    wrapper.unmount()
  })
})

describe('ElementsPanel 重置：位置 vs 全部数值', () => {
  const TEXT_ELEMENT = {
    id: 't1', kind: 'text' as const, content: '', text: '保留的文案', size: 120,
    anchor: { x: 0.1, y: 0.1, scale: 0.5, opacity: 1, rotation: 90 }, color: '#39c5bb', bold: true, tracking: 0.4, curve: 0, direction: 'horizontal' as const, aspect: 1,
  }
  const IMAGE_ELEMENT = {
    id: 'i1', kind: 'image' as const, content: 'data:image/png;base64,AA', text: '', size: 300,
    anchor: { x: 0.9, y: 0.9, scale: 2, opacity: 1, rotation: 0 }, color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
  }
  /** 面板头部那两个并列按钮 */
  function headButton(wrapper: ReturnType<typeof mountPanel>, label: string) {
    return wrapper.findAll('.head button').find((b) => b.text() === label)!
  }

  it('头部并列两个重置按钮', () => {
    const wrapper = mountPanel('title')
    expect(wrapper.findAll('.head button').map((b) => b.text()))
      .toEqual(['重置位置', '重置全部数值'])
    wrapper.unmount()
  })

  it('「重置全部数值」归位分辨率/锚点/字号/中缝/排版样式/压暗/元素尺寸与旋转', async () => {
    const wrapper = mountPanel('custom:t1', {
      canvas: { width: 2400, height: 1260 },
      layout: { ...defaultAnchors(), logo: { x: 0.2, y: 0.2, scale: 3, opacity: 1, rotation: 0 } },
      titleFontSize: 210,
      seamGap: 200,
      textStyles: { ...defaultTextStyles(), title: { tracking: 1, curve: 80, direction: 'vertical', color: '#ff0000', bold: true } },
      backgroundScrim: 60,
      customElements: [TEXT_ELEMENT, IMAGE_ELEMENT],
    })
    await headButton(wrapper, '重置全部数值').trigger('click')

    const patch = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(patch.canvas).toEqual({ width: 1200, height: 630 })
    expect(patch.layout).toEqual(defaultAnchors())
    expect(patch.titleFontSize).toBe(105)   // defaultCoverState() 的出厂值(面板 50%)
    expect(patch.seamGap).toBe(80)          // CANVAS.SEAM_GAP
    expect(patch.textStyles).toEqual(defaultTextStyles())
    expect(patch.backgroundScrim).toBe(20)  // CANVAS.BACKGROUND_SCRIM
    // 自定义元素逐个归位：锚点居中、尺寸按类型(文字 48 / 图形 160)、旋转归零，
    // 内容与颜色等非数值字段原样保留
    expect(patch.customElements).toEqual([
      { ...TEXT_ELEMENT, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, size: 48 },
      { ...IMAGE_ELEMENT, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, size: 160 },
    ])
    wrapper.unmount()
  })

  it('「重置全部数值」刻意不碰文本、渐变、背景图、Logo 与层级（只重置数值）', async () => {
    const overrides: Partial<CoverState> = {
      titleFlow: '保留的标题',
      subtitle: '保留的副标题',
      watermark: 'kept.com',
      gradient: { angle: 45, stops: [{ offset: 0, color: '#ffffff' }, { offset: 100, color: '#000000' }] },
      presetId: null,
      backgroundMode: 'image',
      backgroundImage: 'data:image/png;base64,AA',
      logoDataUrl: 'data:image/png;base64,BB',
      layers: ['watermark', 'title', 'subtitle', 'logo'],
    }
    const wrapper = mountPanel(null, overrides)
    await headButton(wrapper, '重置全部数值').trigger('click')

    const patch = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    for (const key of ['titleFlow', 'subtitle', 'watermark', 'gradient', 'presetId',
      'backgroundMode', 'backgroundImage', 'logoDataUrl', 'layers'] as const) {
      expect(patch[key]).toEqual(overrides[key])
    }
    wrapper.unmount()
  })

  it('「重置位置」只归位锚点：字号/分辨率/排版样式/压暗/中缝与元素尺寸旋转都不动', async () => {
    const wrapper = mountPanel('custom:t1', {
      canvas: { width: 2400, height: 1260 },
      titleFontSize: 210,
      seamGap: 200,
      textStyles: { ...defaultTextStyles(), title: { tracking: 1, curve: 80, direction: 'vertical', color: '#ff0000', bold: true } },
      backgroundScrim: 60,
      customElements: [TEXT_ELEMENT],
    })
    await headButton(wrapper, '重置位置').trigger('click')

    const patch = wrapper.emitted('update:modelValue')!.at(-1)![0] as CoverState
    expect(patch.layout).toEqual(defaultAnchors())
    expect(patch.customElements[0].anchor).toEqual({ x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 90 })
    // 与「重置全部数值」的差异：这些数值项原样不动
    expect(patch.titleFontSize).toBe(210)
    expect(patch.canvas).toEqual({ width: 2400, height: 1260 })
    expect(patch.seamGap).toBe(200)
    expect(patch.backgroundScrim).toBe(60)
    expect(patch.textStyles.title.tracking).toBe(1)
    // 元素只归位，不重置大小与旋转（那是另一个按钮的职责）
    expect(patch.customElements[0].size).toBe(120)
    expect(patch.customElements[0].anchor.rotation).toBe(90)
    wrapper.unmount()
  })
})