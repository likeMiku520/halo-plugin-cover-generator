import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AttachmentPicker from './AttachmentPicker.vue'
import { listImageAttachments, type AttachmentPage, type AttachmentSummary } from '../api/haloClient'

// 选择器只依赖检索函数;按模块打桩,避免触到真实 axiosInstance
vi.mock('../api/haloClient', () => ({
  listImageAttachments: vi.fn<(keyword: string, page: number, size: number) => Promise<AttachmentPage>>(),
}))

const mockedList = vi.mocked(listImageAttachments)

const ATTACHMENTS: AttachmentSummary[] = [
  { name: 'a1', displayName: '封面一.png', link: '/upload/a1.png', thumb: '/upload/a1.png?width=400' },
  { name: 'a2', displayName: '封面二.png', link: '/upload/a2.png', thumb: '' },
]

function pageOf(items: AttachmentSummary[], extra: { total?: number; hasNext?: boolean } = {}) {
  return { items, total: extra.total ?? items.length, hasNext: extra.hasNext ?? false }
}

/** 展开面板并等首屏检索落地 */
async function expand(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('button').trigger('click')
  await flushPromises()
}

describe('AttachmentPicker', () => {
  beforeEach(() => {
    mockedList.mockReset()
  })

  it('默认收起:不发起任何请求,也不渲染面板', () => {
    const wrapper = mount(AttachmentPicker)
    expect(mockedList).not.toHaveBeenCalled()
    expect(wrapper.find('.ap').exists()).toBe(false)
    wrapper.unmount()
  })

  it('展开后检索第一页并渲染图片网格,无缩略图时回退原图', async () => {
    mockedList.mockResolvedValue(pageOf(ATTACHMENTS))
    const wrapper = mount(AttachmentPicker)

    await expand(wrapper)

    expect(mockedList).toHaveBeenCalledWith('', 1, 24)
    const cells = wrapper.findAll('.cell')
    expect(cells).toHaveLength(2)
    expect(cells[0].find('img').attributes('src')).toBe('/upload/a1.png?width=400')
    expect(cells[1].find('img').attributes('src')).toBe('/upload/a2.png')
    wrapper.unmount()
  })

  it('选中即回调并向父级交出该附件,随后收起并回显名称', async () => {
    mockedList.mockResolvedValue(pageOf(ATTACHMENTS))
    const wrapper = mount(AttachmentPicker)
    await expand(wrapper)

    await wrapper.findAll('.cell')[0].trigger('click')

    expect(wrapper.emitted('pick')![0][0]).toEqual(ATTACHMENTS[0])
    expect(wrapper.find('.ap').exists()).toBe(false)
    expect(wrapper.text()).toContain('已选附件：封面一.png')
    wrapper.unmount()
  })

  it('检索失败时就地呈现中文错误,不把异常抛给父级', async () => {
    mockedList.mockRejectedValue(new Error('读取附件库失败,请稍后重试'))
    const wrapper = mount(AttachmentPicker)

    await expand(wrapper)

    expect(wrapper.find('.err').text()).toContain('读取附件库失败')
    expect(wrapper.findAll('.cell')).toHaveLength(0)
    wrapper.unmount()
  })

  it('零结果给出空态文案而非一片空白', async () => {
    mockedList.mockResolvedValue(pageOf([]))
    const wrapper = mount(AttachmentPicker)

    await expand(wrapper)

    expect(wrapper.text()).toContain('没有匹配的图片附件')
    wrapper.unmount()
  })

  it('hasNext 为真时提供「加载更多」,点击追加下一页', async () => {
    mockedList
      .mockResolvedValueOnce(pageOf(ATTACHMENTS, { total: 3, hasNext: true }))
      .mockResolvedValueOnce(pageOf([{ name: 'a3', displayName: '封面三.png', link: '/upload/a3.png', thumb: '' }]))
    const wrapper = mount(AttachmentPicker)
    await expand(wrapper)

    expect(wrapper.findAll('.cell')).toHaveLength(2)
    await wrapper.findAll('button').find((b) => b.text().includes('加载更多'))!.trigger('click')
    await flushPromises()

    expect(mockedList).toHaveBeenLastCalledWith('', 2, 24)
    expect(wrapper.findAll('.cell')).toHaveLength(3)
    wrapper.unmount()
  })

  it('关键词经 300ms 防抖后才检索,连续输入只发一次请求', async () => {
    vi.useFakeTimers()
    try {
      mockedList.mockResolvedValue(pageOf(ATTACHMENTS))
      const wrapper = mount(AttachmentPicker)
      await wrapper.find('button').trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      mockedList.mockClear()

      const input = wrapper.find('input')
      await input.setValue('封')
      await input.setValue('封面')
      expect(mockedList).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(300)

      expect(mockedList).toHaveBeenCalledTimes(1)
      expect(mockedList).toHaveBeenCalledWith('封面', 1, 24)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})