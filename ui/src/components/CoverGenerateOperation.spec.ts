import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive, toRefs } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { ListedPost } from '@halo-dev/api-client'
import CoverGenerateOperation from './CoverGenerateOperation.vue'

// 列表入口为纯路由跳转(不内嵌弹窗):本套件验证点击 → $router.push 携带目标
// 文章信息、两种 post 传入契约(ref 行级引用 / 普通对象),以及两条根因防线:
// 1) 宿主契约透传(EntityDropdownItems 在本组件上绑定 @click,不得被
//    inheritAttrs:false 静默丢弃);
// 2) $router 缺失时不得静默无响应(回退整页跳转并显式报错)。

function listedPost(title: string): ListedPost {
  return {
    post: { metadata: { name: 'post-row-1', version: 1 }, spec: { title } },
  } as unknown as ListedPost
}

function mountWithRouter(post: unknown) {
  const push = vi.fn<(loc: { path: string; query: Record<string, string> }) => Promise<void>>()
  // $router 经 vue-router 增强为完整 Router 类型,测试桩以整体断言收敛(与工作台 $route 桩同法)
  const options = {
    props: { post: post as ListedPost },
    global: {
      config: {
        globalProperties: { $router: { push } },
      },
    },
  }
  const wrapper = mount(CoverGenerateOperation, options as unknown as Parameters<typeof mount>[1])
  return { wrapper, push }
}

function mountWithoutRouter(post: unknown) {
  const options = {
    props: { post: post as ListedPost },
    global: {
      config: {
        globalProperties: {},
      },
    },
  }
  return mount(CoverGenerateOperation, options as unknown as Parameters<typeof mount>[1])
}

describe('CoverGenerateOperation(跳转工作台架构)', () => {
  it('点击菜单项跳转工作台并携带目标文章名称与标题(ref 行级引用契约)', async () => {
    const rowProps = reactive({ post: listedPost('Hello World') })
    const { post } = toRefs(rowProps)
    const { wrapper, push } = mountWithRouter(post)
    await flushPromises()

    expect(wrapper.find('[role="menuitem"]').exists()).toBe(true)
    await wrapper.find('[role="menuitem"]').trigger('click')
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({
      path: '/cover-generator',
      query: { postName: 'post-row-1', postTitle: 'Hello World' },
    })
    wrapper.unmount()
  })

  it('post 为普通对象(宿主 EntityDropdownItems 惯例)时同样跳转(线上回归)', async () => {
    const { wrapper, push } = mountWithRouter(listedPost('Hello World'))
    await flushPromises()

    await wrapper.find('[role="menuitem"]').trigger('click')
    expect(push).toHaveBeenCalledWith({
      path: '/cover-generator',
      query: { postName: 'post-row-1', postTitle: 'Hello World' },
    })
    wrapper.unmount()
  })

  it('pointerdown 同样触发跳转(真实点击时 popper 隐藏前唯一可达事件)', async () => {
    const { wrapper, push } = mountWithRouter(listedPost('Hello World'))
    await flushPromises()

    await wrapper.find('[role="menuitem"]').trigger('pointerdown')
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({
      path: '/cover-generator',
      query: { postName: 'post-row-1', postTitle: 'Hello World' },
    })
    wrapper.unmount()
  })

  it('post 缺失文章数据时不发起跳转(无有效目标不导航)', async () => {
    const { wrapper, push } = mountWithRouter({} as unknown as ListedPost)
    await flushPromises()

    await wrapper.find('[role="menuitem"]').trigger('click')
    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('宿主在组件上绑定的 @click 监听可达 VDropdownItem(OperationItem action 契约)', async () => {
    // EntityDropdownItems 渲染扩展项时绑定 @click="action(dropdownItem)":
    // inheritAttrs:false 若不转发 $attrs,这条官方契约监听会被静默丢弃
    const onAction = vi.fn<(...args: unknown[]) => void>()
    const options = {
      props: { post: listedPost('Hello World') },
      attrs: { onClick: onAction },
    }
    const wrapper = mount(CoverGenerateOperation, options as unknown as Parameters<typeof mount>[1])
    await flushPromises()

    await wrapper.find('[role="menuitem"]').trigger('click')
    expect(onAction).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  describe('$router 缺失(宿主上下文异常)时的根因防线', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('回退整页跳转到工作台并携带文章参数(不静默吞掉点击)', async () => {
      const _errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const assign = vi.fn<(url: string | URL) => void>()
      const assignDescriptor = Object.getOwnPropertyDescriptor(window.location, 'assign')
      if (assignDescriptor?.configurable === false) {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, assign },
          writable: true,
        })
      } else {
        vi.spyOn(window.location, 'assign').mockImplementation(assign)
      }

      const wrapper = mountWithoutRouter(listedPost('Hello World'))
      await flushPromises()

      await wrapper.find('[role="menuitem"]').trigger('click')
      expect(assign).toHaveBeenCalledWith(
        '/console/cover-generator?postName=post-row-1&postTitle=' + encodeURIComponent('Hello World'),
      )
      wrapper.unmount()
    })

    it('回退时输出 console.error 显式暴露根因(线上「无反应且无输出」不可再现)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const assign = vi.fn<(url: string | URL) => void>()
      const assignDescriptor = Object.getOwnPropertyDescriptor(window.location, 'assign')
      if (assignDescriptor?.configurable === false) {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, assign },
          writable: true,
        })
      } else {
        vi.spyOn(window.location, 'assign').mockImplementation(assign)
      }

      const wrapper = mountWithoutRouter(listedPost('Hello World'))
      await flushPromises()

      await wrapper.find('[role="menuitem"]').trigger('click')
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('封面生成器')
      wrapper.unmount()
    })

    it('post 缺失文章数据时既不跳转也不报错(边界:无效目标优先于回退)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const assign = vi.fn<(url: string | URL) => void>()
      const assignDescriptor = Object.getOwnPropertyDescriptor(window.location, 'assign')
      if (assignDescriptor?.configurable === false) {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, assign },
          writable: true,
        })
      } else {
        vi.spyOn(window.location, 'assign').mockImplementation(assign)
      }

      const wrapper = mountWithoutRouter({} as unknown as ListedPost)
      await flushPromises()

      await wrapper.find('[role="menuitem"]').trigger('click')
      expect(assign).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })
})
