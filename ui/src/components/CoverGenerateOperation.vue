<script setup lang="ts">
import { getCurrentInstance, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { VDropdownItem } from '@halo-dev/components'
import type { ListedPost } from '@halo-dev/api-client'

/**
 * 文章列表操作项:「生成封面」→ 跳转工作台并预选该文章。
 *
 * ⚠️ 线上「点击无反应」的根因与防线(依真实点击取证,合成事件测不出):
 * 1. 弹窗寄居 popper:真实点击菜单项时 floating-vue 会先隐藏 popper(aria-hidden),
 *   popper 内状态与随挂的弹窗随之失效 → 该方案已废弃,本组件为纯路由跳转,
 *   工作台经路由 query 接收预选(历史方案见 git 历史);
 * 2. 宿主契约断路:宿主 EntityDropdownItems 会在本组件上绑定
 *   @click="action(dropdownItem)"(OperationItem 官方 action 契约)。
 *   inheritAttrs:false 必须配合 v-bind="$attrs",否则这条监听被静默丢弃;
 * 3. $router 缺失静默吞点击:optional chaining 让导航失败不留任何痕迹
 *   (表现为「无反应且控制台无输出」)。$router 缺失时回退整页跳转保证功能可达,
 *   并 console.error 显式暴露根因。
 *
 * 唤起时机绑定 pointerdown(floating-vue 隐藏 popper 之前唯一可达事件),
 * click 作为兜底,open 幂等。
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{ post: MaybeRefOrGetter<ListedPost> }>()

// setup 期捕获宿主应用上下文(事件触发时组件可能已被 popper 卸载,须提前持有)
const globalProps = getCurrentInstance()?.appContext.config.globalProperties as
  | { $router?: { push: (loc: { path: string; query: Record<string, string> }) => Promise<unknown> } }
  | undefined

function open() {
  const lp = toValue(props.post)
  const postName = lp?.post?.metadata?.name ?? ''
  if (!postName) return // 无有效目标文章不导航
  const postTitle = lp?.post?.spec?.title ?? ''
  const target = { path: '/cover-generator', query: { postName, postTitle } }
  const router = globalProps?.$router
  if (router) {
    void router.push(target)
    return
  }
  // 根因防线:宿主上下文异常($router 缺失)时不静默吞掉点击——
  // 回退整页跳转保证功能可达,并留下显式错误日志供定位
  console.error('[封面生成器] 宿主 $router 缺失,回退整页跳转至工作台', target)
  window.location.assign(
    `/console/cover-generator?postName=${encodeURIComponent(postName)}&postTitle=${encodeURIComponent(postTitle)}`,
  )
}
</script>

<template>
  <VDropdownItem v-bind="$attrs" @pointerdown="open" @click="open"><slot>生成封面</slot></VDropdownItem>
</template>
