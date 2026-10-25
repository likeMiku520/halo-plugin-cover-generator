import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, defineComponent, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { CoverState } from '../lib/types'
import { MAX_CUSTOM_ELEMENTS, persistError, useCoverState } from './useCoverState'
import { defaultAnchors } from '../lib/layout'

const KEY = 'halo-plugin-cover-generator/state/v1'

/** 改造前的存档形状：无 titleMode / layout / customElements */
function legacyArchive(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    titleLeft: '工具', titleRight: '推荐', titleFontSize: 210,
    subtitle: '', gradient: { angle: 120, stops: [{ offset: 0, color: '#f6d365' }, { offset: 100, color: '#fda085' }] },
    presetId: null, logoDataUrl: null, logoHidden: false, watermark: 'kept.com',
    ...extra,
  })
}

describe('useCoverState', () => {
  beforeEach(() => localStorage.clear())

  it('默认值为空标题 + 日落橙 + 默认 Logo 可见 + 字号 210', () => {
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('')
    expect(s.value.titleRight).toBe('')
    expect(s.value.titleFontSize).toBe(210)
    expect(s.value.gradient.stops[0].color).toBe('#f6d365')
    expect(s.value.logoHidden).toBe(false)
    expect(s.value.watermark).toBe('')
  })
  it('缺水印字段的旧档恢复时补默认水印', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      JSON.stringify({ titleLeft: '旧', titleRight: '档', titleFontSize: 210,
        subtitle: '', gradient: { angle: 90, stops: [] },
        presetId: null, logoDataUrl: null, logoHidden: false }))
    const s = useCoverState()
    expect(s.value.watermark).toBe('')
  })
  it('旧档迁移：单框 title 按宽度中点迁移为左右两段并立即回写', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      JSON.stringify({ title: '工具推荐', subtitle: '', gradient: { angle: 120, stops: [] },
        presetId: null, logoDataUrl: null, logoHidden: false }))
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('工具')
    expect(s.value.titleRight).toBe('推荐')
    expect(s.value.titleFontSize).toBe(210)
    // 迁移结果立即落盘为新结构，不再残留旧字段
    const saved = JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!)
    expect(saved.titleLeft).toBe('工具')
    expect(saved.titleRight).toBe('推荐')
    expect(saved.title).toBeUndefined()
  })
  it('新结构存档直接恢复不重复迁移', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      JSON.stringify({ titleLeft: '左', titleRight: '右', titleFontSize: 160,
        subtitle: '', gradient: { angle: 90, stops: [] },
        presetId: null, logoDataUrl: null, logoHidden: false }))
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('左')
    expect(s.value.titleFontSize).toBe(160)
  })
  it('修改后 300ms 防抖落盘（防抖窗口内不写）', async () => {
    vi.useFakeTimers()
    try {
      const s = useCoverState()
      s.value.titleLeft = '测试'
      await nextTick()
      expect(localStorage.getItem('halo-plugin-cover-generator/state/v1')).toBeNull()
      vi.advanceTimersByTime(300)
      expect(JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!).titleLeft).toBe('测试')
    } finally {
      vi.useRealTimers()
    }
  })
  it('离页（pagehide）时立即落盘未到期的防抖写入', async () => {
    vi.useFakeTimers()
    try {
      const s = useCoverState()
      s.value.titleLeft = '离页'
      await nextTick()
      window.dispatchEvent(new Event('pagehide'))
      expect(JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!).titleLeft).toBe('离页')
    } finally {
      vi.useRealTimers()
    }
  })
  it('已有存档时恢复', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      JSON.stringify({ titleLeft: '旧标题', subtitle: '', gradient: { angle: 90, stops: [] },
        presetId: null, logoDataUrl: null, logoHidden: true }))
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('旧标题')
    expect(s.value.logoHidden).toBe(true)
  })
  it('存档损坏时回退默认值', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1', '{oops')
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('')
  })
  it('合法 JSON 但字段类型损坏（gradient:null）时整体回退默认值', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1', '{"gradient":null,"titleLeft":"标题"}')
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('')
    expect(s.value.gradient.stops[0].color).toBe('#f6d365')
  })
  it('titleLeft 为数字时整体回退默认值', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1', '{"titleLeft":123}')
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('')
  })
  it('stop 颜色非 #rrggbb(SVG 注入形态)时整体回退默认值', () => {
    localStorage.setItem(
      'halo-plugin-cover-generator/state/v1',
      JSON.stringify({
        titleLeft: '注入',
        gradient: { angle: 90, stops: [{ offset: 0, color: '#fff"/><image href=x onerror=alert(1)>' }] },
      }),
    )
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('')
    expect(s.value.gradient.stops[0].color).toBe('#f6d365')
  })
  it('logoDataUrl 为外链 URI 时整体回退默认值(SVG 自包含承诺,评审Minor-M1)', () => {
    localStorage.setItem(
      'halo-plugin-cover-generator/state/v1',
      JSON.stringify({
        titleLeft: '外链',
        logoDataUrl: 'https://evil.com/track.png',
        logoHidden: false,
      }),
    )
    const s = useCoverState()
    expect(s.value.logoDataUrl).toBeNull()
    expect(s.value.logoHidden).toBe(false)
    expect(s.value.titleLeft).toBe('')
  })
  it('大写 hex 颜色合法(presets 原样形态)不被误杀', () => {
    localStorage.setItem(
      'halo-plugin-cover-generator/state/v1',
      JSON.stringify({
        titleLeft: '大写',
        gradient: { angle: 90, stops: [{ offset: 0, color: '#FFE29F' }, { offset: 100, color: '#FF719A' }] },
      }),
    )
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('大写')
    expect(s.value.gradient.stops[0].color).toBe('#FFE29F')
  })
  it('gradient 结构损坏（angle 非数字）时整体回退默认值', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      '{"gradient":{"angle":"x","stops":[]},"titleLeft":"标题"}')
    const s = useCoverState()
    expect(s.value.gradient.angle).toBe(120)
    expect(s.value.titleLeft).toBe('')
  })
  it('存档缺字段时用默认值补齐', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1', JSON.stringify({ titleLeft: '只有标题' }))
    const s = useCoverState()
    expect(s.value.titleLeft).toBe('只有标题')
    expect(s.value.gradient.stops[0].color).toBe('#f6d365')
  })
  it('并发重复修改：两次实例交替写入，存档保持合法且为最后一次值', async () => {
    vi.useFakeTimers()
    try {
      const a = useCoverState()
      const b = useCoverState()
      a.value.titleLeft = '第一版'
      b.value.titleLeft = '第二版'
      a.value.subtitle = '副标题A'
      b.value.subtitle = ''
      await nextTick()
      vi.advanceTimersByTime(300)
      const raw = localStorage.getItem('halo-plugin-cover-generator/state/v1')!
      expect(() => JSON.parse(raw)).not.toThrow()
      expect(JSON.parse(raw).titleLeft).toBe('第二版')
    } finally {
      vi.useRealTimers()
    }
  })
  it('localStorage 抛异常时降级内存态不中断', () => {
    vi.useFakeTimers()
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    try {
      const s = useCoverState()
      expect(() => { s.value.titleLeft = '内存态' }).not.toThrow()
      expect(s.value.titleLeft).toBe('内存态')
    } finally {
      Storage.prototype.setItem = original
      vi.useRealTimers()
    }
  })
  it('组件卸载时移除 pagehide 与 visibilitychange 监听(注册与移除为同一引用)', () => {
    const addW = vi.spyOn(window, 'addEventListener')
    const addD = vi.spyOn(document, 'addEventListener')
    const rmW = vi.spyOn(window, 'removeEventListener')
    const rmD = vi.spyOn(document, 'removeEventListener')
    const Host = defineComponent({ setup() { useCoverState(); return () => null } })
    const wrapper = mount(Host)
    const pagehideFn = addW.mock.calls.find(([name]) => name === 'pagehide')?.[1]
    const visibilityFn = addD.mock.calls.find(([name]) => name === 'visibilitychange')?.[1]
    expect(pagehideFn).toBeTypeOf('function')
    expect(visibilityFn).toBeTypeOf('function')
    wrapper.unmount()
    expect(rmW).toHaveBeenCalledWith('pagehide', pagehideFn)
    expect(rmD).toHaveBeenCalledWith('visibilitychange', visibilityFn)
  })
  it('卸载时未到期的防抖写入立即冲刷,不丢最后 300ms 内的编辑', async () => {
    vi.useFakeTimers()
    try {
      let captured: Ref<CoverState> | undefined
      const Host = defineComponent({
        setup() {
          captured = useCoverState()
          return () => null
        },
      })
      const wrapper = mount(Host)
      captured!.value.titleLeft = '临别'
      await nextTick()
      wrapper.unmount()
      const saved = JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!)
      expect(saved.titleLeft).toBe('临别')
    } finally {
      vi.useRealTimers()
    }
  })
  it('落盘失败时置 persistError 信号,恢复后自动清除', async () => {
    vi.useFakeTimers()
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    try {
      const s = useCoverState()
      s.value.titleLeft = '内存态'
      await nextTick()
      vi.advanceTimersByTime(300)
      expect(persistError.value).not.toBe('')

      Storage.prototype.setItem = original
      s.value.titleLeft = '恢复'
      await nextTick()
      vi.advanceTimersByTime(300)
      expect(persistError.value).toBe('')
      expect(JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!).titleLeft)
        .toBe('恢复')
    } finally {
      Storage.prototype.setItem = original
      vi.useRealTimers()
    }
  })
  it('空 stops 存档:其余字段保留,渐变修复为默认并回写(评审#2)', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      JSON.stringify({ titleLeft: '保', titleRight: '留', titleFontSize: 210,
        subtitle: '', gradient: { angle: 90, stops: [] },
        presetId: null, logoDataUrl: null, logoHidden: false, watermark: 'w.com' }))
    const s = useCoverState()
    // 渐变损坏不得连坐用户文本:标题/水印原样保留
    expect(s.value.titleLeft).toBe('保')
    expect(s.value.watermark).toBe('w.com')
    // 渐变修复为默认预设(可渲染的合法渐变),选中态归位
    expect(s.value.gradient.stops.length).toBeGreaterThanOrEqual(2)
    expect(s.value.gradient.stops[0].color).toBe('#f6d365')
    expect(s.value.presetId).toBe('sunset')
    // 修复立即回写,不再残留损坏形态
    const saved = JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!)
    expect(saved.gradient.stops.length).toBeGreaterThanOrEqual(2)
  })
  it('越界数值存档:字号/角度/offset 收敛进安全域并回写(评审M2)', () => {
    localStorage.setItem('halo-plugin-cover-generator/state/v1',
      JSON.stringify({ titleLeft: '越', titleRight: '界', titleFontSize: -5000,
        subtitle: '',
        gradient: { angle: 999, stops: [{ offset: -20, color: '#ffffff' }, { offset: 999, color: '#000000' }] },
        presetId: null, logoDataUrl: null, logoHidden: false, watermark: '' }))
    const s = useCoverState()
    expect(s.value.titleFontSize).toBe(64) // svgBuilder 渲染下限同源
    expect(s.value.gradient.angle).toBe(279) // 999 mod 360,视觉等价归一
    expect(s.value.gradient.stops[0].offset).toBe(0)
    expect(s.value.gradient.stops[1].offset).toBe(100)
    const saved = JSON.parse(localStorage.getItem('halo-plugin-cover-generator/state/v1')!)
    expect(saved.titleFontSize).toBe(64)
  })
})

