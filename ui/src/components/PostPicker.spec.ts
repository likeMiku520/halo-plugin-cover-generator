import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { axiosInstance } from '@halo-dev/api-client'
import PostPicker from './PostPicker.vue'
import type { PostSummary } from '../api/haloClient'

// 与 haloClient.spec.ts 同一访问方式:mock Console HTTP 客户端(axiosInstance 边界),
// 响应体复刻 2026-09-06 真实 haloServer 的实测形状
vi.mock('@halo-dev/api-client', () => ({
  axiosInstance: {
    get: vi.fn<(url: string) => Promise<unknown>>(),
    post: vi.fn<(url: string, data: unknown) => Promise<unknown>>(),
    put: vi.fn<(url: string, data: unknown) => Promise<unknown>>(),
  },
}))
const mockedGet = vi.mocked(axiosInstance.get)

/** spike 实测的 ListedPostList:items[].post 内嵌完整 Post,此处取形状聚合的最小表示 */
function measuredList(name: string, title: string) {
  return {
    categories: [],
    contributors: [{ displayName: 'Administrator', name: 'admin' }],
    owner: { displayName: 'Administrator', name: 'admin' },
    post: {
      apiVersion: 'content.halo.run/v1alpha1',
      kind: 'Post',
      metadata: { name, version: 4 },
      spec: { title, cover: '' },
    },
    stats: { visit: 0, upvote: 0, totalComment: 0, approvedComment: 0 },
    tags: [],
  }
}

function listedResponse(...items: ReturnType<typeof measuredList>[]) {
  return {
    data: { page: 1, size: 10, total: items.length, items, first: true, last: true, hasNext: false, hasPrevious: false, totalPages: 1 },
  } as unknown as Awaited<ReturnType<typeof axiosInstance.get>>
}

/** 受控 deferred:让某次检索请求挂起,由测试手动决定何时/以何序落地 */
function deferredResponse() {
  let resolve!: (v: Awaited<ReturnType<typeof axiosInstance.get>>) => void
  const promise = new Promise<Awaited<ReturnType<typeof axiosInstance.get>>>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** spike 实测失败响应:RFC-7807 ProblemDetail */
function axiosError(status: number, body: unknown) {
  const e = new Error(`Request failed with status code ${status}`) as Error & {
    response?: { status: number; data: unknown }
  }
  e.response = { status, data: body }
  return e
}

async function typeInput(wrapper: ReturnType<typeof mount>, text: string) {
  await wrapper.find('input[aria-label="搜索文章"]').setValue(text)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  mockedGet.mockReset()
})

