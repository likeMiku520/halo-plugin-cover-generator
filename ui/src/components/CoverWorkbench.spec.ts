import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { axiosInstance } from '@halo-dev/api-client'
import CoverWorkbench from './CoverWorkbench.vue'
import CoverPreview from './CoverPreview.vue'
import { BUILTIN_FONT_URL } from '../lib/fontLoader'
import { defaultCoverState } from '../lib/layout'
import type { CoverState, CustomElement, CustomKind } from '../lib/types'
import { STORAGE_KEY, persistError } from '../composables/useCoverState'
import { pluginSettingsDegraded } from '../composables/usePluginSettings'
import { svgToPngBlob } from '../lib/exporters'
import { loadCoverFont } from '../lib/fontLoader'

// 工作台挂载即异步读取插件设置;mock 掉 Console HTTP 客户端保证测试封闭
vi.mock('@halo-dev/api-client', () => ({
  axiosInstance: {
    get: vi.fn<(url: string) => Promise<unknown>>(async () => configMapResponse({})),
    post: vi.fn<(url: string, data: unknown) => Promise<unknown>>(),
    put: vi.fn<(url: string, data: unknown) => Promise<unknown>>(),
  },
}))
const mockedGet = vi.mocked(axiosInstance.get)
const mockedPost = vi.mocked(axiosInstance.post)
const mockedPut = vi.mocked(axiosInstance.put)

// canvas 栅格化在 jsdom(无 2D 上下文)中必然失败,按用例改为可控桩;
// 其余导出函数保持真实实现,下载行为不受影响
vi.mock('../lib/exporters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/exporters')>()),
  svgToPngBlob: vi.fn<(svg: string, canvas: { width: number; height: number }, scale?: number) => Promise<Blob>>(),
}))

// 字体加载按用例可控:默认不解析(返回 undefined ⇒ 降级禁用),成功用例再桩为真值;
// 其余导出(pathToD 等)保持真实实现供 svgBuilder 使用
vi.mock('../lib/fontLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/fontLoader')>()),
  loadCoverFont: vi.fn<(url: string) => Promise<unknown>>(),
}))

/** spike 实测的上传成功响应(本地存储,permalink 为相对路径) */
const MEASURED_ATTACHMENT = {
  apiVersion: 'storage.halo.run/v1alpha1',
  kind: 'Attachment',
  metadata: {
    annotations: { 'storage.halo.run/uri': '/upload/标题-cover.png' },
    name: 'c06e23f6-74ad',
    version: 0,
  },
  spec: { displayName: '标题-cover.png', policyName: 'default-policy', groupName: 'cover-generator' },
  status: { permalink: '/upload/标题-cover.png' },
}

/** spike 实测的单篇文章资源(updatePostCover 的 GET/PUT 目标,metadata.version 为乐观锁) */
const MEASURED_POST = {
  apiVersion: 'content.halo.run/v1alpha1',
  kind: 'Post',
  metadata: {
    annotations: { 'content.halo.run/permalink-pattern': '/archives/{slug}' },
    creationTimestamp: '2026-09-06T09:32:48.619915134Z',
    finalizers: ['post-protection'],
    labels: { 'content.halo.run/published': 'true' },
    name: '5152aea5-c2e8-4717-8bba-2263d46e19d5',
    version: 4,
  },
  spec: {
    allowComment: true,
    cover: '',
    deleted: false,
    excerpt: { autoGenerate: false, raw: '正文' },
    pinned: false,
    priority: 0,
    publish: true,
    slug: 'hello-halo',
    title: 'Hello halo',
    visible: 'PUBLIC',
  },
}

/** spike 实测的 Console 文章列表项(ListedPost:聚合 owner/stats 与内嵌 Post) */
const MEASURED_LISTED_ITEM = {
  categories: [],
  contributors: [{ displayName: 'Administrator', name: 'admin' }],
  owner: { displayName: 'Administrator', name: 'admin' },
  post: MEASURED_POST,
  stats: { visit: 0, upvote: 0, totalComment: 0, approvedComment: 0 },
  tags: [],
}

/** 第二篇文章(切换选中场景:验证旧绑定反馈被清空) */
const SECOND_LISTED_ITEM = {
  ...MEASURED_LISTED_ITEM,
  post: {
    ...MEASURED_POST,
    metadata: { ...MEASURED_POST.metadata, name: 'post-second' },
    spec: { ...MEASURED_POST.spec, title: 'Second post' },
  },
}

/**
 * 按路径关键字路由 GET:设置 ConfigMap / 文章检索(列表)/ 文章读取(单篇)。
 * Console 列表路径为 api.console.halo.run/v1alpha1/posts(并不含单篇键的
 * 'content.halo.run/v1alpha1/posts' 子串,两个关键字互不重叠,先后皆可)。
 */
function routeGet(items = [MEASURED_LISTED_ITEM]) {
  mockedGet.mockImplementation(async (url: string) => {
    if (url.includes('api.console.halo.run/v1alpha1/posts')) {
      return { data: { items, total: items.length } }
    }
    if (url.includes('content.halo.run/v1alpha1/posts')) {
      return { data: JSON.parse(JSON.stringify(MEASURED_POST)) }
    }
    return configMapResponse({})
  })
}

/** spike 实测的失败响应形态(RFC-7807 ProblemDetail) */
function axiosProblemDetail(status: number, detail: string) {
  const e = new Error(`Request failed with status code ${status}`) as Error & {
    response?: { status: number; data: unknown }
  }
  e.response = {
    status,
    data: { detail, status, title: 'Not Found', type: 'https://www.halo.run/api/errors/extension-not-found' },
  }
  return e
}

/** jsdom 未实现 ResizeObserver(CoverPreview 的预览缩放依赖它),提供最小桩保证可挂载 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * 构造 axiosInstance.get 的 ConfigMap 响应。
 * Halo 把 Setting 表单组(base)的表单值序列化为 JSON 串存入 data.base。
 */
function configMapResponse(form: Record<string, string>) {
  return {
    data: {
      apiVersion: 'v1alpha1',
      kind: 'ConfigMap',
      metadata: { name: 'cover-generator-configmap' },
      data: { base: JSON.stringify(form) },
    },
    // axios 其余响应字段(status/headers/config 等)与本测试无关,以类型断言收敛
  } as unknown as Awaited<ReturnType<typeof axiosInstance.get>>
}

