<script setup lang="ts">
import { computed, ref } from 'vue'
import { FormKit } from '@formkit/vue'
import type { AnchorKey, CoverState, CustomElement, CustomKind, LayerKey } from '../lib/types'
import {
  CANVAS, REF_H, REF_W, TEXT_STYLE_LIMITS, defaultAnchors, defaultCoverState, defaultTextStyles,
  normalizeAnchor,
} from '../lib/layout'
import { anchorLabel, type SelectionId } from '../composables/useCanvasInteraction'
import { fetchLogoAsDataUrl } from '../lib/logoFetcher'
import { sanitizeSvgMarkup } from '../lib/svgSanitizer'
import { HEX6, firstMarkupColor, recolorSvgMarkup } from '../lib/svgColor'
import { fetchIconSvg } from '../lib/iconFetch'
import { MAX_CUSTOM_ELEMENTS } from '../composables/useCoverState'
import type { TextStyle, TextTarget } from '../lib/types'
import SliderField from './SliderField.vue'

/**
 * 元素面板。
 *
 * 承担四件事:选中哪个元素、选中元素的位置与大小、各元素的前后层级、
 * 追加自定义元素。元素只能在这里选中(画布是纯预览),因此列表要完整承载
 * 「有哪些元素、现在选中谁、谁盖住谁」。
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

const activeElement = computed(() => {
  if (!props.selected?.startsWith('custom:')) return null
  const id = props.selected.slice('custom:'.length)
  return props.modelValue.customElements.find((el) => el.id === id) ?? null
})

/** 当前选中元素在图层表中的位置（-1 表示不在表中） */
const activeLayerIndex = computed(() =>
  props.selected ? props.modelValue.layers.indexOf(props.selected as LayerKey) : -1)

/**
 * 标题的「大小」直接驱动标题字号，而不是再叠一层倍率。
 *
 * 标题字号是用户能在多个位置看到的同一个量（内容区滑杆 / 元素区大小），
 * 若各自独立，用户在其中一处拖动时另一处不动，看起来就像「拖了没反应」。
 * 因此标题的等效值 = 字号 × 锚点倍率，拖动时把倍率归 1、差值写进字号。
 */
const isTitle = computed(() => props.selected === 'title')
const titleAnchorScale = computed(() => props.modelValue.layout.title.scale)
const titleEffectiveFontSize = computed(() =>
  Math.round(props.modelValue.titleFontSize * titleAnchorScale.value))
const titleSizePercent = computed(() =>
  Math.round((titleEffectiveFontSize.value / MAX_TITLE_FONT_SIZE) * 100))

/** 字号安全域：与 layout 的 TITLE_MIN/TITLE_BASE 一致 */
const MIN_TITLE_FONT_SIZE = 64
const MAX_TITLE_FONT_SIZE = 210

/** 标题大小(%) → 字号 + 倍率归位 */
function onTitleSizePercent(percent: number) {
  const size = Math.min(MAX_TITLE_FONT_SIZE, Math.max(MIN_TITLE_FONT_SIZE, Math.round((percent / 100) * MAX_TITLE_FONT_SIZE)))
  set({
    titleFontSize: size,
    layout: { ...props.modelValue.layout, title: { ...props.modelValue.layout.title, scale: 1 } },
  })
}

/**
 * 选中的是不是可单独调排版的内置文字元素(标题 / 副标题 / 水印)。
 * 自定义文字元素不参与:它们的排版由自身字段掌握,不共用这套样式。
 */
const activeTextTarget = computed<TextTarget | null>(() => {
  const id = props.selected
  return id === 'title' || id === 'subtitle' || id === 'watermark' ? id : null
})
const activeTextStyle = computed(() =>
  activeTextTarget.value ? props.modelValue.textStyles[activeTextTarget.value] : null)

/** 文字排版是「这一行字怎么排」,与位置/大小分开存放 */
function updateTextStyle(patch: Partial<TextStyle>) {
  const key = activeTextTarget.value
  if (!key) return
  set({
    textStyles: {
      ...props.modelValue.textStyles,
      [key]: { ...props.modelValue.textStyles[key], ...patch },
    },
  })
}

/**
 * 「大小(%)」的取值范围按元素区分：副标题与水印都从 1% 起（用户要求能调到极小），
 * 水印上限 300%；其余（Logo / 自定义文字）维持 20–300 不变。
 */
const scaleRange = computed(() => {
  if (props.selected === 'subtitle') return { min: 1, max: 100 }
  if (props.selected === 'watermark') return { min: 1, max: 300 }
  return { min: 20, max: 300 }
})

