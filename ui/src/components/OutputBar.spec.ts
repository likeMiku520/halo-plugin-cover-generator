import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import OutputBar from './OutputBar.vue'
import type { PostSummary } from '../api/haloClient'

/** 动作条默认可用态(canExport=true,无在途动作) */
function mountBar(props: Record<string, unknown> = {}) {
  return mount(OutputBar, {
    props: {
      canExport: true,
      fontError: '',
      exporting: false,
      exportError: '',
      summary: '尺寸 1200 × 630 · 日落橙 · 字号 210 px',
      copySuccess: '',
      copyError: '',
      saving: false,
      saveError: '',
      savePermalink: '',
      permalinkHref: '',
      selectedPost: null,
      binding: false,
      bindError: '',
      bindSuccess: '',
      downloadFlash: '',
      ...props,
    },
    global: { stubs: { PostPicker: true } },
    attachTo: document.body,
  })
}

const POST: PostSummary = { name: 'p-a', title: 'Hello halo' }

describe('OutputBar 智能保存(S2)', () => {
  it('未选文章:主按钮为「保存到附件」,点击抛 save;无「仅保存」', async () => {
    const wrapper = mountBar()
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存到附件')
    expect(saveBtn).toBeTruthy()
    expect(wrapper.findAll('button').some((b) => b.text() === '仅保存')).toBe(false)

    await saveBtn!.trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)
    wrapper.unmount()
  })

  it('选中文章后:主按钮变「保存并绑定」,出现「仅保存」次级出口与「已选择」行(评审:目标由反馈区呈现)', async () => {
    const wrapper = mountBar({ selectedPost: POST })
    expect(wrapper.findAll('button').some((b) => b.text() === '保存并绑定')).toBe(true)
    expect(wrapper.text()).toContain('已选择:Hello halo')

    const only = wrapper.findAll('button').find((b) => b.text() === '仅保存')!
    await only.trigger('click')
    expect(wrapper.emitted('save-only')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined() // 仅保存不得走绑定链路
    wrapper.unmount()
  })

  it('不可导出时保存按钮禁用', () => {
    const wrapper = mountBar({ canExport: false })
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存到附件')!
    expect(saveBtn.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('绑定进行中「仅保存」禁用,阻断并发第二次附件上传(评审#1)', () => {
    const wrapper = mountBar({ selectedPost: POST, binding: true })
    const only = wrapper.findAll('button').find((b) => b.text() === '仅保存')!
    expect(only.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

describe('OutputBar 动作成功反馈(按钮短暂 ✓,自动复原)', () => {
  it('复制成功后「复制 SVG」短暂变「✓ 已复制」,提示清除后复原', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountBar()
      await wrapper.setProps({ copySuccess: 'SVG 源码已复制到剪贴板' })
      expect(wrapper.findAll('button').some((b) => b.text() === '✓ 已复制')).toBe(true)

      vi.advanceTimersByTime(2500)
      await nextTick() // 定时器置回 ref 后等 Vue 完成 DOM 补丁再断言
      expect(wrapper.findAll('button').some((b) => b.text() === '✓ 已复制')).toBe(false)
      expect(wrapper.findAll('button').some((b) => b.text() === '复制 SVG')).toBe(true)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('保存成功后主按钮短暂变「✓ 已保存」,复原后回到智能文案', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountBar()
      await wrapper.setProps({ savePermalink: '/upload/标题-cover.png' })
      expect(wrapper.findAll('button').some((b) => b.text() === '✓ 已保存')).toBe(true)

      vi.advanceTimersByTime(2500)
      await nextTick()
      expect(wrapper.findAll('button').some((b) => b.text() === '✓ 已保存')).toBe(false)
      expect(wrapper.findAll('button').some((b) => b.text() === '保存到附件')).toBe(true)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('下载反馈由 downloadFlash 驱动:svg/png 各自短暂变「✓ 已下载」', async () => {
    const wrapper = mountBar()
    expect(wrapper.findAll('button').some((b) => b.text() === '下载 SVG')).toBe(true)
    expect(wrapper.findAll('button').find((b) => b.text().startsWith('下载 PNG'))).toBeTruthy()

    await wrapper.setProps({ downloadFlash: 'svg' })
    expect(wrapper.findAll('button').some((b) => b.text() === '✓ 已下载')).toBe(true)
    wrapper.unmount()

    const wrapper2 = mountBar({ downloadFlash: 'png' })
    expect(wrapper2.findAll('button').some((b) => b.text() === '✓ 已下载')).toBe(true)
    wrapper2.unmount()
  })
})

describe('OutputBar PNG 倍率 split 按钮(S3)', () => {
  it('菜单默认收起;点开显示两档直白文案,选中后沿 export-png 携带倍率', async () => {
    const wrapper = mountBar()
    const caret = wrapper.find('button[aria-label="选择 PNG 导出尺寸"]')
    expect(wrapper.find('.png-menu').exists()).toBe(false)

    await caret.trigger('click')
    const items = wrapper.findAll('.menu-item')
    expect(items.map((i) => i.text())).toEqual([
      '标准 1200 × 630「下载 PNG」的导出尺寸;保存到附件恒为标准',
      '高清 2400 × 12602 倍分辨率,文件更大',
    ])

    // 默认 1x:下载不带倍率变化
    await wrapper.findAll('button').find((b) => b.text().startsWith('下载 PNG'))!.trigger('click')
    expect(wrapper.emitted('export-png')!.at(-1)).toEqual([1])

    // 选高清后:主按钮标注 2×,点击携带 2
    await items[1].trigger('click')
    expect(wrapper.find('.png-menu').exists()).toBe(false) // 选中即收起
    expect(wrapper.findAll('button').some((b) => b.text() === '下载 PNG 2×')).toBe(true)
    await wrapper.findAll('button').find((b) => b.text() === '下载 PNG 2×')!.trigger('click')
    expect(wrapper.emitted('export-png')!.at(-1)).toEqual([2])
    wrapper.unmount()
  })

  it('PNG 菜单方向键在菜单项间移动焦点,Home/End 跳首末(评审M10,ARIA menu 键盘契约)', async () => {
    const wrapper = mountBar()
    const caret = wrapper.find('button[aria-label="选择 PNG 导出尺寸"]')
    await caret.trigger('click')
    const items = wrapper.findAll('.menu-item')

    // caret 上 ArrowDown:开菜单并聚焦首项
    await caret.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(document.activeElement).toBe(items[0].element)

    // 菜单内 ↓↕ 循环移动,Home/End 跳首末
    await items[0].trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1].element)
    await items[1].trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0].element) // 循环
    await items[0].trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(items[1].element)
    await items[1].trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0].element)
    wrapper.unmount()
  })

  it('导出进行中按钮变「导出中…」并禁用(C2)', () => {
    const wrapper = mountBar({ exporting: true })
    const pngBtn = wrapper.findAll('button').find((b) => b.text() === '导出中…')!
    expect(pngBtn).toBeTruthy()
    expect(pngBtn.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('PNG 菜单 Esc 关闭并把焦点还给 caret;点击外部关闭;点主按钮按当前倍率导出并收起(B3)', async () => {
    const wrapper = mountBar()
    const caret = wrapper.find('button[aria-label="选择 PNG 导出尺寸"]')
    expect(caret.attributes('aria-haspopup')).toBe('menu')

    await caret.trigger('click')
    expect(wrapper.find('.png-menu').exists()).toBe(true)

    ;(caret.element as HTMLElement).focus()
    await caret.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.png-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(caret.element)

    // 点击外部(pointerdown 落在组件外)关闭
    await caret.trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(wrapper.find('.png-menu').exists()).toBe(false)

    // 主按钮点击:菜单收起,仍按当前倍率导出
    await caret.trigger('click')
    await wrapper.findAll('button').find((b) => b.text().startsWith('下载 PNG'))!.trigger('click')
    expect(wrapper.find('.png-menu').exists()).toBe(false)
    expect(wrapper.emitted('export-png')!.at(-1)).toEqual([1])
    wrapper.unmount()
  })
})

describe('OutputBar 进行时反馈与禁用原因(A4/A5)', () => {
  it('保存进行中主按钮变「保存中…」,绑定进行中变「绑定中…」', () => {
    const saving = mountBar({ saving: true })
    expect(saving.findAll('button').some((b) => b.text() === '保存中…')).toBe(true)
    saving.unmount()

    const binding = mountBar({ selectedPost: POST, binding: true })
    expect(binding.findAll('button').some((b) => b.text() === '绑定中…')).toBe(true)
    binding.unmount()
  })

  it('无标题且字体正常时提示「填写标题后可导出或保存」,有标题则不提示', () => {
    const noTitle = mountBar({ canExport: false })
    expect(noTitle.text()).toContain('填写标题后可导出或保存')
    noTitle.unmount()

    const ready = mountBar()
    expect(ready.text()).not.toContain('填写标题后可导出或保存')
    ready.unmount()
  })

  it('字体失败时只给字体原因,不再叠加空标题提示(二者互斥)', () => {
    const broken = mountBar({ canExport: false, fontError: '字体加载失败:预览已降级为系统字体,' })
    expect(broken.text()).toContain('导出不可用')
    expect(broken.text()).not.toContain('填写标题后可导出或保存')
    broken.unmount()
  })
})

describe('OutputBar 反馈行', () => {
  it('保存成功展示含 permalink 的成功行;失败行与字体降级原因各行其位', () => {
    const ok = mountBar({
      savePermalink: '/upload/标题-cover.png',
      permalinkHref: 'http://localhost/upload/标题-cover.png',
    })
    const link = ok.find('.success a')
    expect(link.attributes('href')).toBe('http://localhost/upload/标题-cover.png')
    expect(link.text()).toBe('/upload/标题-cover.png')
    ok.unmount()

    const errs = mountBar({ fontError: '字体加载失败:预览已降级为系统字体,', exportError: 'PNG 导出失败' })
    expect(errs.text()).toContain('导出不可用')
    expect(errs.text()).toContain('PNG 导出失败')
    errs.unmount()
  })

  it('绑定成功/失败提示呈现(M11)', () => {
    const wrapper = mountBar({ selectedPost: POST, bindSuccess: '封面已绑定到《Hello halo》' })
    expect(wrapper.text()).toContain('封面已绑定到《Hello halo》')
    wrapper.unmount()

    const failed = mountBar({ selectedPost: POST, bindError: '绑定文章封面失败' })
    expect(failed.text()).toContain('绑定文章封面失败')
    failed.unmount()
  })
})
