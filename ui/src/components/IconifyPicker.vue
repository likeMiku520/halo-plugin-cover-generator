<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  fetchIconSvg, iconPreviewUrl, listIconSets, listIconsOfSet, searchIcons, type IconSet,
} from '../lib/iconify'
import { sanitizeSvgMarkup } from '../lib/svgSanitizer'

/**
 * Iconify 图标选择器。
 *
 * 与 Halo 内置图标选择器同源(Iconify 官方库),支持两条找图路径:
 * 按图标集浏览(下拉选择 + 网格)与关键词检索。选中后取回 SVG 标记、
 * 过一遍白名单再交给父组件,入库的仍是自包含标记。
 */
const props = defineProps<{
  /** 取回图标时使用的填充色,与元素颜色保持一致 */
  color: string
}>()

const emit = defineEmits<{
  (e: 'pick', markup: string): void
}>()

/** 单次渲染的图标上限:一次画几千个节点会明显卡顿 */
const PAGE = 96

const sets = ref<IconSet[]>([])
const activeSet = ref('')
const keyword = ref('')
const icons = ref<string[]>([])
const loading = ref(false)
const loadingSets = ref(true)
const error = ref('')
const picked = ref('')
const shown = ref(PAGE)
/** 请求序号:只接受最后一次结果,避免慢响应覆盖新结果 */
let seq = 0

const shownIcons = computed(() => icons.value.slice(0, shown.value))
const hasMore = computed(() => icons.value.length > shown.value)
const activeSetMeta = computed(() => sets.value.find((s) => s.prefix === activeSet.value))

async function loadSets() {
  loadingSets.value = true
  error.value = ''
  try {
    sets.value = await listIconSets()
    // 默认展开图标最多的集合,避免进入后是一片空白
    if (sets.value.length && !activeSet.value) {
      activeSet.value = sets.value[0].prefix
      await loadSet(sets.value[0].prefix)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '图标库加载失败'
  } finally {
    loadingSets.value = false
  }
}

async function loadSet(prefix: string) {
  const mine = ++seq
  loading.value = true
  error.value = ''
  shown.value = PAGE
  try {
    const list = await listIconsOfSet(prefix)
    if (mine !== seq) return
    icons.value = list
    if (!list.length) error.value = '该图标集没有可用图标'
  } catch (e) {
    if (mine !== seq) return
    icons.value = []
    error.value = e instanceof Error ? e.message : '图标集加载失败'
  } finally {
    if (mine === seq) loading.value = false
  }
}

async function runSearch() {
  const q = keyword.value.trim()
  if (!q) {
    if (activeSet.value) await loadSet(activeSet.value)
    return
  }
  const mine = ++seq
  loading.value = true
  error.value = ''
  shown.value = PAGE
  try {
    const hits = await searchIcons(q)
    if (mine !== seq) return
    icons.value = hits.map((h) => h.name)
    if (!hits.length) error.value = '没有匹配的图标,换个关键词试试(如 home、user、star)'
  } catch (e) {
    if (mine !== seq) return
    icons.value = []
    error.value = e instanceof Error ? e.message : '检索失败'
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(activeSet, (prefix) => {
  // 检索态下切换图标集:清空关键词回到浏览模式
  if (prefix && !keyword.value.trim()) void loadSet(prefix)
})

async function choose(name: string) {
  if (picked.value === name) return
  picked.value = name
  error.value = ''
  try {
    const raw = await fetchIconSvg(name, props.color)
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

onMounted(loadSets)
onBeforeUnmount(() => { seq += 1 })
</script>

<template>
  <div class="picker">
    <div class="bar">
      <input
        v-model="keyword"
        class="sd-field"
        placeholder="搜索图标,如 home / user / star"
        aria-label="Iconify 图标关键词"
        @keydown.enter.prevent="runSearch"
      />
      <button type="button" class="sd-btn-quiet" :disabled="loading" @click="runSearch">
        {{ loading ? '…' : '搜索' }}
      </button>
    </div>

    <label class="set-row">
      <span class="lb">图标集</span>
      <select
        v-model="activeSet"
        class="sd-field"
        :disabled="loadingSets"
        aria-label="选择图标集"
        @change="keyword = ''; loadSet(activeSet)"
      >
        <option v-if="loadingSets" value="">加载中…</option>
        <option v-for="s in sets" :key="s.prefix" :value="s.prefix">
          {{ s.name }}（{{ s.total }}）
        </option>
      </select>
    </label>
    <p v-if="activeSetMeta" class="meta-line">
      {{ activeSetMeta.author }}<span v-if="activeSetMeta.license"> · {{ activeSetMeta.license }}</span>
    </p>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="loading" class="meta-line">加载图标中…</p>

    <div v-if="shownIcons.length" class="grid" role="listbox" aria-label="图标列表">
      <button
        v-for="name in shownIcons"
        :key="name"
        type="button"
        class="cell"
        :class="{ 'is-on': picked === name }"
        :title="name"
        :aria-label="name"
        role="option"
        :aria-selected="picked === name"
        @click="choose(name)"
      >
        <img :src="iconPreviewUrl(name)" :alt="name" width="22" height="22" loading="lazy" />
      </button>
    </div>

    <button v-if="hasMore" type="button" class="sd-btn-quiet more" @click="shown += PAGE">
      显示更多（还有 {{ icons.length - shown }} 个）
    </button>
    <p v-if="icons.length && !hasMore" class="meta-line">
      共 {{ icons.length }} 个图标
    </p>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  gap: 8px;
}

.set-row {
  display: block;
  margin-top: 8px;
}

.lb {
  display: block;
  margin-bottom: 4px;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
}

.meta-line {
  margin: 6px 0 0;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
}

.err {
  margin: 8px 0 0;
  font-size: var(--sd-fs-sm);
  color: var(--sd-danger-text);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
  margin-top: 8px;
  max-height: 190px;
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
  /* 图标是深色描边,面板为浅色材质,反相后可见 */
  filter: invert(48%);
}

.more {
  width: 100%;
  margin-top: 8px;
}
</style>