const canMoveUp = computed(() =>
  activeLayerIndex.value >= 0 && activeLayerIndex.value < props.modelValue.layers.length - 1)
const canMoveDown = computed(() => activeLayerIndex.value > 0)

/** 上移/下移一层：交换图层顺序，只影响遮挡关系 */
function moveLayer(delta: number) {
  const i = activeLayerIndex.value
  const j = i + delta
  const list = [...props.modelValue.layers]
  if (i < 0 || j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item)
  set({ layers: list })
}

/** 重置位置：只把锚点归位，大小与排版样式不动 */
function resetLayout() {
  set({
    layout: defaultAnchors(),
    customElements: props.modelValue.customElements.map((el) => ({
      ...el,
      anchor: { x: 0.5, y: 0.5, scale: 1 },
    })),
  })
}

/**
 * 重置全部数值：与「重置位置」区分——分辨率、位置、大小、字号、字距、弯曲、
 * 旋转、方向、压暗、中缝全部回到出厂值，但保留已输入的文字、图片、渐变与层级。
 * （用户要求单独一个按钮，且重置后每个数值框里都是干净整数）
 */
function resetAllValues() {
  set({
    canvas: { width: REF_W, height: REF_H },
    layout: defaultAnchors(),
    titleFontSize: defaultCoverState().titleFontSize,
    seamGap: CANVAS.SEAM_GAP,
    textStyles: defaultTextStyles(),
    backgroundScrim: CANVAS.BACKGROUND_SCRIM,
    customElements: props.modelValue.customElements.map((el) => ({
      ...el,
      anchor: { x: 0.5, y: 0.5, scale: 1 },
      size: DEFAULT_ELEMENT_SIZE[el.kind],
      rotation: 0,
    })),
  })
}

/* ---------------- 自定义元素录入 ---------------- */

const addKind = ref<CustomKind>('text')
const elementError = ref('')
/** 第三方外发披露:图片外链跨域走了公共代理时置位(与 Logo 导入同一条原则) */
const elementNotice = ref(false)
const busy = ref(false)

let seq = 0
function nextId(): string {
  seq += 1
  return `ce${Date.now().toString(36)}${seq}`
}

/** 自定义元素出厂尺寸：文字按字号、图形按边长；录入与「重置全部数值」共用一份 */
const DEFAULT_ELEMENT_SIZE: Record<CustomKind, number> = { text: 48, image: 160, svg: 160 }

function newElement(kind: CustomKind, patch: Partial<CustomElement> = {}): CustomElement {
  return {
    id: nextId(),
    kind,
    content: '',
    text: kind === 'text' ? '点击下方可编辑文字' : '',
    size: DEFAULT_ELEMENT_SIZE[kind],
    anchor: { x: 0.5, y: 0.5, scale: 1 },
    color: '#ffffff',
    bold: true,
    tracking: 0,
    rotation: 0,
    ...patch,
  }
}

/** 入列即置于最上层，同时把图层键追加到顺序表末尾 */
function appendElement(el: CustomElement) {
  set({
    customElements: [...props.modelValue.customElements, el],
    layers: [...props.modelValue.layers, `custom:${el.id}`],
  })
  emit('select', `custom:${el.id}`)
  elementError.value = ''
}

function updateElement(id: string, patch: Partial<CustomElement>) {
  set({ customElements: props.modelValue.customElements.map((el) => (el.id === id ? { ...el, ...patch } : el)) })
}

function removeElement(id: string) {
  const key = `custom:${id}` as LayerKey
  set({
    customElements: props.modelValue.customElements.filter((el) => el.id !== id),
    layers: props.modelValue.layers.filter((k) => k !== key),
  })
  if (props.selected === key) emit('select', null)
}

const canAdd = computed(() => props.modelValue.customElements.length < MAX_CUSTOM_ELEMENTS)

function addText() {
  if (!canAdd.value) return
  appendElement(newElement('text'))
}

/**
 * 从 Halo 内置的附件输入取图。
 *
 * 该输入的值为 URL 字符串(站内附件是 permalink,也可能是在它里面粘贴的外链);
 * 仍要取回并内嵌为 dataURL,入档形态与本地文件上传完全一致,渲染与导出
 * 无需区分来源。外链跨域时走与 Logo 导入同一条代理兜底,并显式披露第三方外发。
 */