describe('PostPicker', () => {
  it('渲染搜索输入框,初始无下拉与选中提示', () => {
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    expect(wrapper.find('input[aria-label="搜索文章"]').exists()).toBe(true)
    expect(wrapper.find('.post-list').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('已选择')
    wrapper.unmount()
  })

  it('输入后防抖 300ms 才发起检索(实测 keyword/size 查询参数)', async () => {
    mockedGet.mockResolvedValue(listedResponse())
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, 'Hello')
    await flushPromises()
    expect(mockedGet).not.toHaveBeenCalled() // 防抖窗口内不发请求

    await vi.advanceTimersByTimeAsync(300)
    expect(mockedGet).toHaveBeenCalledOnce()
    const [url, config] = mockedGet.mock.calls[0]
    expect(url).toBe('/apis/api.console.halo.run/v1alpha1/posts')
    expect(config).toEqual({ params: { keyword: 'Hello', size: 10 } })
    wrapper.unmount()
  })

  it('防抖窗口内连续输入只检索一次,且用最新关键字', async () => {
    mockedGet.mockResolvedValue(listedResponse())
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, 'Hel')
    await vi.advanceTimersByTimeAsync(100)
    await typeInput(wrapper, 'Hello Halo')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockedGet).toHaveBeenCalledOnce()
    expect(mockedGet.mock.calls[0][1]).toEqual({ params: { keyword: 'Hello Halo', size: 10 } })
    wrapper.unmount()
  })

  it('下拉按标题列出检索结果', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章'), measuredList('p-b', '第二篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '文章')
    await vi.advanceTimersByTimeAsync(300)

    const titles = wrapper.findAll('.post-item').map((b) => b.text())
    expect(titles).toEqual(['第一篇文章', '第二篇文章'])
    wrapper.unmount()
  })

  it('点击结果选中:v-model 抛出 {name,title},输入框回显标题,下拉收起(已选择提示移至动作条反馈区,评审实机回归)', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)

    await wrapper.findAll('.post-item')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'p-a', title: '第一篇文章' }])

    // 回显:挂载选中值后输入框一致,下拉收起
    await wrapper.setProps({ modelValue: { name: 'p-a', title: '第一篇文章' } as PostSummary })
    expect((wrapper.find('input[aria-label="搜索文章"]').element as HTMLInputElement).value).toBe('第一篇文章')
    expect(wrapper.find('.post-list').exists()).toBe(false)
    wrapper.unmount()
  })

  it('已选中后继续输入视为改选:先清空 v-model 再重新防抖检索', async () => {
    mockedGet.mockResolvedValue(listedResponse())
    const wrapper = mount(PostPicker, { props: { modelValue: { name: 'p-a', title: '第一篇文章' } } })
    await typeInput(wrapper, '新一')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    await vi.advanceTimersByTimeAsync(300)
    expect(mockedGet.mock.calls[0][1]).toEqual({ params: { keyword: '新一', size: 10 } })
    wrapper.unmount()
  })

  it('检索失败时在下拉浮层内展示中文错误,不向下撑高动作列(评审实机回归:瞬态信息不得进入布局流)', async () => {
    mockedGet.mockRejectedValue(
      axiosError(403, { detail: 'You have no permission.', status: 403, title: 'Forbidden' }),
    )
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '文章')
    await vi.advanceTimersByTimeAsync(300)

    const list = wrapper.find('.post-list')
    expect(list.exists()).toBe(true)
    expect(list.text()).toContain('搜索文章失败')
    expect(list.text()).toContain('You have no permission.')
    wrapper.unmount()
  })

  it('检索成功但零结果时显示空态提示,而非无声无息(C1)', async () => {
    mockedGet.mockResolvedValue(listedResponse())
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '不存在的标题')
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.find('.post-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('未找到相关文章')
    expect(wrapper.findAll('.post-item')).toHaveLength(0)
    wrapper.unmount()
  })

  it('清空输入后不再检索并收起下拉', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('.post-list').exists()).toBe(true)

    await typeInput(wrapper, '')
    await vi.advanceTimersByTimeAsync(300)
    expect(mockedGet).toHaveBeenCalledTimes(1) // 清空不触发检索
    expect(wrapper.find('.post-list').exists()).toBe(false)
    wrapper.unmount()
  })

  it('过期响应不覆盖新结果:先发慢请求后发快请求,慢的后到也不落地(乱序防护)', async () => {
    const slow = deferredResponse()
    mockedGet.mockImplementationOnce(() => slow.promise) // 第一次检索(第一)挂起
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-new', '第二篇新结果')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })

    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300) // 慢请求在途
    await typeInput(wrapper, '第二')
    await vi.advanceTimersByTimeAsync(300) // 新检索已完成
    expect(wrapper.findAll('.post-item').map((b) => b.text())).toEqual(['第二篇新结果'])

    slow.resolve(listedResponse(measuredList('p-old', '过期关键字结果')))
    await flushPromises()
    // 慢响应此刻才到:不得用过期关键字的结果覆盖当前展示
    expect(wrapper.findAll('.post-item').map((b) => b.text())).toEqual(['第二篇新结果'])
    wrapper.unmount()
  })

  it('清空输入后在途响应不回弹:请求落地于清空之后也不得重开下拉', async () => {
    const slow = deferredResponse()
    mockedGet.mockImplementationOnce(() => slow.promise)
    const wrapper = mount(PostPicker, { props: { modelValue: null } })

    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300) // 请求在途
    await typeInput(wrapper, '') // 清空:收起下拉
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('.post-list').exists()).toBe(false)

    slow.resolve(listedResponse(measuredList('p-a', '第一篇文章')))
    await flushPromises()
    // 在途响应落地于清空之后:不得重新打开下拉或渲染任何结果
    expect(wrapper.find('.post-list').exists()).toBe(false)
    expect(wrapper.findAll('.post-item')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('PostPicker 浮层关闭行为与键盘导航(B3)', () => {
  it('输入框带 combobox 语义:aria-expanded 随下拉开合', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    const input = wrapper.find('input[aria-label="搜索文章"]')
    expect(input.attributes('aria-expanded')).toBe('false')

    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)
    expect(input.attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('Esc 关闭下拉(经 document 监听,须挂载到文档树)', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null }, attachTo: document.body })
    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('.post-list').exists()).toBe(true)

    await wrapper.find('input[aria-label="搜索文章"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.post-list').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点击组件外部(pointerdown)关闭下拉', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('.post-list').exists()).toBe(true)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.post-list').exists()).toBe(false)
    wrapper.unmount()
  })

  it('方向键移动活动项并经 aria-activedescendant 暴露;Enter 选中活动项', async () => {
    mockedGet.mockResolvedValue(
      listedResponse(measuredList('p-a', '第一篇文章'), measuredList('p-b', '第二篇文章')),
    )
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '文章')
    await vi.advanceTimersByTimeAsync(300)

    const input = wrapper.find('input[aria-label="搜索文章"]')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe('cover-post-opt-0')
    expect(wrapper.findAll('.post-item')[0].classes()).toContain('is-active')

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe('cover-post-opt-1')

    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'p-b', title: '第二篇文章' }])
    expect(wrapper.find('.post-list').exists()).toBe(false) // 选中即收起
    wrapper.unmount()
  })

  it('Enter 无活动项时立即检索(不等防抖)', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '第一')
    await flushPromises()
    expect(mockedGet).not.toHaveBeenCalled() // 防抖窗口内

    await wrapper.find('input[aria-label="搜索文章"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(mockedGet).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('点击条目引起的瞬时失焦(relatedTarget 为空)不收下拉,选中照常落地(实机回归守卫)', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null } })
    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)

    // 真实浏览器点击不可聚焦条目时,输入框失焦且 relatedTarget 为 null;
    // 此时不得同步收起下拉,否则条目在 click 派发前被移除、选中静默丢失
    await wrapper.find('input[aria-label="搜索文章"]').trigger('focusout')
    expect(wrapper.find('.post-list').exists()).toBe(true)

    await wrapper.findAll('.post-item')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'p-a', title: '第一篇文章' }])
    expect(wrapper.find('.post-list').exists()).toBe(false) // 选中后正常收起
    wrapper.unmount()
  })

  it('焦点 Tab 到外部可聚焦元素时收起下拉(relatedTarget 在组件外)', async () => {
    mockedGet.mockResolvedValue(listedResponse(measuredList('p-a', '第一篇文章')))
    const wrapper = mount(PostPicker, { props: { modelValue: null }, attachTo: document.body })
    await typeInput(wrapper, '第一')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('.post-list').exists()).toBe(true)

    const other = document.createElement('button')
    document.body.appendChild(other)
    await wrapper.find('input[aria-label="搜索文章"]').trigger('focusout', { relatedTarget: other })
    expect(wrapper.find('.post-list').exists()).toBe(false)

    other.remove()
    wrapper.unmount()
  })
})
