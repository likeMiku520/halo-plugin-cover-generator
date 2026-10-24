<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AnchorKey, CoverState, CustomElement, CustomKind } from '../lib/types'
import { defaultAnchors, normalizeAnchor } from '../lib/layout'
import { anchorLabel, type SelectionId } from '../composables/useCanvasInteraction'
import { fetchLogoAsDataUrl, validateLogoUrl } from '../lib/logoFetcher'
import { sanitizeSvgMarkup } from '../lib/svgSanitizer'
import { MAX_CUSTOM_ELEMENTS } from '../composables/useCoverState'
import IconifyPicker from './IconifyPicker.vue'

/**
 * 元素面板：统一的元素列表（内置 + 自定义）+ 选中元素的位置/大小 + 自定义元素录入。
 *
 * 元素只能在这里选中（画布不可点选，见 CanvasOverlay），
 * 因此列表必须完整承载「有哪些元素、现在选中谁、如何新增与删除」。
 */
const props = defineProps<{
  modelValue: CoverState
  selected: SelectionId | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: CoverState): void
  (e: 'select', id: SelectionId | null): void
}>()

const BUILTIN: AnchorKey[] = ['logo', 'title', 'subtitle', 'watermark']

const KIND_LABEL: Record<CustomKind, string> = {
  image: '图片',
  text: '文字',
  svg: 'SVG 图标',
}

function set(patch: Partial<CoverState>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function setAnchor(key: SelectionId, patch: { x?: number; y?: number; scale?: number }) {
  if (key.startsWith('custom:')) {
    const id = key.slice('custom:'.length)
    set({
      customElements: props.modelValue.customElements.map((el) =>
        el.id === id ? { ...el, anchor: normalizeAnchor({ ...el.anchor, ...patch }) } : el,
      ),
    })
    return
  }
  const k = key as AnchorKey
  set({
    layout: { ...props.modelValue.layout, [k]: normalizeAnchor({ ...props.modelValue.layout[k], ...patch }) },
  })
}

function anchorOfId(id: SelectionId) {
  if (id.startsWith('custom:')) {
    const el = props.modelValue.customElements.find((e) => `custom:${e.id}` === id)
    return el?.anchor ?? null
  }
  return props.modelValue.layout[id as AnchorKey]
}

const activeAnchor = computed(() => (props.selected ? anchorOfId(props.selected) : null))

/** 选中元素是否属于自定义元素（决定位置区是否同时给出删除入口） */
const activeElement = computed(() => {
  if (!props.selected?.startsWith('custom:')) return null
  const id = props.selected.slice('custom:'.length)
  return props.modelValue.customElements.find((el) => el.id === id) ?? null
})

function onPercent(axis: 'x' | 'y' | 'scale', ev: Event) {
  if (!props.selected) return
  const raw = Number((ev.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  setAnchor(props.selected, { [axis]: raw / 100 })
}

function onScaleInput(ev: Event) {
  const raw = Number((ev.target as HTMLInputElement).value)
  if (!props.selected || !Number.isFinite(raw)) return
  setAnchor(props.selected, { scale: raw / 100 })
}

/** 重置位置与大小：自定义元素的位置一并归位，但保留其内容 */
function resetLayout() {
  const center = (el: CustomElement): CustomElement => ({
    ...el,
    anchor: { x: 0.5, y: 0.5, scale: 1 },
  })
  set({
    layout: defaultAnchors(),
    customElements: props.modelValue.customElements.map(center),
  })
}

/* ---------------- 自定义元素录入 ---------------- */

const addKind = ref<CustomKind>('image')
const elementError = ref('')
const busy = ref(false)
const svgInput = ref('')
const svgUrl = ref('')
const imageUrl = ref('')
const showSvgSource = ref(false)
const fileInput = ref<HTMLInputElement>()

let seq = 0
function nextId(): string {
  seq += 1
  return `ce${Date.now().toString(36)}${seq}`
}

function newElement(kind: CustomKind, patch: Partial<CustomElement> = {}): CustomElement {
  return {
    id: nextId(),
    kind,
    content: '',
    text: kind === 'text' ? '双击编辑文字' : '',
    size: kind === 'text' ? 48 : 160,
    anchor: { x: 0.5, y: 0.5, scale: 1 },
    color: '#ffffff',
    bold: true,
    tracking: 0,
    round: false,
    ...patch,
  }
}

function appendElement(el: CustomElement) {
  set({ customElements: [...props.modelValue.customElements, el] })
  emit('select', `custom:${el.id}`)
  elementError.value = ''
}

function updateElement(id: string, patch: Partial<CustomElement>) {
  set({ customElements: props.modelValue.customElements.map((el) => (el.id === id ? { ...el, ...patch } : el)) })
}

function removeElement(id: string) {
  set({ customElements: props.modelValue.customElements.filter((el) => el.id !== id) })
  if (props.selected === `custom:${id}`) emit('select', null)
}

function moveElement(id: string, delta: number) {
  const list = [...props.modelValue.customElements]
  const i = list.findIndex((el) => el.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item)
  set({ customElements: list })
}

const canAdd = computed(() => props.modelValue.customElements.length < MAX_CUSTOM_ELEMENTS)

function addText() {
  if (!canAdd.value) return
  appendElement(newElement('text'))
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('文件读取失败，请重试'))
    reader.readAsDataURL(file)
  })
}

function onPickImageFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    elementError.value = '仅支持图片文件'
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    elementError.value = '图片不能超过 2 MB'
    return
  }
  void readAsDataUrl(file)
    .then((dataUrl) => appendElement(newElement('image', { content: dataUrl })))
    .catch((e: unknown) => { elementError.value = e instanceof Error ? e.message : '图片读取失败' })
}

async function addImageFromUrl() {
  if (busy.value) return
  const invalid = validateLogoUrl(imageUrl.value)
  if (invalid) {
    elementError.value = invalid
    return
  }
  busy.value = true
  elementError.value = ''
  try {
    appendElement(newElement('image', { content: await fetchLogoAsDataUrl(imageUrl.value.trim()) }))
    imageUrl.value = ''
  } catch (e) {
    elementError.value = e instanceof Error ? e.message : '导入失败'
  } finally {
    busy.value = false
  }
}

/** 任何来源的 SVG 都经同一条白名单过滤后入库 */
function useSvgMarkup(raw: string) {
  const result = sanitizeSvgMarkup(raw)
  if (!result.ok) {
    elementError.value = result.reason
    return false
  }
  appendElement(newElement('svg', { content: result.markup, size: 120 }))
  return true
}

function onPickSvgFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { if (useSvgMarkup(String(reader.result))) svgInput.value = '' }
  reader.onerror = () => { elementError.value = '文件读取失败，请重试' }
  reader.readAsText(file)
}

async function addSvgFromUrl() {
  if (busy.value) return
  const url = svgUrl.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    elementError.value = '链接需以 http(s):// 开头'
    return
  }
  busy.value = true
  elementError.value = ''
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
    if (useSvgMarkup(await res.text())) svgUrl.value = ''
  } catch (e) {
    elementError.value = e instanceof Error ? e.message : 'SVG 导入失败'
  } finally {
    busy.value = false
  }
}

function sizeRange(kind: CustomKind): { min: number; max: number } {
  return kind === 'text' ? { min: 16, max: 200 } : { min: 24, max: 600 }
}
</script>