async function onPickAttachmentImage(value: unknown) {
  const link = typeof value === 'string' ? value.trim() : ''
  if (!link || busy.value || !canAdd.value) return
  busy.value = true
  elementError.value = ''
  elementNotice.value = false
  try {
    appendElement(newElement('image', {
      content: await fetchLogoAsDataUrl(link, () => { elementNotice.value = true }),
    }))
  } catch (e) {
    elementError.value = e instanceof Error ? e.message : '附件读取失败'
  } finally {
    busy.value = false
  }
}

/** 任何来源的 SVG 都经同一条白名单过滤后入库 */
function useSvgMarkup(raw: string, patch: Partial<CustomElement> = {}) {
  const result = sanitizeSvgMarkup(raw)
  if (!result.ok) {
    elementError.value = result.reason
    return false
  }
  // 粘贴/上传的标记常把颜色写死在 fill/stroke 上:取回它作为元素颜色,
  // 详情里的取色器才与实际画面一致,后续改色也才有旧色可替换
  const color = firstMarkupColor(result.markup) || '#ffffff'
  appendElement(newElement('svg', { content: result.markup, size: 120, color, ...patch }))
  return true
}

/** 元素取色:svg 的标记需要同步改写,其余元素只改颜色字段 */
function onElementColor(id: string, next: string) {
  const el = props.modelValue.customElements.find((e) => e.id === id)
  if (!el) return
  updateElement(id, {
    color: next,
    content: el.kind === 'svg' ? recolorSvgMarkup(el.content, el.color, next) : el.content,
  })
}

function onPickSvgFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { useSvgMarkup(String(reader.result)) }
  reader.onerror = () => { elementError.value = '文件读取失败，请重试' }
  reader.readAsText(file)
}

/**
 * Halo 内置 Iconify 选择器的回填形态。
 *
 * 未开 valueOnly 时回填该对象(halo 2.26 的 formkit/inputs/iconify/types.ts 里
 * 的 IconifyValue);这里按结构声明而不 import 该类型——它只存在于 Halo 应用
 * 源码中,不在任何可导入的包内。
 */
interface IconifyPick {
  value?: string
  name?: string
  width?: string
  color?: string
}

/**
 * 图标选择器回填。
 *
 * 选择器开的是 `format: "name"`,回填的是图标名(`mdi:home`)而不是标记:
 * 内置的 `format: "svg"` 路径会在确认时按冒号地址下载标记并必然 404
 * (halo 2.26 的 IconConfirmPanel.handleConfirm),所以标记改由这里按正确地址取回。
 * 取回时不带颜色,得到 currentColor 形态,颜色只作为元素状态存在。
 */
