<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { listImageAttachments, type AttachmentSummary } from '../api/haloClient'

/**
 * 博客附件图片选择器。
 *
 * 展开后就地检索站内图片附件(只列图片),选中即回调并收起。沿用 PostPicker
 * 的三条既有约定:300ms 防抖、单调序号作废在途响应、错误就地呈现不撑高布局流。
 * 不做弹窗:两处调用点都在侧栏卡片内,内联展开即可,也省掉一层焦点陷阱。
 */
const emit = defineEmits<{
  (e: 'pick', attachment: AttachmentSummary): void
}>()

const PAGE_SIZE = 24
/** 检索防抖与 PostPicker、useCoverState 落盘同款 300ms */
const DEBOUNCE_MS = 300

const open = ref(false)
const keyword = ref('')
const items = ref<AttachmentSummary[]>([])
const total = ref(0)
const hasNext = ref(false)
const page = ref(1)
const loading = ref(false)
const error = ref('')
/** 选中回显:收起后按钮上仍能看出上次选了哪张 */
const pickedName = ref('')

/** 检索序号(单调递增):只接受最后一次请求的结果,避免慢响应覆盖新结果 */
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function load(next: number) {
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const result = await listImageAttachments(keyword.value.trim(), next, PAGE_SIZE)
    if (mine !== seq) return
    items.value = next === 1 ? result.items : [...items.value, ...result.items]
    total.value = result.total
    hasNext.value = result.hasNext
    page.value = next
  } catch (e) {
    if (mine !== seq) return
    error.value = e instanceof Error ? e.message : '读取附件库失败'
  } finally {
    if (mine === seq) loading.value = false
  }
}

function toggle() {
  open.value = !open.value
  if (!open.value) return
  // 每次展开都重取第一页:期间可能已在别处上传/删除附件
  if (timer) clearTimeout(timer)
  void load(1)
}

function onInput() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(1), DEBOUNCE_MS)
}

function choose(attachment: AttachmentSummary) {
  emit('pick', attachment)
  pickedName.value = attachment.displayName
  open.value = false
}

onBeforeUnmount(() => {
  seq += 1
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <button
    type="button"
    class="sd-btn-quiet wide"
    :aria-expanded="open"
    @click="toggle"
  >
    {{ open ? '收起附件库' : pickedName ? `已选附件：${pickedName}` : '从博客附件选择' }}
  </button>

  <div v-if="open" class="ap">
    <input
      v-model="keyword"
      class="sd-field"
      placeholder="搜索附件名称"
      aria-label="搜索博客附件"
      @input="onInput"
    />

    <p v-if="error" class="err" role="status">{{ error }}</p>
    <p v-else-if="loading && !items.length" class="hint">加载附件中…</p>
    <p v-else-if="!items.length" class="hint">没有匹配的图片附件</p>

    <div v-else class="grid" role="listbox" aria-label="博客附件图片">
      <button
        v-for="a in items"
        :key="a.name"
        type="button"
        class="cell"
        role="option"
        :aria-label="a.displayName"
        :title="a.displayName"
        @click="choose(a)"
      >
        <img :src="a.thumb || a.link" :alt="a.displayName" loading="lazy" />
      </button>
    </div>

    <button
      v-if="hasNext"
      type="button"
      class="sd-btn-quiet wide"
      :disabled="loading"
      @click="load(page + 1)"
    >
      {{ loading ? '加载中…' : `加载更多（共 ${total} 张）` }}
    </button>
  </div>
</template>

<style scoped>
.ap {
  margin-top: 8px;
}

.hint {
  margin: 6px 0 0;
  font-size: var(--sd-fs-sm);
  color: var(--sd-text-2);
}

.err {
  margin: 8px 0 0;
  font-size: var(--sd-fs-sm);
  color: var(--sd-danger-text);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
  margin: 8px 0;
  max-height: 208px;
  overflow-y: auto;
}

.cell {
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  padding: 0;
  overflow: hidden;
  background: var(--sd-surface-control);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-small);
  cursor: pointer;
  transition:
    border-color var(--sd-dur-hover) var(--sd-ease),
    background-color var(--sd-dur-hover) var(--sd-ease);
}

.cell:hover {
  border-color: var(--sd-accent);
  background: var(--sd-surface-hover);
}

.cell:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sd-focus-ring);
}

.cell img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>