describe('useCoverState 新增字段(布局与自定义元素)的迁移与信任边界', () => {
  beforeEach(() => localStorage.clear())

  it('旧档补默认锚点，且用户文本与渐变一字不改', () => {
    localStorage.setItem(KEY, legacyArchive())
    const s = useCoverState()
    // 默认锚点等价于改造前的硬编码布局，老用户观感不变
    expect(s.value.layout).toEqual(defaultAnchors())
    expect(s.value.titleMode).toBe('split')
    expect(s.value.customElements).toEqual([])
    // 不得因新增字段缺失而整档回退
    expect(s.value.titleLeft).toBe('工具')
    expect(s.value.watermark).toBe('kept.com')
    expect(s.value.gradient.stops[0].color).toBe('#f6d365')
  })

  it('旧档补齐后立即回写，下次读取不再重复迁移', () => {
    localStorage.setItem(KEY, legacyArchive())
    useCoverState()
    const saved = JSON.parse(localStorage.getItem(KEY)!)
    expect(saved.layout).toBeDefined()
    expect(saved.titleMode).toBe('split')
    expect(saved.customElements).toEqual([])
  })

  it('非法锚点值收敛回安全域', () => {
    localStorage.setItem(KEY, legacyArchive({
      layout: {
        logo: { x: -5, y: 99, scale: 0 },
        title: { x: 0.5, y: 0.5, scale: 1 },
        subtitle: { x: 0.5, y: 0.8, scale: 1 },
        watermark: { x: 0.95, y: 0.93, scale: 1 },
      },
    }))
    const s = useCoverState()
    expect(s.value.layout.logo.x).toBeGreaterThanOrEqual(0)
    expect(s.value.layout.logo.y).toBeLessThanOrEqual(1)
    expect(s.value.layout.logo.scale).toBeGreaterThan(0)
  })

  it('锚点字段类型不符时该元素回退默认，其余元素保留', () => {
    localStorage.setItem(KEY, legacyArchive({
      layout: {
        logo: { x: 'middle', y: 0.5, scale: 1 },
        title: { x: 0.3, y: 0.4, scale: 1 },
      },
    }))
    const s = useCoverState()
    expect(s.value.layout.logo).toEqual(defaultAnchors().logo)
    expect(s.value.layout.title.x).toBeCloseTo(0.3)
  })

  it('非法 titleMode 回退 split', () => {
    localStorage.setItem(KEY, legacyArchive({ titleMode: 'diagonal' }))
    expect(useCoverState().value.titleMode).toBe('split')
  })

  it('合法自定义元素保留，图片必须是 dataURL', () => {
    localStorage.setItem(KEY, legacyArchive({
      customElements: [
        { id: 'a', kind: 'image', content: 'data:image/png;base64,AAA', text: '',
          size: 100, anchor: { x: 0.1, y: 0.1, scale: 1 }, color: '#ffffff', bold: false, tracking: 0, round: false },
        { id: 'b', kind: 'image', content: 'https://evil.example/x.png', text: '',
          size: 100, anchor: { x: 0.2, y: 0.2, scale: 1 }, color: '#ffffff', bold: false, tracking: 0, round: false },
      ],
    }))
    const s = useCoverState()
    expect(s.value.customElements.map((e) => e.id)).toEqual(['a'])
  })

  it('SVG 元素必须含 <svg> 标记，text 元素无此要求', () => {
    localStorage.setItem(KEY, legacyArchive({
      customElements: [
        { id: 's', kind: 'svg', content: 'not svg at all', text: '',
          size: 100, anchor: { x: 0.1, y: 0.1, scale: 1 }, color: '#ffffff', bold: false, tracking: 0, round: false },
        { id: 't', kind: 'text', content: '', text: '文字',
          size: 40, anchor: { x: 0.2, y: 0.2, scale: 1 }, color: '#ffffff', bold: true, tracking: 0, round: false },
      ],
    }))
    const s = useCoverState()
    expect(s.value.customElements.map((e) => e.kind)).toEqual(['text'])
  })

  it('自定义元素数量超限时截断到上限', () => {
    const many = Array.from({ length: MAX_CUSTOM_ELEMENTS + 5 }, (_, i) => ({
      id: `e${i}`, kind: 'text', content: '', text: 'x',
      size: 40, anchor: { x: 0.5, y: 0.5, scale: 1 }, color: '#ffffff', bold: false, tracking: 0, round: false,
    }))
    localStorage.setItem(KEY, legacyArchive({ customElements: many }))
    expect(useCoverState().value.customElements).toHaveLength(MAX_CUSTOM_ELEMENTS)
  })

  it('非数组的 customElements 回退为空数组而非整档丢弃', () => {
    localStorage.setItem(KEY, legacyArchive({ customElements: 'oops' }))
    const s = useCoverState()
    expect(s.value.customElements).toEqual([])
    expect(s.value.titleLeft).toBe('工具')
  })

  it('旧档补齐两种排版的独立文本与中缝间距，且整块文本沿用当时的分缝内容', () => {
    localStorage.setItem(KEY, legacyArchive())
    const s = useCoverState()
    // 迁移时用左右两段填充整块文本，切到整块模式不会看到空标题
    expect(s.value.titleFlow).toBe('工具推荐')
    expect(s.value.seamGap).toBe(80)
  })

  it('已存在 titleFlow 时不覆盖用户在新模式下的输入', () => {
    localStorage.setItem(KEY, legacyArchive({ titleFlow: '整块模式下写的标题' }))
    expect(useCoverState().value.titleFlow).toBe('整块模式下写的标题')
  })

  it('越界的中缝间距收敛进安全域，非法值回落默认', () => {
    localStorage.setItem(KEY, legacyArchive({ seamGap: 9999 }))
    expect(useCoverState().value.seamGap).toBe(400)
    localStorage.setItem(KEY, legacyArchive({ seamGap: -50 }))
    expect(useCoverState().value.seamGap).toBe(0)
    localStorage.setItem(KEY, legacyArchive({ seamGap: 'wide' }))
    expect(useCoverState().value.seamGap).toBe(80)
  })

  it('旧档补齐图层顺序：内置四元素齐全，自定义元素各自入列', () => {
    localStorage.setItem(KEY, legacyArchive({
      customElements: [{
        id: 'z1', kind: 'text', content: '', text: 'x',
        size: 40, anchor: { x: 0.5, y: 0.5, scale: 1 },
        color: '#ffffff', bold: false, tracking: 0, round: false,
      }],
    }))
    const s = useCoverState()
    expect(s.value.layers).toContain('custom:z1')
    for (const key of ['logo', 'title', 'subtitle', 'watermark']) {
      expect(s.value.layers).toContain(key)
    }
  })

  it('图层表剔除未知键与重复项，保留用户排定的相对顺序', () => {
    localStorage.setItem(KEY, legacyArchive({
      layers: ['watermark', 'nope', 'title', 'watermark', 'logo'],
    }))
    const s = useCoverState()
    expect(s.value.layers.filter((k) => k === 'watermark')).toHaveLength(1)
    expect(s.value.layers).not.toContain('nope')
    // 用户把水印排在最前的意图保留
    expect(s.value.layers[0]).toBe('watermark')
    expect(s.value.layers).toContain('subtitle')
  })

  it('图层顺序中的自定义元素在元素被剔除后一并清理', () => {
    localStorage.setItem(KEY, legacyArchive({
      customElements: [{ id: 'bad', kind: 'image', content: 'https://evil/x.png', text: '',
        size: 40, anchor: { x: 0.5, y: 0.5, scale: 1 },
        color: '#ffffff', bold: false, tracking: 0, round: false }],
      layers: ['title', 'custom:bad'],
    }))
    const s = useCoverState()
    expect(s.value.customElements).toEqual([])
    expect(s.value.layers).not.toContain('custom:bad')
  })

  it('颜色非 #rrggbb 的自定义元素被剔除（防标记注入）', () => {
    localStorage.setItem(KEY, legacyArchive({
      customElements: [
        { id: 'x', kind: 'text', content: '', text: 'x',
          size: 40, anchor: { x: 0.5, y: 0.5, scale: 1 }, color: '"><script>', bold: false, tracking: 0, round: false },
      ],
    }))
    expect(useCoverState().value.customElements).toEqual([])
  })

  describe('背景字段（旧档补齐与信任边界）', () => {
    it('旧档无背景字段时补为渐变 + 空图 + 默认压暗', () => {
      localStorage.setItem(KEY, legacyArchive())
      const s = useCoverState()
      expect(s.value.backgroundMode).toBe('gradient')
      expect(s.value.backgroundImage).toBeNull()
      expect(s.value.backgroundScrim).toBe(20)
    })

    it('背景图只接受 data:image/*：外链背景被就地丢弃,其余字段保留', () => {
      localStorage.setItem(KEY, legacyArchive({
        backgroundMode: 'image', backgroundImage: 'https://evil.example/x.png', watermark: 'kept.com',
      }))
      const s = useCoverState()
      expect(s.value.backgroundImage).toBeNull()
      // 不变式：image 模式必有图，缺图即回落渐变
      expect(s.value.backgroundMode).toBe('gradient')
      expect(s.value.watermark).toBe('kept.com')
    })

    it('合法的内嵌背景图与压暗值原样保留', () => {
      localStorage.setItem(KEY, legacyArchive({
        backgroundMode: 'image', backgroundImage: 'data:image/png;base64,AAA', backgroundScrim: 45,
      }))
      const s = useCoverState()
      expect(s.value.backgroundMode).toBe('image')
      expect(s.value.backgroundImage).toBe('data:image/png;base64,AAA')
      expect(s.value.backgroundScrim).toBe(45)
    })

    it('越界或非法的压暗值收敛进 0–60', () => {
      localStorage.setItem(KEY, legacyArchive({ backgroundScrim: 999 }))
      expect(useCoverState().value.backgroundScrim).toBe(60)

      localStorage.setItem(KEY, legacyArchive({ backgroundScrim: -20 }))
      expect(useCoverState().value.backgroundScrim).toBe(0)

      localStorage.setItem(KEY, legacyArchive({ backgroundScrim: 'x' }))
      expect(useCoverState().value.backgroundScrim).toBe(20)
    })
  })

  describe('文字排版样式（旧档补齐与越界收敛）', () => {
    it('旧档无 textStyles 时补默认：标题无字距、副标题 0.3em、水印 0.08em', () => {
      localStorage.setItem(KEY, legacyArchive())
      const s = useCoverState()
      expect(s.value.textStyles.title).toEqual({
        tracking: 0, curve: 0, rotation: 0, direction: 'horizontal',
      })
      expect(s.value.textStyles.subtitle.tracking).toBeCloseTo(0.3, 5)
      expect(s.value.textStyles.watermark.tracking).toBeCloseTo(0.08, 5)
    })

    it('越界的字距/弯曲/旋转收敛进安全域，方向只认横排与竖排', () => {
      localStorage.setItem(KEY, legacyArchive({
        textStyles: {
          title: { tracking: 99, curve: 400, rotation: -900, direction: 'vertical' },
          subtitle: { tracking: -9, curve: -400, rotation: 900, direction: '斜排' },
          watermark: {},
        },
      }))
      const s = useCoverState()
      expect(s.value.textStyles.title).toEqual({
        tracking: 1.5, curve: 100, rotation: -180, direction: 'vertical',
      })
      expect(s.value.textStyles.subtitle).toEqual({
        tracking: -0.2, curve: -100, rotation: 180, direction: 'horizontal',
      })
      // 空对象逐字段回落默认，而不是整块丢弃
      expect(s.value.textStyles.watermark.tracking).toBeCloseTo(0.08, 5)
    })

    it('单个字段非法不影响同组其它字段', () => {
      localStorage.setItem(KEY, legacyArchive({
        textStyles: { title: { tracking: 0.5, curve: 'x', rotation: 30, direction: 'horizontal' } },
      }))
      expect(useCoverState().value.textStyles.title).toMatchObject({
        tracking: 0.5, curve: 0, rotation: 30,
      })
    })
  })

  describe('默认位置（重置）取整数百分比', () => {
    it('四个元素的默认锚点都是整百分比、大小为 100%', () => {
      localStorage.clear()
      const s = useCoverState()
      for (const key of ['logo', 'title', 'subtitle', 'watermark'] as const) {
        const a = s.value.layout[key]
        // 面板显示的是四舍五入后的百分比：只有存进去的就是整数，重置完才名实相符。
        // x*100 带浮点尾数（0.56*100 = 56.00000000000001），所以用容差判定
        for (const v of [a.x, a.y]) {
          expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9)
        }
        expect(a.scale).toBe(1)
      }
      // 重置后各元素落在哪里：与 1200×630 旧硬编码布局基本重合
      expect(s.value.layout.logo).toMatchObject({ x: 0.5, y: 0.52 })
      expect(s.value.layout.title).toMatchObject({ x: 0.5, y: 0.56 })
      expect(s.value.layout.subtitle).toMatchObject({ x: 0.5, y: 0.8 })
      expect(s.value.layout.watermark).toMatchObject({ x: 0.96, y: 0.94 })
    })
  })
})