async function onIconPicked(pick: unknown) {
  const icon = (typeof pick === 'string' ? { value: pick } : pick) as IconifyPick | null
  const name = (icon?.value || icon?.name || '').trim()
  if (!name) return
  busy.value = true
  elementError.value = ''
  try {
    const result = sanitizeSvgMarkup(await fetchIconSvg(name))
    if (!result.ok) {
      elementError.value = `该图标无法使用:${result.reason}`
      return
    }
    const picked = icon?.color?.trim() ?? ''
    appendElement(
      newElement('svg', {
        content: result.markup,
        size: 120,
        color: HEX6.test(picked) ? picked : '#ffffff',
      }),
    )
  } catch (e) {
    elementError.value = e instanceof Error ? e.message : '图标下载失败'
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
      <button type="button" class="sd-btn-quiet" @click="resetAllValues">重置全部数值</button>
    </div>
    <p class="hint">点元素名选中，方向键微调（Shift 加速）</p>

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
            {{ Math.round(modelValue.layout[key].x * 100) }}% ·
            {{ Math.round(modelValue.layout[key].y * 100) }}% ·
            {{ Math.round(modelValue.layout[key].scale * 100) }}%
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
            <span class="el-meta">{{ el.kind === 'text' ? el.text.slice(0, 8) : `${el.size}px` }}</span>
          </button>
          <button type="button" class="mini danger" aria-label="删除元素" @click="removeElement(el.id)">✕</button>
        </div>
      </li>
    </ul>

    <template v-if="activeAnchor && selected">
      <div class="detail">
        <div class="detail-head">
          <b>{{ selected.startsWith('custom:') ? (activeElement ? KIND_LABEL[activeElement.kind] : '元素') : anchorLabel(selected as AnchorKey) }}</b>
          <span class="spacer"></span>
          <button
            type="button"
            class="sd-btn-quiet mini-btn"
            :disabled="!canMoveDown"
            :aria-label="'下移一层'"
            @click="moveLayer(-1)"
          >
            下移一层
          </button>
          <button
            type="button"
            class="sd-btn-quiet mini-btn"
            :disabled="!canMoveUp"
            :aria-label="'上移一层'"
            @click="moveLayer(1)"
          >
            上移一层
          </button>
        </div>

        <div class="sliders">
          <SliderField
            :model-value="Math.round(activeAnchor.x * 100)"
            :min="0"
            :max="100"
            label="水平"
            suffix="%"
            @update:model-value="setAnchor(selected, { x: $event / 100 })"
          />
          <SliderField
            :model-value="Math.round(activeAnchor.y * 100)"
            :min="0"
            :max="100"
            label="垂直"
            suffix="%"
            @update:model-value="setAnchor(selected, { y: $event / 100 })"
          />
          <SliderField
            v-if="isTitle"
            :model-value="titleSizePercent"
            :min="Math.round((MIN_TITLE_FONT_SIZE / MAX_TITLE_FONT_SIZE) * 100)"
            :max="100"
            label="大小"
            suffix="%"
            @update:model-value="onTitleSizePercent"
          />
          <SliderField
            v-else-if="!activeElement || activeElement.kind === 'text'"
            :model-value="Math.round(activeAnchor.scale * 100)"
            :min="scaleRange.min"
            :max="scaleRange.max"
            :step="1"
            label="大小"
            suffix="%"
            @update:model-value="setAnchor(selected, { scale: $event / 100 })"
          />
        </div>

        <template v-if="activeTextStyle">
          <div class="sub-head">文字排版</div>
          <SliderField
            :model-value="activeTextStyle.tracking"
            :min="TEXT_STYLE_LIMITS.TRACKING_MIN"
            :max="TEXT_STYLE_LIMITS.TRACKING_MAX"
            :step="0.01"
            label="字间距"
            suffix="em"
            @update:model-value="updateTextStyle({ tracking: $event })"
          />
          <SliderField
            :model-value="activeTextStyle.curve"
            :min="TEXT_STYLE_LIMITS.CURVE_MIN"
            :max="TEXT_STYLE_LIMITS.CURVE_MAX"
            :step="5"
            label="弯曲度"
            @update:model-value="updateTextStyle({ curve: $event })"
          />
          <SliderField
            :model-value="activeTextStyle.rotation"
            :min="TEXT_STYLE_LIMITS.ROTATION_MIN"
            :max="TEXT_STYLE_LIMITS.ROTATION_MAX"
            :step="5"
            label="旋转"
            suffix="°"
            @update:model-value="updateTextStyle({ rotation: $event })"
          />
          <div class="dir-row">
            <span class="sf-label">方向</span>
            <div class="seg" role="group" aria-label="文字排列方向">
              <button
                type="button"
                class="seg-btn"
                :class="{ 'is-on': activeTextStyle.direction === 'horizontal' }"
                :aria-pressed="activeTextStyle.direction === 'horizontal'"
                @click="updateTextStyle({ direction: 'horizontal' })"
              >
                横排
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ 'is-on': activeTextStyle.direction === 'vertical' }"
                :aria-pressed="activeTextStyle.direction === 'vertical'"
                @click="updateTextStyle({ direction: 'vertical' })"
              >
                竖排
              </button>
            </div>
          </div>
          <p class="hint">弯曲度仅横排生效；竖排按字号逐字堆叠</p>
        </template>

        <template v-if="activeElement">
          <label v-if="activeElement.kind === 'text'" class="field">
            <span class="lb">文字内容</span>
            <input
              class="sd-field"
              :value="activeElement.text"
              @input="updateElement(activeElement.id, { text: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <div class="sub-row">
            <SliderField
              v-if="activeElement.kind !== 'text'"
              :model-value="activeElement.size"
              :min="sizeRange(activeElement.kind).min"
              :max="sizeRange(activeElement.kind).max"
              label="边长"
              suffix="px"
              @update:model-value="updateElement(activeElement.id, { size: $event })"
            />
          </div>
          <!-- 旋转对所有自定义元素通用：图片/SVG/文字都绕自身锚点转 -->
          <div class="sub-row">
            <SliderField
              :model-value="activeElement.rotation"
              :min="TEXT_STYLE_LIMITS.ROTATION_MIN"
              :max="TEXT_STYLE_LIMITS.ROTATION_MAX"
              :step="5"
              label="旋转"
              suffix="°"
              @update:model-value="updateElement(activeElement.id, { rotation: $event })"
            />
          </div>
          <div class="row2">
            <label v-if="activeElement.kind !== 'image'" class="field">
              <span class="lb">颜色</span>
              <input
                class="sd-field color"
                type="color"
                :value="activeElement.color"
                @input="onElementColor(activeElement.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <!-- 图片与 SVG 的大小由「边长(px)」独家负责:此前与「大小(%)」并存,
                 两者改的是同一个量,面板里出现两条互相打架的滑杆(实机反馈) -->
            <label v-if="activeElement.kind === 'text'" class="tg">
              <input
                type="checkbox"
                :checked="activeElement.bold"
                @change="updateElement(activeElement.id, { bold: ($event.target as HTMLInputElement).checked })"
              />
              加粗
            </label>
          </div>
        </template>
      </div>
    </template>
    <p v-else class="hint">
      选中任一元素后可调整位置、大小与前后层级
    </p>

    <div class="add-sec">
      <div class="lb">添加元素</div>
      <div class="seg" role="group" aria-label="选择要添加的元素类型">
        <button
          v-for="opt in (['text', 'image', 'svg'] as CustomKind[])"
          :key="opt"
          type="button"
          class="seg-btn"
          :class="{ 'is-on': addKind === opt }"
          :aria-pressed="addKind === opt"
          @click="addKind = opt"
        >
          {{ KIND_LABEL[opt] }}
        </button>
      </div>

      <template v-if="addKind === 'text'">
        <button type="button" class="sd-btn-quiet wide" :disabled="!canAdd" @click="addText">
          添加文字元素
        </button>
      </template>

      <template v-else-if="addKind === 'image'">
        <div class="picker-slot">
          <FormKit type="attachment" :accepts="['image/*']" @input="onPickAttachmentImage" />
        </div>
      </template>

      <template v-else>
        <FormKit type="iconify" format="name" @input="onIconPicked" />
        <div class="url-row">
          <label class="sd-btn-quiet upload">
            选择 .svg 文件
            <input class="hidden-file" type="file" accept=".svg,image/svg+xml" @change="onPickSvgFile" />
          </label>
        </div>
      </template>

      <p v-if="elementNotice" class="hint" role="status">
        已通过公共代理 wsrv.nl 获取:该图片链接已发送给第三方服务
      </p>
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

/* 附件库入口:与上方的直链导入行留出间距 */
.picker-slot {
  margin-top: 8px;
}

/* ---- 文字排版分组:与位置/大小区分开,并给方向切换同类标签 ---- */
.sub-head {
  margin: 10px 0 6px;
  font-size: var(--sd-fs-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--sd-text-2);
}

.dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.dir-row .sf-label {
  flex: 0 0 46px;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  white-space: nowrap;
}

.dir-row .seg {
  flex: 1;
}

/* ---- 元素列表:内置与自定义同构,行高一致 ---- */
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
  min-height: 38px;
  padding: 6px 10px 6px 12px;
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
  cursor: default;
}

