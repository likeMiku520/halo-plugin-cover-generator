<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { fetchIconSvg, searchIcons, type IconifyHit } from '../lib/iconify'
import { sanitizeSvgMarkup } from '../lib/svgSanitizer'

/**
 * Iconify 图标选择器。
 *
 * 数据源是 Iconify 官方 API(与 Halo 内置图标选择器同一套库),
 * 选中后取回 SVG 标记、过一遍白名单再交给父组件,
 * 因此入库的仍是自包含标记,导出产物不依赖外部链接。
 */
const props = defineProps<{
  /** 取回图标时使用的填充色,与元素颜色保持一致 */
  color: string
}>()

const emit = defineEmits<{
  (e: 'pick', markup: string): void
}>()

const keyword = ref('')
const hits = ref<IconifyHit[]>([])
const searching = ref(false)
const error = ref('')
const picked = ref('')
/** 请求序号:只接受最后一次检索的结果,避免慢响应覆盖新结果 */
let seq = 0

const canSearch = computed(() => keyword.value.trim().length > 0 && !searching.value)

async function search() {
  if (!canSearch.value) return
  const mine = ++seq
  searching.value = true
  error.value = ''
  try {
    const found = await searchIcons(keyword.value)
    if (mine !== seq) return
    hits.value = found
    if (found.length === 0) error.value = '没有匹配的图标,换个关键词试试(如 home、user、star)'
  } catch (e) {
    if (mine !== seq) return
    hits.value = []
    error.value = e instanceof Error ? e.message : '检索失败'
  } finally {
    if (mine === seq) searching.value = false
  }
}

async function choose(hit: IconifyHit) {
  if (picked.value === hit.name) return
  picked.value = hit.name
  error.value = ''
  try {
    const raw = await fetchIconSvg(hit.name, props.color)
    const result = sanitizeSvgMarkup(raw)
    if (!result.ok) {
      error.value = `该图标无法使用:${result.reason}`
      picked.value = ''
      return
    }
    emit('pick', result.markup)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '图标下载失败'
    picked.value = ''
  }
}

onBeforeUnmount(() => { seq += 1 })
</script>

<template>
  <div class="picker">
    <div class="row">
      <input
        v-model="keyword"
        class="sd-field"
        placeholder="搜索图标,如 home / user / star"
        aria-label="Iconify 图标关键词"
        @keydown.enter.prevent="search"
      />
      <button type="button" class="sd-btn-quiet" :disabled="!canSearch" @click="search">
        {{ searching ? '检索中…' : '检索' }}
      </button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="hits.length" class="grid" role="listbox" aria-label="图标检索结果">
      <button
        v-for="hit in hits"
        :key="hit.name"
        type="button"
        class="cell"
        :class="{ 'is-on': picked === hit.name }"
        :title="hit.name"
        :aria-label="hit.name"
        role="option"
        :aria-selected="picked === hit.name"
        @click="choose(hit)"
      >
        <img
          :src="`https://api.iconify.design/${hit.prefix}.svg?height=22`"
          :alt="hit.name"
          width="22"
          height="22"
          loading="lazy"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
}

.err {
  margin: 8px 0 0;
  font-size: var(--sd-fs-sm);
  color: var(--sd-danger-text);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 6px;
  margin-top: 8px;
  max-height: 168px;
  overflow-y: auto;
}

.cell {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  padding: 0;
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

.cell.is-on {
  border-color: var(--sd-accent-strong);
  box-shadow: 0 0 0 2px var(--sd-focus-ring);
}

.cell:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sd-focus-ring);
}

.cell img {
  display: block;
  /* 检索结果是深色描边图标,面板为浅色材质,反相后可见 */
  filter: invert(48%);
}
</style>