<template>
  <section class="card">
    <div class="head">
      <b>元素</b>
      <span class="spacer"></span>
      <button type="button" class="sd-btn-quiet" @click="resetLayout">重置位置</button>
    </div>
    <p class="hint">点下面的元素名选中它，再拖动或用方向键微调（Shift 加速）</p>

    <ul class="el-list">
      <li v-for="key in BUILTIN" :key="key">
        <button
          type="button"
          class="el-row"
          :class="{ 'is-on': selected === key }"
          :aria-pressed="selected === key"
          @click="emit('select', selected === key ? null : key)"
        >
          <span class="el-kind">{{ anchorLabel(key) }}</span>
          <span class="el-meta">
            {{ Math.round(modelValue.layout[key].x * 100) }}% · {{ Math.round(modelValue.layout[key].y * 100) }}%
          </span>
        </button>
      </li>
      <li v-for="el in modelValue.customElements" :key="el.id">
        <div class="el-row custom" :class="{ 'is-on': selected === `custom:${el.id}` }">
          <button
            type="button"
            class="el-name"
            :aria-pressed="selected === `custom:${el.id}`"
            @click="emit('select', selected === `custom:${el.id}` ? null : `custom:${el.id}`)"
          >
            <span class="el-kind">{{ KIND_LABEL[el.kind] }}</span>
            <span class="el-meta">
              {{ el.kind === 'text' ? el.text.slice(0, 10) : `${el.size}px` }}
            </span>
          </button>
          <button type="button" class="mini" aria-label="上移" @click="moveElement(el.id, -1)">↑</button>
          <button type="button" class="mini" aria-label="下移" @click="moveElement(el.id, 1)">↓</button>
          <button type="button" class="mini danger" aria-label="删除" @click="removeElement(el.id)">✕</button>
        </div>
      </li>
    </ul>

    <div v-if="activeAnchor" class="pos">
      <div class="row3">
        <label class="field">
          <span class="lb">水平 %</span>
          <input
            class="sd-field"
            type="number"
            min="2"
            max="98"
            :value="Math.round(activeAnchor.x * 100)"
            @change="onPercent('x', $event)"
          />
        </label>
        <label class="field">
          <span class="lb">垂直 %</span>
          <input
            class="sd-field"
            type="number"
            min="3"
            max="97"
            :value="Math.round(activeAnchor.y * 100)"
            @change="onPercent('y', $event)"
          />
        </label>
        <label class="field">
          <span class="lb">大小 %</span>
          <input
            class="sd-field"
            type="number"
            min="10"
            max="500"
            :value="Math.round(activeAnchor.scale * 100)"
            @change="onPercent('scale', $event)"
          />
        </label>
      </div>
      <input
        class="slider"
        type="range"
        min="20"
        max="300"
        step="5"
        :style="{ '--fill': `${((activeAnchor.scale * 100 - 20) / 280) * 100}%` }"
        :value="Math.round(activeAnchor.scale * 100)"
        aria-label="选中元素大小"
        @input="onScaleInput($event)"
      />
    </div>
    <p v-else-if="modelValue.customElements.length" class="hint">选中上面的任一元素可调整位置与大小</p>

    <div v-if="activeElement" class="detail">
      <label v-if="activeElement.kind === 'text'" class="field">
        <span class="lb">文字内容</span>
        <input
          class="sd-field"
          :value="activeElement.text"
          @input="updateElement(activeElement.id, { text: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <div class="row3">
        <label class="field">
          <span class="lb">{{ activeElement.kind === 'text' ? '字号' : '边长' }}</span>
          <input
            class="sd-field"
            type="number"
            :min="sizeRange(activeElement.kind).min"
            :max="sizeRange(activeElement.kind).max"
            :value="activeElement.size"
            @change="updateElement(activeElement.id, { size: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label v-if="activeElement.kind === 'text'" class="field">
          <span class="lb">颜色</span>
          <input
            class="sd-field color"
            type="color"
            :value="activeElement.color"
            @input="updateElement(activeElement.id, { color: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label v-if="activeElement.kind === 'text'" class="field">
          <span class="lb">字距</span>
          <input
            class="sd-field"
            type="number"
            step="0.02"
            min="-0.1"
            max="1"
            :value="activeElement.tracking"
            @change="updateElement(activeElement.id, { tracking: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
      </div>
      <div class="toggles">
        <label v-if="activeElement.kind === 'text'" class="tg">
          <input
            type="checkbox"
            :checked="activeElement.bold"
            @change="updateElement(activeElement.id, { bold: ($event.target as HTMLInputElement).checked })"
          />
          加粗
        </label>
        <label v-if="activeElement.kind !== 'text'" class="tg">
          <input
            type="checkbox"
            :checked="activeElement.round"
            @change="updateElement(activeElement.id, { round: ($event.target as HTMLInputElement).checked })"
          />
          圆形裁剪
        </label>
      </div>
    </div>

    <div class="add-sec">
      <div class="lb">添加元素</div>
      <div class="add-row">
        <button
          type="button"
          class="sd-btn-quiet grow"
          :class="{ 'is-pick': addKind === 'text' }"
          :disabled="!canAdd"
          @click="addKind = 'text'; addText()"
        >
          文字
        </button>
        <button
          type="button"
          class="sd-btn-quiet grow"
          :class="{ 'is-pick': addKind === 'image' }"
          :disabled="!canAdd"
          @click="addKind = 'image'; fileInput?.click()"
        >
          图片
        </button>
        <button
          type="button"
          class="sd-btn-quiet grow"
          :class="{ 'is-pick': addKind === 'svg' }"
          :disabled="!canAdd"
          @click="addKind = 'svg'"
        >
          SVG 图标
        </button>
      </div>

      <input
        ref="fileInput"
        class="hidden-file"
        type="file"
        accept="image/*"
        @change="onPickImageFile"
      />

      <div v-if="addKind === 'image'" class="url-row">
        <input v-model="imageUrl" class="sd-field" placeholder="粘贴图片直链 https://…" aria-label="图片直链" />
        <button type="button" class="sd-btn-quiet" :disabled="busy" @click="addImageFromUrl">导入</button>
      </div>

      <template v-if="addKind === 'svg'">
        <IconifyPicker :color="'#ffffff'" @pick="useSvgMarkup" />

        <div class="svg-more">
          <button type="button" class="sd-btn-ghost" @click="showSvgSource = !showSvgSource">
            {{ showSvgSource ? '收起手写 SVG' : '手写 / 上传 SVG' }}
          </button>
        </div>
        <template v-if="showSvgSource">
          <label class="upload-row">
            <span class="sd-btn-quiet">选择 .svg 文件</span>
            <input class="hidden-file" type="file" accept=".svg,image/svg+xml" @change="onPickSvgFile" />
          </label>
          <textarea
            v-model="svgInput"
            class="sd-field svg-area"
            rows="3"
            placeholder="粘贴 SVG 源码，例如 &lt;svg viewBox=&quot;0 0 24 24&quot;&gt;…&lt;/svg&gt;"
            aria-label="SVG 源码"
          ></textarea>
          <div class="url-row">
            <input v-model="svgUrl" class="sd-field" placeholder="或 SVG 文件直链 https://…" aria-label="SVG 直链" />
            <button type="button" class="sd-btn-quiet" :disabled="busy" @click="addSvgFromUrl">导入</button>
          </div>
          <button
            type="button"
            class="sd-btn-quiet wide"
            :disabled="!svgInput.trim() || !canAdd"
            @click="useSvgMarkup(svgInput) && (svgInput = '')"
          >
            添加粘贴的 SVG
          </button>
        </template>
      </template>

      <p v-if="elementError" class="err">{{ elementError }}</p>
      <p v-if="!canAdd" class="hint">已达 {{ MAX_CUSTOM_ELEMENTS }} 个上限，删除后可继续添加</p>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: var(--sd-fs-sm);
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