describe('CoverWorkbench', () => {
  beforeAll(() => {
    if (!('ResizeObserver' in globalThis)) {
      ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub
    }
  })

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  afterEach(async () => {
    // 播种会触发 useCoverState 的 300ms 防抖落盘;套件并发下该定时器可能在
    // 下一个测试中途才写入存档,造成跨测试污染。先等防抖落定再清理存档。
    await new Promise<void>((resolve) => setTimeout(resolve, 350))
    localStorage.removeItem(STORAGE_KEY)
    Reflect.deleteProperty(window.navigator, 'clipboard') // 移除 C1 用例注入的剪贴板桩
    vi.unstubAllGlobals()
    mockedGet.mockReset()
    mockedPost.mockReset()
    mockedPut.mockReset()
    vi.mocked(svgToPngBlob).mockReset()
    vi.mocked(loadCoverFont).mockReset()
  })

  it('挂载渲染预览容器与「下载 SVG」「下载 PNG」「保存到附件」按钮', async () => {
    const wrapper = mount(CoverWorkbench, {
      attachTo: document.body,
    })
    // 字体加载为异步 fetch;测试环境中必然失败,工作台须降级为 font=null 而非抛错
    await flushPromises()

    expect(wrapper.find('.preview-box').exists()).toBe(true)
    const texts = wrapper.findAll('button').map((b) => b.text())
    expect(texts).toContain('下载 SVG')
    expect(texts).toContain('下载 PNG')
    expect(texts).toContain('保存到附件')
    wrapper.unmount()
  })

  it('字体加载失败时导出按钮渲染为禁用(降级不崩溃)', async () => {
    vi.mocked(loadCoverFont).mockRejectedValueOnce(new Error('font decode failed'))
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    const svgBtn = wrapper.findAll('button').find((b) => b.text() === '下载 SVG')
    expect(svgBtn?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  /** S3 字体能力桩(同 mountExportable 内联桩):解析成功 ⇒ 渲染与导出可用 */
  function stubFontResolves() {
    vi.mocked(loadCoverFont).mockResolvedValue({
      getAdvanceWidth: (t: string, s: number) => t.length * s * 0.55,
      getPath: () => ({ commands: [] }),
    } as unknown as Awaited<ReturnType<typeof loadCoverFont>>)
  }

  it('S3: 设置 fontUrl 非空且加载成功时以自定义字体渲染,导出可用', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ fontUrl: 'https://cdn.example.com/brand.otf' }))
    stubFontResolves()
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    // 自定义 URL 优先于内置字体资产(模块边界断言加载入参)
    expect(vi.mocked(loadCoverFont)).toHaveBeenCalledWith('https://cdn.example.com/brand.otf')
    // 出厂是整块排版：标题写在 titleFlow，canExport 才为真
    await wrapper.find('input[aria-label="整块标题"]').setValue('标题')
    const svgBtn = wrapper.findAll('button').find((b) => b.text() === '下载 SVG')!
    expect(svgBtn.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('S3: 设置 fontUrl 非空但加载失败时不得静默回退内置字体——降级禁导出并给出中文原因', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ fontUrl: 'https://cdn.example.com/broken.otf' }))
    vi.mocked(loadCoverFont).mockRejectedValueOnce(new Error('字体加载失败:HTTP 404'))
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    // 恰一次加载且用自定义 URL:不允许改用内置字体掩盖配置错误
    expect(vi.mocked(loadCoverFont)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(loadCoverFont)).toHaveBeenCalledWith('https://cdn.example.com/broken.otf')
    expect(wrapper.text()).toContain('字体加载失败')
    const svgBtn = wrapper.findAll('button').find((b) => b.text() === '下载 SVG')!
    expect(svgBtn.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('S3: fontUrl 为空时沿用内置字体资产(ReverseProxy 静态路径,M7 出包)', async () => {
    stubFontResolves()
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    expect(vi.mocked(loadCoverFont)).toHaveBeenCalledWith(BUILTIN_FONT_URL)
    wrapper.unmount()
  })

  it('bundledFontUrl prop 覆盖内置字体地址(harness 视觉验证通道)', async () => {
    stubFontResolves()
    const wrapper = mount(CoverWorkbench, { props: { bundledFontUrl: '/harness/font.otf' } })
    await flushPromises()

    expect(vi.mocked(loadCoverFont)).toHaveBeenCalledWith('/harness/font.otf')
    wrapper.unmount()
  })

  it('G1: 预览渲染防抖——输入后 150ms 合帧窗口内预览不重渲染,随后追平', async () => {
    stubFontResolves()
    const wrapper = mount(CoverWorkbench, { attachTo: document.body })
    await flushPromises()
    const previewProp = () => wrapper.findComponent(CoverPreview).props('svg') as string
    const before = previewProp()

    await wrapper.find('input[aria-label="整块标题"]').setValue('防抖')
    await nextTick()
    // 防抖窗口内:预览仍显示输入前的 SVG(逐字节相同)
    expect(previewProp()).toBe(before)

    // 窗口过去:预览追平实时 SVG(标题已变 ⇒ 内容必然不同)
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    expect(previewProp()).not.toBe(before)
    wrapper.unmount()
  }, 5000)

  it('C3: 字体加载中头部明示「字体加载中…」,加载完成后提示消失', async () => {
    let resolveFont!: (v: Awaited<ReturnType<typeof loadCoverFont>>) => void
    vi.mocked(loadCoverFont).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFont = resolve }),
    )
    const wrapper = mount(CoverWorkbench)
    await flushPromises()
    expect(wrapper.text()).toContain('字体加载中…')

    resolveFont({
      getAdvanceWidth: (t: string, s: number) => t.length * s * 0.55,
      getPath: () => ({ commands: [] }),
    } as unknown as Awaited<ReturnType<typeof loadCoverFont>>)
    await flushPromises()
    expect(wrapper.text()).not.toContain('字体加载中…')
    wrapper.unmount()
  })

  it('挂载时插件设置(ConfigMap)仅读取一次,播种与字体共用同一次读取', async () => {
    // PostPicker 仅在用户输入后检索,普通挂载下 GET 计数即设置读取次数
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    expect(mockedGet).toHaveBeenCalledTimes(1)
    expect(mockedGet).toHaveBeenCalledWith('/api/v1alpha1/configmaps/cover-generator-configmap')
    wrapper.unmount()
  })

  /** C1:向 jsdom navigator 注入可控剪贴板桩(afterEach 统一摘除) */
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    const spy = vi.fn<(text: string) => Promise<void>>(writeText)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: spy }, configurable: true })
    return spy
  }

  it('C1: 点击「复制 SVG」把当前 SVG 源码写入剪贴板并提示成功', async () => {
    const writeText = stubClipboard(async () => {})
    const wrapper = await mountExportable()

    await wrapper.findAll('button').find((b) => b.text() === '复制 SVG')!.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledOnce()
    // 写入的必须是与预览一致的当前 SVG 源码(逐字节相同)
    const previewSvg = wrapper.findComponent(CoverPreview).props('svg') as string
    expect(writeText.mock.calls[0][0]).toBe(previewSvg)
    expect(wrapper.text()).toContain('已复制到剪贴板')
    wrapper.unmount()
  })

  it('C1: 剪贴板写入失败时展示中文错误提示', async () => {
    const writeText = stubClipboard(async () => {
      throw new Error('剪贴板权限被拒绝')
    })
    const wrapper = await mountExportable()

    await wrapper.findAll('button').find((b) => b.text() === '复制 SVG')!.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('复制失败')
    expect(wrapper.text()).not.toContain('已复制到剪贴板')
    wrapper.unmount()
  })

  it('C2: 选高清(2x)后画布按出厂分辨率翻倍(1200×675 ⇒ 2400×1350),附件上传仍为 1x', async () => {
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const wrapper = await mountExportable()

    // 本地下传走真实 exporters:以 canvas 桩捕获实际尺寸(同 downloadPng 测试的桩法)
    class FakeImage {
      onload: () => void = () => {}
      onerror: () => void = () => {}
      set src(_: string) {
        this.onload()
      }
    }
    const canvases: { width: number; height: number }[] = []
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('document', {
      // PNG 菜单开合经 useDismiss 挂/卸 document 监听,桩须提供最小接口
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          const c = {
            width: 0,
            height: 0,
            getContext: () => ({ scale: () => {}, drawImage: () => {} }),
            toBlob: (ok: (b: Blob) => void) => ok(new Blob(['png'], { type: 'image/png' })),
          }
          canvases.push(c)
          return c
        }
        return { href: '', download: '', click: () => {}, remove: () => {} }
      },
      body: { appendChild: () => {} },
    })

    // 下载成功后按钮短暂变「✓ 已下载」(2.5s):用假时间瞬时推进复原,避免真实等待
    vi.useFakeTimers()
    try {
      const pngBtn = () => wrapper.findAll('button').find((b) => b.text().startsWith('下载 PNG'))!
      // 默认 PNG:1x ⇒ 出厂分辨率(2.0.0 起为宽屏 1200×675,不再是 1200×630)
      await pngBtn().trigger('click')
      await flushPromises()
      expect(canvases[0]?.width).toBe(1200)
      expect(canvases[0]?.height).toBe(675)
      vi.advanceTimersByTime(2500)
      await nextTick() // 反馈复原,按钮文案恢复可按原文案检索

      // 切到高清 2x(S3 split 菜单):倍率沿下载链路传播 ⇒ 2400×1260
      await wrapper.find('button[aria-label="选择 PNG 导出尺寸"]').trigger('click')
      await wrapper.findAll('.menu-item').find((i) => i.text().includes('高清'))!.trigger('click')
      expect(pngBtn().text()).toBe('下载 PNG 2×') // 选中档位在主按钮上明示
      await pngBtn().trigger('click')
      await flushPromises()
      expect(canvases[1]?.width).toBe(2400) // 1200 × 2
      expect(canvases[1]?.height).toBe(1350) // 675 × 2
      vi.advanceTimersByTime(2500)
      await nextTick()

      vi.unstubAllGlobals() // 先还原全局,避免后续交互踩到 document 桩

      // Global Constraint:附件上传恒为 1x(svgToPngBlob 由上传路径调用,不携带倍率;
// 第二参数是当前分辨率,第三参数才是倍率,缺省即 1x)
      await wrapper.findAll('button').find((b) => b.text() === '保存到附件')!.trigger('click')
      await flushPromises()
      expect(vi.mocked(svgToPngBlob)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(svgToPngBlob)).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ width: 1200, height: 675 }),
      )
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('无存档时以插件设置播种水印初始值', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ watermark: 'example.com' }))
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    const input = wrapper.find('input[aria-label="域名水印"]')
    expect((input.element as HTMLInputElement).value).toBe('example.com')
    wrapper.unmount()
  })

  it('无存档且设置含 logoUrl 时拉取并转为 dataURL 播种(而非直接写远程直链)', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ logoUrl: 'https://cdn.example.com/logo.png' }))
    const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<unknown>>(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['abc'], { type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(CoverWorkbench)
    await flushPromises()
    // FileReader 的 load 事件经由多个宏任务派发,轮询等待播种完成
    await until(() => wrapper.text().includes('恢复默认'))

    // state.logoDataUrl 已播种 ⇒ 「恢复默认」按钮出现,Logo 处于显示态(A2 开关语义)
    expect(wrapper.findAll('button').map((b) => b.text())).toContain('恢复默认')
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('默认 Logo 拉取失败时回退 Logo 隐藏态并静默继续', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ logoUrl: 'https://cdn.example.com/logo.png' }))
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: unknown, init?: unknown) => Promise<unknown>>(async () => ({
        ok: false,
        status: 404,
        blob: async () => new Blob([], { type: 'image/png' }),
      })),
    )
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('恢复默认')
    // logoHidden = true(A2:开关呈未选中态)
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('拉取窗口内用户显式隐藏 Logo 时,拉取成功不得翻回显示态', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ logoUrl: 'https://cdn.example.com/logo.png' }))
    // 受控 fetch:挂载后保持 pending,模拟拉取耗时窗口
    let resolveFetch!: (v: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: unknown, init?: unknown) => Promise<unknown>>(
        () => new Promise((resolve) => { resolveFetch = resolve }),
      ),
    )
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    // 拉取仍在途,用户点击开关表达隐藏意图
    const sw = wrapper.find('button[role="switch"]')
    expect(sw.attributes('aria-checked')).toBe('true')
    await sw.trigger('click')
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false')

    // 拉取成功落地:默认图允许播种,但用户的显式隐藏必须保留
    resolveFetch({ ok: true, status: 200, blob: async () => new Blob(['abc'], { type: 'image/png' }) })
    await until(() => wrapper.text().includes('恢复默认'))
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('存在本地存档时存档优先,设置不覆盖存档内容', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        titleLeft: '存档', titleRight: '标题', titleFontSize: 210, subtitle: '',
        // 6 位 hex:真实存档只可能来自 presets/取色器/CSS 解析,均为 #rrggbb 归一形态
        gradient: { angle: 45, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] },
        presetId: null, logoDataUrl: null, logoHidden: true, watermark: 'archive.com',
      }),
    )
    mockedGet.mockResolvedValue(configMapResponse({ watermark: 'settings.com' }))
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    const input = wrapper.find('input[aria-label="域名水印"]')
    expect((input.element as HTMLInputElement).value).toBe('archive.com')
    wrapper.unmount()
  })

  /** 可导出态公共桩:字体解析成功 + 填入标题 ⇒ canExport 为真,保存/下载按钮可用 */
  async function mountExportable() {
    // svgBuilder 需要的最小字体能力(测量与轮廓),空轮廓即可满足渲染
    vi.mocked(loadCoverFont).mockResolvedValue({
      getAdvanceWidth: (t: string, s: number) => t.length * s * 0.55,
      getPath: () => ({ commands: [] }),
    } as unknown as Awaited<ReturnType<typeof loadCoverFont>>)
    const wrapper = mount(CoverWorkbench, { attachTo: document.body })
    await flushPromises()
    // 出厂默认整块排版，标题填 titleFlow 字段（分缝字段此时不在面板上）
    const title = wrapper.find('input[aria-label="整块标题"]')
    await title.setValue('标题')
    // G1:预览渲染有 150ms 防抖;涉及「剪贴板内容 === 预览 SVG」逐字节比较的用例
    // 需等防抖合帧追平
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    return wrapper
  }

  it('保存到附件成功:展示含 permalink 的成功提示(可点击链接)', async () => {
    mockedPost.mockResolvedValue({ data: MEASURED_ATTACHMENT } as Awaited<ReturnType<typeof axiosInstance.post>>)
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const wrapper = await mountExportable()

    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存到附件')
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已保存到附件库')
    // 链接展示为绝对地址(相对 permalink 对 origin 解析),可见文本仍是相对路径
    expect(wrapper.find('.success a').attributes('href')).toBe(
      new URL('/upload/标题-cover.png', window.location.origin).href,
    )
    expect(wrapper.find('.success a').text()).toBe('/upload/标题-cover.png')
    expect(wrapper.find('.save-error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('保存到附件失败(M10):展示中文错误,本地「下载 SVG」仍可用', async () => {
    mockedPost.mockRejectedValue(
      axiosProblemDetail(404, 'Extension storage.halo.run/v1alpha1/Policy/nonexistent-policy was not found.'),
    )
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const wrapper = await mountExportable()

    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存到附件')
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('上传附件失败')
    expect(wrapper.text()).toContain('nonexistent-policy was not found')
    expect(wrapper.text()).not.toContain('已保存到附件库')
    // 成功行不得与失败并存(负向互斥用真实选择器断言;原 .save-error 为恒真断言,评审#5)
    expect(wrapper.find('.success a').exists()).toBe(false)

    // 回退路径:本地下传不受上传失败影响,点击仍触发下载
    const realCreateElement = document.createElement.bind(document)
    const click = vi.fn<() => void>()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('document', {
      createElement: (tag: string) =>
        tag === 'a'
          ? { href: '', download: '', click, remove: () => {} }
          : realCreateElement(tag),
      body: { appendChild: () => {} },
    })
    const svgBtn = wrapper.findAll('button').find((b) => b.text() === '下载 SVG')!
    expect(svgBtn.attributes('disabled')).toBeUndefined()
    await svgBtn.trigger('click')
    expect(click).toHaveBeenCalledOnce()
    vi.unstubAllGlobals() // 先还原全局再卸载,避免 unmount 踩到 document 桩
    wrapper.unmount()
  })

  /** 轮询等待:UI 侧异步链路(FileReader 等)经由多个宏任务,固定单拍等待不可靠 */
  async function until(cond: () => boolean, ms = 500) {
    const start = Date.now()
    while (!cond() && Date.now() - start < ms) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      await flushPromises()
    }
  }

  /**
   * 经 Halo 附件选择器导入 Logo。
   * 图片来源已收敛为 Halo 自带的那一个入口，插件自绘的上传字段不再存在；
   * FormKit 替身只保留「接住回填值」这一条契约，所以用 $emit('input', 值) 驱动。
   */
  function pickLogo(wrapper: ReturnType<typeof mount>, url: string) {
    const card = wrapper.findAll('section.card').find((s) => s.text().includes('Logo'))!
    card.findComponent({ name: 'FormKit' }).vm.$emit('input', url)
  }

  /** 经 PostPicker 选中第 index 篇检索结果(真实 300ms 防抖,轮询等待下拉出现) */
  async function pickFirstPost(
    wrapper: Awaited<ReturnType<typeof mountExportable>>,
    index = 0,
    keyword = 'Hello',
  ) {
    // 检索词须命中目标标题:searchPosts 按标题包含过滤(评审实机反馈)
    await wrapper.find('input[aria-label="搜索文章"]').setValue(keyword)
    await until(() => wrapper.findAll('.post-item').length > index)
    await wrapper.findAll('.post-item')[index].trigger('click')
  }

  it('默认 Logo 拉取失败但用户已导入自己的 Logo 时不强行隐藏(rider 对称性)', async () => {
    const DEFAULT_LOGO = 'https://cdn.example.com/logo.png'
    mockedGet.mockResolvedValue(configMapResponse({ logoUrl: DEFAULT_LOGO }))
    // 默认 Logo 的抓取挂在半空(等用户导入后再失败);用户自己那张则正常成功
    let rejectDefault!: (e: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        input === DEFAULT_LOGO
          ? new Promise<{ ok: boolean }>((_ok, rej) => { rejectDefault = rej })
          : Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['abc'], { type: 'image/png' }) })),
    )
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    // 用户经 Halo 附件选择器导入自己的 Logo(图片来源三处已收敛为这一个入口)
    pickLogo(wrapper, 'https://cdn.example.com/mine.png')
    await until(() => wrapper.text().includes('恢复默认'))
    expect(wrapper.text()).toContain('恢复默认') // 用户 Logo 已就位

    // 此刻默认 Logo 拉取才失败:不得强行隐藏用户的 Logo
    rejectDefault(new TypeError('network down'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await flushPromises()

    const texts = wrapper.findAll('button').map((b) => b.text())
    expect(texts).toContain('恢复默认')
    expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('true') // logoHidden 仍为 false
    wrapper.unmount()
  })

  it('绑定进行中点「仅保存」被互斥拦截:不并发第二次附件上传(评审#1)', async () => {
    routeGet()
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    let resolvePost!: (v: unknown) => void
    mockedPost.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePost = resolve }),
    )
    const wrapper = await mountExportable()
    await pickFirstPost(wrapper)

    // 绑定在途:上传请求挂起
    const bindBtn = wrapper.findAll('button').find((b) => b.text() === '保存并绑定')!
    await bindBtn.trigger('click')
    const only = wrapper.findAll('button').find((b) => b.text() === '仅保存')!
    expect(only.attributes('disabled')).toBeDefined()

    // 在途期间点「仅保存」:必须被拦截,不得产生第二次附件上传
    await only.trigger('click')
    resolvePost({ data: MEASURED_ATTACHMENT })
    await flushPromises()
    expect(mockedPost).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('保存并绑定(M11):未选文章时主按钮为「保存到附件」;选中后变绑定文案,触发上传+PUT 封面', async () => {
    routeGet()
    mockedPost.mockResolvedValue({ data: MEASURED_ATTACHMENT } as Awaited<ReturnType<typeof axiosInstance.post>>)
    mockedPut.mockResolvedValue({ data: MEASURED_POST } as Awaited<ReturnType<typeof axiosInstance.put>>)
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const wrapper = await mountExportable()

    // 未选文章:智能保存呈「保存到附件」,绑定动作不被提供(S2)
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存到附件')!
    expect(saveBtn).toBeTruthy()
    expect(wrapper.findAll('button').some((b) => b.text() === '仅保存')).toBe(false)

    await pickFirstPost(wrapper)
    expect(wrapper.text()).toContain('已选择:Hello halo') // 选中回显
    const bindBtn = wrapper.findAll('button').find((b) => b.text() === '保存并绑定')!
    expect(bindBtn).toBeTruthy()
    await bindBtn.trigger('click')
    await until(() => wrapper.text().includes('已绑定到'))

    // 上传与写封面按序发生;PUT 携带实测路径与刚上传的 permalink
    expect(mockedPost).toHaveBeenCalledTimes(1)
    expect(mockedPut).toHaveBeenCalledTimes(1)
    const [putUrl, putBody] = mockedPut.mock.calls[0]
    expect(putUrl).toBe('/apis/content.halo.run/v1alpha1/posts/5152aea5-c2e8-4717-8bba-2263d46e19d5')
    expect((putBody as { spec: { cover: string } }).spec.cover).toBe('/upload/标题-cover.png')
    expect((putBody as { metadata: { version: number } }).metadata.version).toBe(4)
    expect(wrapper.text()).toContain('已绑定到《Hello halo》')
    expect(wrapper.text()).toContain('已保存到附件库') // 附件上传的事实同时呈现
    wrapper.unmount()
  })

  it('绑定失败(重试后仍 409):附件已上传的事实保留,同时展示中文错误,本地下载不受影响', async () => {
    routeGet()
    mockedPost.mockResolvedValue({ data: MEASURED_ATTACHMENT } as Awaited<ReturnType<typeof axiosInstance.post>>)
    mockedPut.mockRejectedValue(
      axiosProblemDetail(409, 'Conflict detected, please check the data and retry.'),
    )
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const wrapper = await mountExportable()
    await pickFirstPost(wrapper)

    const bindBtn = wrapper.findAll('button').find((b) => b.text() === '保存并绑定')!
    await bindBtn.trigger('click')
    await until(() => wrapper.text().includes('绑定文章封面失败'))

    // 重试恰一次:get×3(读文章两次+列表一次之外另有挂载读取,按 PUT 次数断言)
    expect(mockedPost).toHaveBeenCalledTimes(1) // 附件已上传
    expect(mockedPut).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已保存到附件库') // 上传事实不因绑定失败而隐藏
    expect(wrapper.text()).toContain('绑定文章封面失败')
    expect(wrapper.text()).not.toContain('已绑定到')
    wrapper.unmount()
  })

  it('改选另一篇文章时清空上一轮绑定反馈(rider)', async () => {
    routeGet([MEASURED_LISTED_ITEM, SECOND_LISTED_ITEM])
    mockedPost.mockResolvedValue({ data: MEASURED_ATTACHMENT } as Awaited<ReturnType<typeof axiosInstance.post>>)
    mockedPut.mockResolvedValue({ data: MEASURED_POST } as Awaited<ReturnType<typeof axiosInstance.put>>)
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const wrapper = await mountExportable()

    // 绑定第一篇成功
    await pickFirstPost(wrapper, 0)
    const bindBtn = wrapper.findAll('button').find((b) => b.text() === '保存并绑定')!
    await bindBtn.trigger('click')
    await until(() => wrapper.text().includes('已绑定到'))
    expect(wrapper.text()).toContain('已绑定到《Hello halo》')

    // 改选第二篇:旧成功提示不得残留,主按钮切到新目标的绑定文案
    await pickFirstPost(wrapper, 0, 'Second')
    expect(wrapper.text()).not.toContain('已绑定到《Hello halo》')
    expect(wrapper.text()).toContain('已选择:Second post')
    expect(wrapper.findAll('button').some((b) => b.text() === '保存并绑定')).toBe(true)
    wrapper.unmount()
  })

  it('挂载时读取路由 query 并合并进状态(列表入口跳转带回输入)', async () => {
    // Console 的 Vue Router 会把 $route 装到 globalProperties;此处以同形桩模拟
    // (vue-router 由宿主提供不可导入类型,故对挂载选项整体断言收敛)
    const options = {
      attachTo: document.body,
      global: {
        config: {
          globalProperties: {
            $route: { query: { titleLeft: '来自', titleRight: '弹窗', presetId: 'sky' } },
          },
        },
      },
    }
    const wrapper = mount(CoverWorkbench, options as unknown as Parameters<typeof mount>[1])
    await flushPromises()

    expect((wrapper.find('input[aria-label="标题左段"]').element as HTMLInputElement).value).toBe('来自')
    expect((wrapper.find('input[aria-label="标题右段"]').element as HTMLInputElement).value).toBe('弹窗')
    // 预设 id 命中渐变:sky(晴空)成为当前样式,输出条摘要即显示它的名字
    // (渐变预设的色块已并入 GradientPicker,断言改为读用户看得到的摘要文字)
    expect(wrapper.text()).toContain('晴空')
    wrapper.unmount()
  })

  it('路由携带 postName/postTitle 时自动预选目标文章(列表入口跳转)', async () => {
    const options = {
      attachTo: document.body,
      global: {
        config: {
          globalProperties: {
            $route: { query: { postName: 'post-x', postTitle: '目标文章X' } },
          },
        },
      },
    }
    const wrapper = mount(CoverWorkbench, options as unknown as Parameters<typeof mount>[1])
    await flushPromises()

    expect(wrapper.text()).toContain('已选择:目标文章X')
    wrapper.unmount()
  })

  it('无路由 query(常规进入)时不改动状态', async () => {
    const options = {
      attachTo: document.body,
      global: { config: { globalProperties: { $route: { query: {} } } } },
    }
    const wrapper = mount(CoverWorkbench, options as unknown as Parameters<typeof mount>[1])
    await flushPromises()

    // 无 query ⇒ 不触发播种：标题仍是出厂整块文本，也没有切到分缝模式
    expect((wrapper.find('input[aria-label="整块标题"]').element as HTMLInputElement).value)
      .toBe('标题只有七个字')
    expect(wrapper.find('input[aria-label="标题左段"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('persistError 非空时渲染本地存档警示条,清空后消失', async () => {
    persistError.value = '本地存档保存失败(存储空间不足或隐私模式),刷新后更改将丢失'
    try {
      const wrapper = mount(CoverWorkbench, { attachTo: document.body })
      await flushPromises()

      const alert = wrapper.find('.persist-error')
      expect(alert.exists()).toBe(true)
      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toContain('刷新后更改将丢失')
      wrapper.unmount()

      persistError.value = ''
      const recovered = mount(CoverWorkbench, { attachTo: document.body })
      await flushPromises()
      expect(recovered.find('.persist-error').exists()).toBe(false)
      recovered.unmount()
    } finally {
      persistError.value = '' // 模块级信号,复位避免污染后续用例
    }
  })

  it('pluginSettingsDegraded 为 true 时渲染设置降级弱提示,复位后消失', async () => {
    try {
      const wrapper = mount(CoverWorkbench, { attachTo: document.body })
      await flushPromises() // 挂载读取成功会把信号复位为 false

      // 模拟会话中途(如保存时现读设置)读取失败置位
      pluginSettingsDegraded.value = true
      await nextTick()
      const notice = wrapper.find('.settings-degraded')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('已临时使用默认设置')
      wrapper.unmount()

      pluginSettingsDegraded.value = false
      const recovered = mount(CoverWorkbench, { attachTo: document.body })
      await flushPromises()
      expect(recovered.find('.settings-degraded').exists()).toBe(false)
      recovered.unmount()
    } finally {
      pluginSettingsDegraded.value = false // 模块级信号,复位避免污染后续用例
    }
  })

  /**
   * 预览交互(拖动改位置 / 滚轮改大小 / 智能参考线)。
   *
   * 手势落在预览层,但要断言的是工作台状态:「元素」面板里的回显值就是
   * state.layout / customElements 的直接投影,因此用它来读最终结果,
   * 而不是断言某个事件发出过、某个函数被调用过。
   */
  describe('预览交互', () => {
    /** 预览交互层矩形桩成画布尺寸:指针的 clientX/clientY 于是与画布像素一一对应 */
    function stubOverlay(wrapper: VueWrapper) {
      const canvas = defaultCoverState().canvas
      wrapper.find('.ov').element.getBoundingClientRect = () => ({
        left: 0, top: 0, width: canvas.width, height: canvas.height,
        right: canvas.width, bottom: canvas.height, x: 0, y: 0, toJSON: () => ({}),
      }) as DOMRect
      return canvas
    }

    /** 派发原生指针事件(VTU 的 trigger 无法注入 clientX:jsdom 里那是只读访问器) */
    function pointer(wrapper: VueWrapper, type: string, init: { clientX?: number; clientY?: number } = {}) {
      const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })
      wrapper.find('.ov').element.dispatchEvent(ev)
      return ev
    }

    /** 在某具体元素上派发(手柄这类子节点) */
    function pointerOn(el: Element, type: string, init: { clientX?: number; clientY?: number } = {}) {
      const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })
      el.dispatchEvent(ev)
      return ev
    }

    function wheel(wrapper: VueWrapper, deltaY: number) {
      const ev = new WheelEvent('wheel', { deltaY, cancelable: true, bubbles: true })
      wrapper.find('.ov').element.dispatchEvent(ev)
      return ev
    }

    function builtinRow(wrapper: VueWrapper, name: string) {
      return wrapper.findAll('button.el-row').find((b) => b.find('.el-kind').text() === name)!
    }

    /** 元素面板里某内置元素的回显:x% / y% / 大小% */
    function anchorsOf(wrapper: VueWrapper, name: string): number[] {
      const text = builtinRow(wrapper, name).find('.el-meta').text()
      return [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    }

    async function mountStage() {
      const wrapper = mount(CoverWorkbench, { attachTo: document.body })
      await flushPromises()
      return { wrapper, canvas: stubOverlay(wrapper) }
    }

    /**
     * 预置一条存档(以出厂状态铺底,只覆盖本用例关心的字段)。
     * 「元素」面板只在存在自定义元素时才渲染它的位置滑杆，命中测试也需要它在场。
     */
    function seedArchive(patch: Partial<CoverState>) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultCoverState(), ...patch }))
    }

    function customElementOf(kind: CustomKind): CustomElement {
      return {
        id: 'el-seed',
        kind,
        // svg 需要真实标记：面板与几何都要读它的 viewBox 才能算出「边长」
        content: kind === 'image'
          ? 'data:image/png;base64,AAAA'
          : kind === 'svg'
            ? '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'
            : '',
        text: kind === 'text' ? '自定义文字' : '',
        size: kind === 'text' ? 60 : 200,
        anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
        color: '#ffffff',
        bold: false,
        tracking: 0,
        curve: 0,
        direction: 'horizontal',
        aspect: 1,
      }
    }

    /** 含一个自定义元素的存档：image 便于命中测试，text 才会渲染「大小」滑杆 */
    function seedCustomElement(kind: CustomKind = 'image') {
      const base = defaultCoverState()
      seedArchive({
        customElements: [customElementOf(kind)],
        layers: [...base.layers, 'custom:el-seed'],
      })
    }

    /**
     * 画布取 1200×630(缩放系数为 1)并指定标题字号：
     * 于是标题在 SVG 里的 font-size 就等于 titleFontSize 本身，可以直接读。
     */
    function seedTitle(fontSize: number, patch: Partial<CoverState> = {}) {
      seedArchive({
        canvas: { width: 1200, height: 630 },
        canvasPresetId: 'og',
        titleFlow: '标题只有七个字',
        titleFontSize: fontSize,
        ...patch,
      })
    }

    /** 标题在预览 SVG 里的实际字号(渲染值,不是状态值) */
    function renderedTitleFontSize(wrapper: VueWrapper): number {
      const match = /<text[^>]*font-size="([\d.]+)"/.exec(previewSvg(wrapper))
      return Number(match?.[1])
    }

    /** 自定义元素的位置回显(详情区滑杆,面板与状态同源) */
    const customX = (wrapper: VueWrapper) =>
      (wrapper.find('input[aria-label="水平(数值)"]').element as HTMLInputElement).value

    /** 面板上自定义元素的大小回显：图片读「宽度」、SVG 读「边长」、文字读「大小(%)」 */
    const customSizeOf = (wrapper: VueWrapper, label: string) =>
      (wrapper.find(`input[aria-label="${label}(数值)"]`).element as HTMLInputElement).value

    /** 预览当前渲染的 SVG(防抖与否看它) */
    const previewSvg = (wrapper: VueWrapper) =>
      wrapper.findComponent(CoverPreview).props('svg') as string

    it('方向键微调仍然可用:选中后 Shift+方向键移动 10 步', async () => {
      const { wrapper } = await mountStage()
      await builtinRow(wrapper, '标题').trigger('click')
      expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100])

      await wrapper.find('.stage-col').trigger('keydown', { key: 'ArrowRight', shiftKey: true })

      expect(anchorsOf(wrapper, '标题')).toEqual([51, 50, 100])
      wrapper.unmount()
    })

    it('在预览上按住元素拖动:位置随指针改变,未选中时先选中再拖', async () => {
      const { wrapper, canvas } = await mountStage()

      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: canvas.height * 0.5 })
      await nextTick()
      // 按下即选中:面板里该行呈选中态
      expect(builtinRow(wrapper, '标题').attributes('aria-pressed')).toBe('true')
      pointer(wrapper, 'pointermove', { clientX: canvas.width * 0.7, clientY: canvas.height * 0.5 })
      await nextTick()

      expect(anchorsOf(wrapper, '标题')).toEqual([70, 50, 100])
      pointer(wrapper, 'pointerup')
      wrapper.unmount()
    })

    it('拖动坐标夹在 0–100%:拖出预览范围也不会跑出画布', async () => {
      const { wrapper, canvas } = await mountStage()

      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: canvas.height * 0.5 })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: canvas.width * 3, clientY: canvas.height * 3 })
      await nextTick()

      expect(anchorsOf(wrapper, '标题')).toEqual([100, 100, 100])
      pointer(wrapper, 'pointerup')
      wrapper.unmount()
    })

    it('选中元素后滚轮改变大小:上滚变大且落在整数百分比', async () => {
      const { wrapper } = await mountStage()
      // 用 Logo 验收「倍率」这条路：标题的大小走 titleFontSize，另有专门用例
      await builtinRow(wrapper, 'Logo').trigger('click')

      const ev = wheel(wrapper, -100)
      await nextTick()

      expect(anchorsOf(wrapper, 'Logo')).toEqual([50, 50, 102])
      expect(ev.defaultPrevented).toBe(true) // 阻止页面滚动
      wrapper.unmount()
    })

    it('没有选中元素时滚轮完全不介入:不改大小、也不阻止页面滚动', async () => {
      const { wrapper } = await mountStage()

      const ev = wheel(wrapper, -100)
      await nextTick()

      expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100])
      expect(ev.defaultPrevented).toBe(false)
      wrapper.unmount()
    })

    it('智能参考线:开启后吸附到画布中线并画出细线,松手后消失;关闭时不吸附', async () => {
      const { wrapper, canvas } = await mountStage()
      const centerY = canvas.height * 0.5

      // 关闭(出厂默认):原始位置原样写回 —— 50.55% 不会被吸到 50%
      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: centerY })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: canvas.width * 0.5055, clientY: centerY })
      await nextTick()
      expect(anchorsOf(wrapper, '标题')[0]).toBe(51) // round(50.55)
      expect(wrapper.findAll('.guide')).toHaveLength(0)
      pointer(wrapper, 'pointerup')
      await nextTick()

      // 打开「智能参考线」开关
      const toggle = wrapper.findAll('label').find((l) => l.text().includes('智能参考线'))!
      await toggle.find('input').setValue(true)

      // 再拖一次:起点即当前位置(50.55%)，已在 0.6% 阈值内 ⇒ 吸附到 50%
      const startX = canvas.width * 0.5055
      pointer(wrapper, 'pointerdown', { clientX: startX, clientY: centerY })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: startX - 2, clientY: centerY })
      await nextTick()

      expect(anchorsOf(wrapper, '标题')[0]).toBe(50)
      const xGuides = wrapper.findAll('.guide-x')
      expect(xGuides).toHaveLength(1) // 画布居中垂直线
      expect((xGuides[0].element as unknown as HTMLElement).style.left).toBe('50%')

      pointer(wrapper, 'pointerup')
      await nextTick()
      expect(wrapper.findAll('.guide')).toHaveLength(0) // 松手即消失
      expect(anchorsOf(wrapper, '标题')[0]).toBe(50) // 位置留在吸附结果上
      wrapper.unmount()
    })

    it('自定义元素拖动写回它自己的锚点(不在内置布局表里)', async () => {
      // 面板只在存在自定义元素时才渲染它的位置滑杆，故先预置一条含自定义元素的存档
      seedCustomElement()
      const { wrapper, canvas } = await mountStage()

      // 自定义元素叠在中心且图层最上 ⇒ 按下命中的是它
      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: canvas.height * 0.5 })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: canvas.width * 0.6, clientY: canvas.height * 0.5 })
      await nextTick()
      pointer(wrapper, 'pointerup')

      expect(customX(wrapper)).toBe('60')
      wrapper.unmount()
    })

    it('自定义元素的方向键微调同样生效:写回 customElements 而不是内置 layout', async () => {
      seedCustomElement()
      const { wrapper } = await mountStage()
      // 从面板选中自定义元素（与画布命中无关）
      await wrapper.find('button.el-name').trigger('click')
      expect(customX(wrapper)).toBe('50')

      await wrapper.find('.stage-col').trigger('keydown', { key: 'ArrowRight', shiftKey: true })

      expect(customX(wrapper)).toBe('51')
      // 内置元素一动不动：写回的是自定义元素自己的锚点
      expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100])
      wrapper.unmount()
    })

    it('拖动期间预览立即跟手(不等 150ms 合帧),松手后防抖恢复', async () => {
      const { wrapper, canvas } = await mountStage()
      const before = previewSvg(wrapper)

      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: canvas.height * 0.5 })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: canvas.width * 0.7, clientY: canvas.height * 0.5 })
      await nextTick()

      // 拖动中:预览已经落在新位置上，而不是等 G1 的 150ms 合帧
      expect(previewSvg(wrapper)).not.toBe(before)

      pointer(wrapper, 'pointerup')
      await nextTick()
      const settled = previewSvg(wrapper)

      // 松手后恢复防抖:打字在合帧窗口内不重渲染,窗口过去才追平
      await wrapper.find('input[aria-label="整块标题"]').setValue('拖动之后')
      await nextTick()
      expect(previewSvg(wrapper)).toBe(settled)

      await new Promise<void>((resolve) => setTimeout(resolve, 250))
      expect(previewSvg(wrapper)).not.toBe(settled)
      wrapper.unmount()
    }, 5000)

    it('滚轮改大小时预览同样立即跟手', async () => {
      const { wrapper } = await mountStage()
      // 用副标题验收：它的字号直接按倍率缩放，改倍率必然改变图元
      //（标题的倍率只影响可用宽度预算，短标题下改 2% 看不出差别，另有用例断言状态）
      await wrapper.find('input[aria-label="副标题"]').setValue('副标题')
      await new Promise<void>((resolve) => setTimeout(resolve, 250)) // 等打字那一帧合完
      await builtinRow(wrapper, '副标题').trigger('click')
      const before = previewSvg(wrapper)

      wheel(wrapper, -100)
      await nextTick()

      expect(anchorsOf(wrapper, '副标题')[2]).toBe(52) // 出厂 50% → 52%
      expect(previewSvg(wrapper)).not.toBe(before)
      wrapper.unmount()
    }, 5000)

    it('滚轮在标题上改的是字号:图元真的变大/变小,倍率仍归位为 1', async () => {
      seedTitle(105)
      const { wrapper } = await mountStage()
      await builtinRow(wrapper, '标题').trigger('click')
      expect(renderedTitleFontSize(wrapper)).toBe(105)

      wheel(wrapper, -100) // 上滚一格 ⇒ +2%
      await nextTick()
      expect(renderedTitleFontSize(wrapper)).toBe(107) // round(105 × 1.02)
      // 大小由 titleFontSize 独家承担：锚点倍率保持 1，否则会与字号双重放大
      expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100])

      wheel(wrapper, 100) // 下滚一格 ⇒ −2%
      await nextTick()
      expect(renderedTitleFontSize(wrapper)).toBe(105) // 以当前字号为基准，不会「回不去」
      expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100])
      wrapper.unmount()
    })

    it('滚轮在标题上夹在 64–210:顶到上限不再变化,也不会越界', async () => {
      seedTitle(208)
      const atMax = await mountStage()
      await builtinRow(atMax.wrapper, '标题').trigger('click')

      wheel(atMax.wrapper, -100) // 208 × 1.02 = 212.16 ⇒ 夹到 210
      await nextTick()
      expect(renderedTitleFontSize(atMax.wrapper)).toBe(210)

      wheel(atMax.wrapper, -100) // 已在 210：不再写回，仍是 210
      await nextTick()
      expect(renderedTitleFontSize(atMax.wrapper)).toBe(210)
      atMax.wrapper.unmount()

      seedTitle(64)
      const atMin = await mountStage()
      await builtinRow(atMin.wrapper, '标题').trigger('click')

      wheel(atMin.wrapper, 100) // 64 × 0.98 = 62.72 ⇒ 夹到 64
      await nextTick()
      expect(renderedTitleFontSize(atMin.wrapper)).toBe(64)
      atMin.wrapper.unmount()
    })

    it('滚轮在副标题/水印/自定义元素上仍写各自的锚点倍率(不受标题折算影响)', async () => {
      const base = defaultCoverState()
      // 自定义元素取 text 类型：只有它才渲染「大小」滑杆，倍率才有可见回显
      seedTitle(105, {
        customElements: [customElementOf('text')],
        layers: [...base.layers, 'custom:el-seed'],
      })
      const { wrapper } = await mountStage()

      // 副标题：出厂 50% → 52%
      await builtinRow(wrapper, '副标题').trigger('click')
      wheel(wrapper, -100)
      await nextTick()
      expect(anchorsOf(wrapper, '副标题')).toEqual([50, 80, 52])

      // 水印：出厂 100% → 102%
      await builtinRow(wrapper, '水印').trigger('click')
      wheel(wrapper, -100)
      await nextTick()
      expect(anchorsOf(wrapper, '水印')).toEqual([95, 95, 102])

      // 自定义元素：同样写自己的 anchor.scale
      await wrapper.find('button.el-name').trigger('click')
      wheel(wrapper, -100)
      await nextTick()
      const sizeInput = wrapper.find('input[aria-label="大小(数值)"]')
      expect((sizeInput.element as HTMLInputElement).value).toBe('102')

      // 标题字号不受这些滚动影响
      expect(renderedTitleFontSize(wrapper)).toBe(105)
      wrapper.unmount()
    })

    it('点空白取消选中:选中框与手柄消失,面板回到未选中态', async () => {
      const { wrapper, canvas } = await mountStage()
      await builtinRow(wrapper, '标题').trigger('click')
      expect(builtinRow(wrapper, '标题').attributes('aria-pressed')).toBe('true')
      expect(wrapper.find('.handle-rotate').exists()).toBe(true)

      // 右下角是空白(标题图元之外)
      pointer(wrapper, 'pointerdown', { clientX: 60, clientY: canvas.height - 20 })
      await nextTick()

      expect(builtinRow(wrapper, '标题').attributes('aria-pressed')).toBe('false')
      expect(wrapper.find('.ring').exists()).toBe(false)
      expect(wrapper.find('.handle-rotate').exists()).toBe(false)
      wrapper.unmount()
    })

    it('点中元素不取消选中(与点空白相反)', async () => {
      const { wrapper, canvas } = await mountStage()
      await builtinRow(wrapper, '标题').trigger('click')

      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: canvas.height * 0.5 })
      await nextTick()

      expect(builtinRow(wrapper, '标题').attributes('aria-pressed')).toBe('true')
      // 没有别的选中目标被点出来(仍停在标题上)
      expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100])
      wrapper.unmount()
    })

    it('参考线阈值上调后更容易吸附:偏离 1% 也会吸到画布中线', async () => {
      const { wrapper, canvas } = await mountStage()
      const toggle = wrapper.findAll('label').find((l) => l.text().includes('智能参考线'))!
      await toggle.find('input').setValue(true)
      await builtinRow(wrapper, '标题').trigger('click')

      // 原始位置 51%(与 50% 差 1%：旧阈值 0.6% 吸不住，新阈值 1.2% 能吸上)
      pointer(wrapper, 'pointerdown', { clientX: canvas.width * 0.5, clientY: canvas.height * 0.5 })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: canvas.width * 0.51, clientY: canvas.height * 0.7 })
      await nextTick()

      expect(anchorsOf(wrapper, '标题')[0]).toBe(50)
      expect(wrapper.findAll('.guide-x')).toHaveLength(1)
      pointer(wrapper, 'pointerup')
      wrapper.unmount()
    })

    it('拖旋转手柄:元素即刻旋转,面板角度随之更新(拖动期间不走防抖)', async () => {
      const { wrapper, canvas } = await mountStage()
      await builtinRow(wrapper, '标题').trigger('click')
      const before = previewSvg(wrapper)
      // 标题锚点在画布正中：旋转以它为圆心
      const cx = canvas.width * 0.5
      const cy = canvas.height * 0.5

      pointerOn(wrapper.find('.handle-rotate').element, 'pointerdown', {
        clientX: cx + 100, clientY: cy,
      })
      await nextTick()
      pointer(wrapper, 'pointermove', { clientX: cx, clientY: cy + 100 }) // 转到正下方 ⇒ 90°
      await nextTick()

      // 立即渲染：预览已经带上旋转，而不是等 150ms 合帧
      expect(previewSvg(wrapper)).not.toBe(before)
      expect(previewSvg(wrapper)).toContain('rotate(90')
      const rotationInput = wrapper.find('input[aria-label="旋转(数值)"]')
      expect((rotationInput.element as HTMLInputElement).value).toBe('90')
      pointer(wrapper, 'pointerup')
      wrapper.unmount()
    })

    describe('选中框上的 ×', () => {
      it('标题不显示 ×(标题不可删除),点空白是退出标题编辑的主路径', async () => {
        const { wrapper, canvas } = await mountStage()
        await builtinRow(wrapper, '标题').trigger('click')
        expect(wrapper.find('.handle-rotate').exists()).toBe(true)
        expect(wrapper.find('.handle-delete').exists()).toBe(false)

        pointer(wrapper, 'pointerdown', { clientX: 60, clientY: canvas.height - 20 })
        await nextTick()
        expect(builtinRow(wrapper, '标题').attributes('aria-pressed')).toBe('false')
        wrapper.unmount()
      })

      it('Logo:只关闭显示,用户已选的图仍在', async () => {
        const base = defaultCoverState()
        seedArchive({ logoDataUrl: 'data:image/png;base64,AAAA', logoHidden: false, layers: base.layers })
        const { wrapper } = await mountStage()
        await builtinRow(wrapper, 'Logo').trigger('click')
        await wrapper.find('.handle-delete').trigger('click')
        await nextTick()

        expect(wrapper.find('button[role="switch"]').attributes('aria-checked')).toBe('false')
        expect(wrapper.findAll('button').map((b) => b.text())).toContain('恢复默认')
        wrapper.unmount()
      })

      it('副标题:清空输入框', async () => {
        seedArchive({ subtitle: '副标题' })
        const { wrapper } = await mountStage()
        await builtinRow(wrapper, '副标题').trigger('click')
        await wrapper.find('.handle-delete').trigger('click')
        await nextTick()

        expect((wrapper.find('input[aria-label="副标题"]').element as HTMLInputElement).value).toBe('')
        wrapper.unmount()
      })

      it('水印:清空输入框', async () => {
        seedArchive({ watermark: 'example.com' })
        const { wrapper } = await mountStage()
        await builtinRow(wrapper, '水印').trigger('click')
        await wrapper.find('.handle-delete').trigger('click')
        await nextTick()

        expect((wrapper.find('input[aria-label="域名水印"]').element as HTMLInputElement).value).toBe('')
        wrapper.unmount()
      })

      it('自定义元素:真删除、图层同步移除、选中态清空', async () => {
        seedCustomElement('text')
        const { wrapper } = await mountStage()
        await wrapper.find('button.el-name').trigger('click')
        expect(wrapper.findAll('.el-row.custom')).toHaveLength(1)

        await wrapper.find('.handle-delete').trigger('click')
        await nextTick()

        expect(wrapper.findAll('.el-row.custom')).toHaveLength(0) // 元素没了
        expect(wrapper.find('.ring').exists()).toBe(false) // 选中态清空
        expect(wrapper.find('input[aria-label="水平(数值)"]').exists()).toBe(false) // 详情滑杆一起收起
        wrapper.unmount()
      })

      it('旋转对所有元素通用:自定义元素同样写回自己的 anchor.rotation', async () => {
        seedCustomElement('text')
        const { wrapper, canvas } = await mountStage()
        await wrapper.find('button.el-name').trigger('click')

        // 自定义元素出厂锚点在画布正中，旋转以它为圆心
        const cx = canvas.width * 0.5
        const cy = canvas.height * 0.5
        pointerOn(wrapper.find('.handle-rotate').element, 'pointerdown', {
          clientX: cx + 100, clientY: cy,
        })
        await nextTick()
        pointer(wrapper, 'pointermove', { clientX: cx, clientY: cy + 100 })
        await nextTick()

        const rotationInput = wrapper.find('input[aria-label="旋转(数值)"]')
        expect((rotationInput.element as HTMLInputElement).value).toBe('90')
        pointer(wrapper, 'pointerup')
        wrapper.unmount()
      })
    })

    /** 滚轮/拉大之后：面板回显与预览必须同时变（同一个量） */
    describe('自定义图片/SVG 的大小 owner', () => {
      for (const [kind, label] of [['svg', '边长'], ['image', '宽度']] as const) {
        it(`滚轮改 ${kind} 大小:面板「${label}」与预览同步变化`, async () => {
          seedCustomElement(kind)
          const { wrapper } = await mountStage()
          await wrapper.find('button.el-name').trigger('click')
          expect(customSizeOf(wrapper, label)).toBe('200')
          const before = previewSvg(wrapper)

          wheel(wrapper, -100)
          await nextTick()

          // 面板显示值就是被写回的那个量（+2%），不再出现「画面变了、面板没变」
          expect(customSizeOf(wrapper, label)).toBe('204')
          expect(previewSvg(wrapper)).not.toBe(before)
          // 倍率归位 1：面板的 px 与画面尺寸从此是同一个数
          expect(wrapper.find('input[aria-label="水平(数值)"]').exists()).toBe(true)
          wrapper.unmount()
        })

        it(`拉大手柄对 ${kind} 生效:往外拖变大、往回收变小(面板「${label}」跟着动)`, async () => {
          seedCustomElement(kind)
          const { wrapper, canvas } = await mountStage()
          await wrapper.find('button.el-name').trigger('click')
          // 距离一律相对元素锚点(自定义元素出厂在画布正中)量，比值才是干净整数
          const ax = canvas.width * 0.5
          const ay = canvas.height * 0.5

          pointerOn(wrapper.find('.handle-scale').element, 'pointerdown', {
            clientX: ax + 100, clientY: ay,
          })
          await nextTick()
          pointer(wrapper, 'pointermove', { clientX: ax + 200, clientY: ay }) // 2×
          await nextTick()
          expect(customSizeOf(wrapper, label)).toBe('400') // 200 × 2

          pointer(wrapper, 'pointermove', { clientX: ax + 100, clientY: ay }) // 回到起点距离 ⇒ 原大小
          await nextTick()
          expect(customSizeOf(wrapper, label)).toBe('200')
          pointer(wrapper, 'pointerup')
          wrapper.unmount()
        })
      }

      it('自定义文字仍走「大小(%)」:它的 owner 就是 anchor.scale', async () => {
        const base = defaultCoverState()
        seedTitle(105, {
          customElements: [customElementOf('text')],
          layers: [...base.layers, 'custom:el-seed'],
        })
        const { wrapper } = await mountStage()
        await wrapper.find('button.el-name').trigger('click')

        wheel(wrapper, -100)
        await nextTick()

        expect(customSizeOf(wrapper, '大小')).toBe('102') // 100% → 102%
        expect(wrapper.find('input[aria-label="边长(数值)"]').exists()).toBe(false)
        wrapper.unmount()
      })

      it('拉大手柄对内置元素同样生效:标题按倍率折算成字号', async () => {
        seedTitle(105)
        const { wrapper, canvas } = await mountStage()
        await builtinRow(wrapper, '标题').trigger('click')
        const cx = canvas.width * 0.5
        const cy = canvas.height * 0.5

        pointerOn(wrapper.find('.handle-scale').element, 'pointerdown', {
          clientX: cx + 100, clientY: cy,
        })
        await nextTick()
        pointer(wrapper, 'pointermove', { clientX: cx + 200, clientY: cy }) // 2×
        await nextTick()

        expect(renderedTitleFontSize(wrapper)).toBe(210) // 105 × 2，夹在字号上限
        expect(anchorsOf(wrapper, '标题')).toEqual([50, 50, 100]) // 倍率仍归位 1
        pointer(wrapper, 'pointerup')
        wrapper.unmount()
      })

      it('拉大手柄受元素各自的倍率上限约束', async () => {
        seedArchive({ subtitle: '副标题' })
        const { wrapper, canvas } = await mountStage()
        await builtinRow(wrapper, '副标题').trigger('click')
        // 副标题锚点在 80% 高度：距离要相对它量，比值才是整数
        const ax = canvas.width * 0.5
        const ay = canvas.height * 0.8

        pointerOn(wrapper.find('.handle-scale').element, 'pointerdown', {
          clientX: ax + 100, clientY: ay,
        })
        await nextTick()
        pointer(wrapper, 'pointermove', { clientX: ax + 400, clientY: ay }) // 4× ⇒ 超上限
        await nextTick()

        expect(anchorsOf(wrapper, '副标题')[2]).toBe(100) // 副标题上限 100%
        pointer(wrapper, 'pointerup')
        wrapper.unmount()
      })

      it('一次拖到底:24px 的小图直接到 600px,600px 也能一次回到 24px', async () => {
        // 手柄不再限幅比值，边界由写回路径按 owner 夹取（图片/SVG 是 24–600px）
        seedTitle(105, {
          customElements: [{ ...customElementOf('image'), size: 24 }],
          layers: [...defaultCoverState().layers, 'custom:el-seed'],
        })
        const { wrapper, canvas } = await mountStage()
        await wrapper.find('button.el-name').trigger('click')
        const ax = canvas.width * 0.5
        const ay = canvas.height * 0.5
        expect(customSizeOf(wrapper, '宽度')).toBe('24')

        pointerOn(wrapper.find('.handle-scale').element, 'pointerdown', {
          clientX: ax + 40, clientY: ay,
        })
        await nextTick()
        pointer(wrapper, 'pointermove', { clientX: ax + 1000, clientY: ay }) // 25× ⇒ 一次性到顶
        await nextTick()
        expect(customSizeOf(wrapper, '宽度')).toBe('600')
        pointer(wrapper, 'pointerup')
        await nextTick()

        // 再从 600px 往回拖一次：一步到底，不在半路被夹住
        pointerOn(wrapper.find('.handle-scale').element, 'pointerdown', {
          clientX: ax + 1000, clientY: ay,
        })
        await nextTick()
        pointer(wrapper, 'pointermove', { clientX: ax + 40, clientY: ay }) // 1/25
        await nextTick()
        expect(customSizeOf(wrapper, '宽度')).toBe('24')
        pointer(wrapper, 'pointerup')
        wrapper.unmount()
      })

      it('倍率 owner 的上限不变:Logo 一次拖到底停在 300%', async () => {
        // Logo 要有图才有命中框，也就才有选中框与手柄
        seedArchive({ logoDataUrl: 'data:image/png;base64,AAAA' })
        const { wrapper, canvas } = await mountStage()
        await builtinRow(wrapper, 'Logo').trigger('click')
        const ax = canvas.width * 0.5
        const ay = canvas.height * 0.5

        pointerOn(wrapper.find('.handle-scale').element, 'pointerdown', {
          clientX: ax + 40, clientY: ay,
        })
        await nextTick()
        pointer(wrapper, 'pointermove', { clientX: ax + 1000, clientY: ay }) // 25× ⇒ 写回时夹到 300%
        await nextTick()

        expect(anchorsOf(wrapper, 'Logo')).toEqual([50, 50, 300])
        pointer(wrapper, 'pointerup')
        wrapper.unmount()
      })
    })
  })
})
