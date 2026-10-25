import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { axiosInstance } from '@halo-dev/api-client'
import CoverWorkbench from './CoverWorkbench.vue'
import CoverPreview from './CoverPreview.vue'
import { BUILTIN_FONT_URL } from '../lib/fontLoader'
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

  it('C2: 选高清(2x)后画布 2400×1260,默认标准 1200×630,附件上传仍为 1x', async () => {
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
      // 默认 PNG:1x ⇒ 1200×630
      await pngBtn().trigger('click')
      await flushPromises()
      expect(canvases[0]?.width).toBe(1200)
      expect(canvases[0]?.height).toBe(630)
      vi.advanceTimersByTime(2500)
      await nextTick() // 反馈复原,按钮文案恢复可按原文案检索

      // 切到高清 2x(S3 split 菜单):倍率沿下载链路传播 ⇒ 2400×1260
      await wrapper.find('button[aria-label="选择 PNG 导出尺寸"]').trigger('click')
      await wrapper.findAll('.menu-item').find((i) => i.text().includes('高清'))!.trigger('click')
      expect(pngBtn().text()).toBe('下载 PNG 2×') // 选中档位在主按钮上明示
      await pngBtn().trigger('click')
      await flushPromises()
      expect(canvases[1]?.width).toBe(2400) // 1200 × 2
      expect(canvases[1]?.height).toBe(1260) // 630 × 2
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
        expect.objectContaining({ width: 1200, height: 630 }),
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
    mockedGet.mockResolvedValue(configMapResponse({ logoUrl: 'https://cdn.example.com/logo.png' }))
    // 受控 deferred:让默认 Logo 拉取挂在用户导入之后才失败
    let rejectFetch!: (e: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<{ ok: boolean }>((_ok, rej) => {
            rejectFetch = rej
          }),
      ),
    )
    const wrapper = mount(CoverWorkbench)
    await flushPromises()

    // 用户经「本地上传」导入自己的 Logo(jsdom FileReader 异步派发 load)
    const fileInput = wrapper.find('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [new File(['img'], 'mine.png', { type: 'image/png' })],
    })
    await fileInput.trigger('change')
    await until(() => wrapper.text().includes('恢复默认'))
    expect(wrapper.text()).toContain('恢复默认') // 用户 Logo 已就位

    // 此刻默认 Logo 拉取才失败:不得强行隐藏用户的 Logo
    rejectFetch(new TypeError('network down'))
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
    // 预设 id 命中渐变:sky(晴空)成为当前选中预设
    expect(wrapper.find('.swatch.active').attributes('aria-label')).toBe('晴空')
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
})