/* ---- 统一元素列表：内置与自定义同构 ---- */
.el-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.el-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-family: inherit;
  text-align: left;
  color: var(--sd-text);
  background: var(--sd-surface-control);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-control);
  cursor: pointer;
  transition:
    border-color var(--sd-dur-hover) var(--sd-ease),
    background-color var(--sd-dur-hover) var(--sd-ease);
}

.el-row:hover {
  border-color: var(--sd-accent);
  background: var(--sd-surface-hover);
}

.el-row.is-on {
  border-color: var(--sd-accent-strong);
  background: rgb(57 197 187 / 10%);
  box-shadow: 0 0 0 2px var(--sd-focus-ring);
}

.el-row.custom {
  padding: 4px 6px 4px 12px;
  cursor: default;
}

.el-name {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 6px 0;
  font-family: inherit;
  text-align: left;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}

.el-kind {
  font-size: var(--sd-fs-md);
  font-weight: 600;
}

.el-meta {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.el-row > .el-meta {
  flex: 1;
}

.mini {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  font-family: inherit;
  font-size: var(--sd-fs-md);
  line-height: 1;
  color: var(--sd-text);
  background: var(--sd-surface-raised);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-small);
  cursor: pointer;
}

.mini:hover {
  background: var(--sd-surface-hover);
}

.mini.danger {
  color: var(--sd-danger-text);
}

/* ---- 选中元素的位置与大小 ---- */
.pos {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--sd-line);
}

.row3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.field {
  display: block;
  min-width: 0;
}

.lb {
  display: block;
  margin-bottom: 4px;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
}

.slider {
  width: 100%;
  margin-top: 10px;
}

.detail {
  margin-top: 12px;
  padding: 10px;
  background: var(--sd-surface-raised);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-control);
}

.toggles {
  display: flex;
  gap: 14px;
  margin-top: 8px;
}

.tg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-fs-sm);
  color: var(--sd-text-2);
}

/* ---- 添加元素 ---- */
.add-sec {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--sd-line);
}

.add-row {
  display: flex;
  gap: 6px;
}

.grow {
  flex: 1;
  min-width: 0;
  padding: 8px 6px;
  font-size: var(--sd-fs-sm);
}

.grow.is-pick {
  color: var(--sd-text-on-accent);
  background: var(--sd-accent-strong);
  box-shadow: none;
}

.hidden-file {
  display: none;
}

.upload-row {
  display: block;
  margin-top: 8px;
}

.url-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.svg-area {
  margin-top: 8px;
  font-family: var(--sd-font-mono);
  font-size: var(--sd-fs-sm);
  resize: vertical;
}

.svg-more {
  margin-top: 10px;
}

.wide {
  width: 100%;
  margin-top: 8px;
}

.sd-field.color {
  padding: 2px;
  height: 34px;
}
</style>