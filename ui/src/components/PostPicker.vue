<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { searchPosts, type PostSummary } from '../api/haloClient'
import { useDismiss } from '../composables/useDismiss'

const props = defineProps<{
  /** 当前选中文章(v-model);null 表示未选择 */
  modelValue: PostSummary | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: PostSummary | null): void
}>()

const keyword = ref('')
const results = ref<PostSummary[]>([])
const searchError = ref('')
const dropdownOpen = ref(false)
/** C1 空态:本轮检索已完成且零结果时明示「未找到」,与「还没搜」区分 */
const searchedEmpty = ref(false)
/** 键盘导航的活动项(B3):-1 表示尚无活动项;配合 aria-activedescendant */
const activeIndex = ref(-1)
const root = ref<HTMLElement>()

/** 点击外部/Esc 关闭(B3);Esc 关闭时焦点已在输入框上,无需归还 */
useDismiss(root, dropdownOpen, () => closeDropdown())

/** 检索防抖与 useCoverState 落盘同款 300ms */
const DEBOUNCE_MS = 300
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * 检索序号(单调递增):每次输入/选中/清空都作废在途请求,仅最新序号的响应允许落地。
 * 防两类竞态——过期响应后到覆盖新结果;清空后在途响应把下拉重新弹开。
 */
let searchSeq = 0

/** 作废在途检索并撤销未触发的防抖定时器 */
function invalidatePendingSearch() {
  searchSeq++
  if (timer) clearTimeout(timer)
  timer = undefined
}

function closeDropdown() {
  dropdownOpen.value = false
  activeIndex.value = -1
  searchedEmpty.value = false
}

async function runSearch(kw: string) {
  const seq = ++searchSeq
  searchError.value = ''
  try {
    const found = await searchPosts(kw)
    if (seq !== searchSeq) return // 已有更新输入/选中/清空,丢弃过期响应
    results.value = found
    searchedEmpty.value = found.length === 0
    dropdownOpen.value = true
    activeIndex.value = -1
  } catch (e) {
    if (seq !== searchSeq) return
    results.value = []
    searchedEmpty.value = false
    // 错误在下拉浮层内呈现而非下方文本行:本组件嵌在动作条里,任何进入布局流的
    // 瞬态行都会撑高整列并经 stretch 拉高整行按钮(实机回归:选中后按钮变大)
    dropdownOpen.value = true
    searchError.value = e instanceof Error ? e.message : '搜索文章失败'
  }
}

function onInput() {
  // 已选中后继续输入视为改选:先解除选中,避免旧值残留在父级状态
  if (props.modelValue && keyword.value !== props.modelValue.title) {
    emit('update:modelValue', null)
  }
  invalidatePendingSearch()
  activeIndex.value = -1
  const kw = keyword.value.trim()
  if (!kw) {
    results.value = []
    dropdownOpen.value = false
    searchedEmpty.value = false
    searchError.value = ''
    return
  }
  timer = setTimeout(() => void runSearch(kw), DEBOUNCE_MS)
}

function select(post: PostSummary) {
  invalidatePendingSearch() // 选中后不再接受在途检索的落地
  emit('update:modelValue', post)
  keyword.value = post.title // 选中回显
  closeDropdown()
  results.value = []
  searchError.value = ''
}

/** 键盘导航(B3):下/上移动活动项;下拉未开时先开。
 * 输入法合成期间(候选确认)的 Enter/方向键必须忽略,否则会干扰中文输入。 */
function onKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault() // 阻止光标在输入框内移动
    if (!dropdownOpen.value) {
      if (!results.value.length) return
      dropdownOpen.value = true
      activeIndex.value = e.key === 'ArrowDown' ? 0 : results.value.length - 1
      return
    }
    const delta = e.key === 'ArrowDown' ? 1 : -1
    const next = activeIndex.value + delta
    activeIndex.value = Math.min(results.value.length - 1, Math.max(0, next))
    return
  }
  if (e.key === 'Enter') {
    // 有活动项即选中;无活动项时立即检索(不必等防抖),皆不触发表单提交
    if (dropdownOpen.value && activeIndex.value >= 0) {
      e.preventDefault()
      select(results.value[activeIndex.value])
      return
    }
    invalidatePendingSearch()
    const kw = keyword.value.trim()
    if (kw) {
      e.preventDefault()
      void runSearch(kw)
    }
    return
  }
}

/** 焦点移出组件时收起下拉(combobox 惯例)。
 * 仅处理「焦点转移到外部可聚焦元素」(如 Tab 离开);relatedTarget 为空的
 * 失焦不在此收——点击条目/空白处时浏览器会把输入框焦点打到 body,若此处
 * 同步收起下拉,click 尚未派发条目已被移除,选中会静默丢失(实机回归实测)。
 * 点空白由 useDismiss 的 pointerdown 出界负责,点条目由条目自身 click 负责。 */
function onFocusout(e: FocusEvent) {
  if (!dropdownOpen.value) return
  if (e.relatedTarget === null) return
  if (root.value?.contains(e.relatedTarget as Node)) return
  closeDropdown()
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div ref="root" class="post-picker" @focusout="onFocusout">
    <input
      v-model="keyword"
      class="sd-field"
      role="combobox"
      :aria-expanded="dropdownOpen"
      aria-controls="cover-post-listbox"
      :aria-activedescendant="activeIndex >= 0 ? `cover-post-opt-${activeIndex}` : undefined"
      aria-autocomplete="list"
      placeholder="绑定到文章:输入标题关键字检索"
      aria-label="搜索文章"
      @input="onInput"
      @keydown="onKeydown"
    />
    <!-- 下拉向上弹(S4):动作条贴近视口底部,向下弹会被裁剪。
         条目不可聚焦,键盘导航经输入框的 aria-activedescendant 完成(B3) -->
    <ul v-if="dropdownOpen && results.length" id="cover-post-listbox" class="post-list sd-pop" role="listbox" aria-label="匹配文章">
      <li
        v-for="(p, i) in results"
        :key="p.name"
        :id="`cover-post-opt-${i}`"
        class="post-item sd-menu-item"
        :class="{ 'is-active': i === activeIndex }"
        role="option"
        :aria-selected="modelValue?.name === p.name || undefined"
        @mousedown.prevent
        @click="select(p)"
      >{{ p.title }}</li>
    </ul>
    <ul v-else-if="dropdownOpen && searchError" class="post-list sd-pop" role="alert">
      <li class="post-empty">{{ searchError }}</li>
    </ul>
    <ul v-else-if="dropdownOpen && searchedEmpty" class="post-list sd-pop">
      <li class="post-empty">未找到相关文章,换个关键字试试</li>
    </ul>
    <!-- 「已选择」提示由 OutputBar 反馈区呈现:本组件在动作条内必须保持
         输入框单行高度,任何布局流内的瞬态行都会撑高整行按钮(评审实机回归) -->
  </div>
</template>

<style scoped>
.post-picker {
  position: relative;
  min-width: 0;
}
/* 检索框外壳走共享类 sd-field(tokens.css);此处只管占满一行 */
input {
  width: 100%;
}
.post-list {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  max-height: 180px;
  overflow-y: auto;
}
/* 条目视觉走共享类 sd-menu-item;此处只管长标题的截断契约与键盘活动项 */
.post-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.post-item.is-active {
  background: var(--sd-surface-hover);
}
/* C1 空态行:不可交互,弱于条目但区别于错误 */
.post-empty {
  color: var(--sd-text-2);
  font-size: var(--sd-fs-md);
  padding: 8px 10px;
}
</style>