.el-name {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
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
  flex: 0 0 auto;
}

.el-meta {
  flex: 1;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ---- 选中元素的详情 ---- */
.detail {
  margin-top: 12px;
  padding: 10px;
  background: var(--sd-surface-raised);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-control);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: var(--sd-fs-md);
}

.mini-btn {
  padding: 5px 10px;
  font-size: var(--sd-fs-xs);
}

.sliders {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sub-row {
  margin-top: 8px;
}

.field {
  display: block;
  min-width: 0;
  margin-top: 10px;
}

.lb {
  display: block;
  margin-bottom: 4px;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
}

.row2 {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 10px;
}

.tg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-fs-sm);
  color: var(--sd-text-2);
}

.sd-field.color {
  padding: 2px;
  height: 34px;
}

/* ---- 添加元素:类型为分段选择,动作是独立的按钮 ---- */
.add-sec {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--sd-line);
}

.seg {
  display: flex;
  gap: 4px;
  margin: 8px 0;
  padding: 3px;
  background: var(--sd-surface-control);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-pill);
}

.seg-btn {
  flex: 1;
  padding: 6px 10px;
  font-family: inherit;
  font-size: var(--sd-fs-sm);
  color: var(--sd-text-2);
  background: transparent;
  border: 0;
  border-radius: var(--sd-r-pill);
  cursor: pointer;
  transition:
    color var(--sd-dur-hover) var(--sd-ease),
    background-color var(--sd-dur-hover) var(--sd-ease);
}

.seg-btn:hover {
  color: var(--sd-text);
  background: var(--sd-surface-hover);
}

.seg-btn.is-on {
  color: var(--sd-text-on-accent);
  background: var(--sd-accent-strong);
}

.seg-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sd-focus-ring);
}

.wide {
  width: 100%;
}

.hidden-file {
  display: none;
}

.upload {
  display: inline-block;
  width: 100%;
  text-align: center;
  cursor: pointer;
}

.url-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>