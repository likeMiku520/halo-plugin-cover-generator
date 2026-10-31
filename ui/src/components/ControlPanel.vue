<script setup lang="ts">
import { computed, ref } from 'vue'
import { FormKit } from '@formkit/vue'
import type { CoverState } from '../lib/types'
import type { SelectionId } from '../composables/useCanvasInteraction'
import type { FontLike } from '../lib/svgBuilder'
import { adoptCoverState } from '../composables/useCoverState'
import { CANVAS_PRESETS, CUSTOM_CANVAS_PRESET, describeCanvas, presetOfId } from '../lib/canvasPresets'
import { CANVAS, CANVAS_SIDE_MAX, CANVAS_SIDE_MIN } from '../lib/layout'
import { fetchLogoAsDataUrl } from '../lib/logoFetcher'
import {
  SCHEME_NAME_MAX,
  deleteScheme,
  findScheme,
  formatSchemeTime,
  listSchemes,
  saveScheme,
  type SavedScheme,
} from '../lib/schemes'
import GradientPicker from './GradientPicker.vue'
import ElementsPanel from './ElementsPanel.vue'
import SliderField from './SliderField.vue'

/**
 * 控制面板(评审 V2/S1):承担「画布 + 内容 + 外观 + 元素」四组输入;
 * 导出/保存/绑定动作整体移至 OutputBar(预览下方)。
 * 分区以 eyebrow 眉标划分,替代原先六张等权卡片的连续滚动。
 */
const props = defineProps<{
  modelValue: CoverState
  /** 插件设置提供的默认 Logo(空串 = 无内置默认);缩略图与「恢复默认」回退依据 */
  defaultLogoUrl: string
  /** 字体加载状态(C3):loading 时头部明示,不再让导出按钮静默禁用 */
  fontStatus: 'loading' | 'ready' | 'error'
  /** 预览区当前选中的元素(与画布选中态双向联动);缺省表示无选中 */
  selected?: SelectionId | null
  /** 已加载字体：元素面板需要用它度量文本以显示准确的选中框 */
  font?: FontLike | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: CoverState): void
  (e: 'select', id: SelectionId | null): void
}>()

const uploadError = ref('')
/** 代理兜底披露(评审 M3):本次导入走了公共代理时置位,界面明示第三方外发 */
const proxyNotice = ref(false)

/** ---- 方案:当前全部参数的命名快照 ---- */
// 初始化即读:列表是首帧就要显示的持久数据,放到 onMounted 会先闪一下空态
const schemes = ref<SavedScheme[]>(listSchemes())
const schemeName = ref('')
const schemeNotice = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)
const schemeNoticeText = computed(() => schemeNotice.value?.text ?? '')
const schemeNoticeIsError = computed(() => schemeNotice.value?.kind === 'error')

/** 列表以模块返回的「已落盘内容」为准,避免内存视图与 localStorage 分叉 */
function refreshSchemes() {
  schemes.value = listSchemes()
}

function notifyScheme(kind: 'ok' | 'error', text: string) {
  schemeNotice.value = { kind, text }
}

function onSaveScheme() {
  const result = saveScheme(schemeName.value, props.modelValue)
  schemes.value = result.schemes
  if (!result.ok) {
    notifyScheme('error', result.message)
    return
  }
  // 保存成功后清空输入,下一次保存的默认动作是「新方案」而不是再次覆盖
  schemeName.value = ''
  notifyScheme('ok', result.message)
}

/**
 * 载入 = 整份状态替换。方案与存档一样是可能被手工编辑过的 JSON,
 * 必须经 adoptCoverState 收敛后再交给受控组件外抛。
 */
function onLoadScheme(id: string) {
  const scheme = findScheme(id)
  if (!scheme) {
    refreshSchemes()
    notifyScheme('error', '方案不存在或已损坏，可能已被删除')
    return
  }
  const { state, repaired } = adoptCoverState(scheme.state)
  emit('update:modelValue', state)
  notifyScheme(
    'ok',
    repaired ? `已载入「${scheme.name}」，并修正了其中无效的设置` : `已载入「${scheme.name}」`,
  )
}

function onDeleteScheme(id: string) {
  const result = deleteScheme(id)
  schemes.value = result.schemes
  notifyScheme(result.ok ? 'ok' : 'error', result.message)
}

function set(patch: Partial<CoverState>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

/** 分段控件的缺省选中值:未传入时视为无选中元素 */
const selectedId = computed(() => props.selected ?? null)
/** 当前分辨率描述 */
const canvasText = computed(() => describeCanvas(props.modelValue.canvas))
/**
 * 当前选中的分辨率模式。
 *
 * 直接读 state.canvasPresetId，而不是按尺寸反查：1200×675 既可能是「宽屏」预设、
 * 也可能是用户自定义填的同一组数字，只看尺寸没法把选中态画对。
 */
const activePresetId = computed(() => props.modelValue.canvasPresetId)
/** 预设 + 自定义：自定义排在最后，语义上不是「又一个比例」 */
const presetOptions = [...CANVAS_PRESETS, CUSTOM_CANVAS_PRESET]
const isCustomCanvas = computed(() => activePresetId.value === CUSTOM_CANVAS_PRESET.id)

function applyPreset(id: string) {
  if (id === CUSTOM_CANVAS_PRESET.id) {
    // 切到自定义时保留当前尺寸：用户多半是想在现有比例上微调，而不是跳回出厂值
    set({ canvasPresetId: CUSTOM_CANVAS_PRESET.id })
    return
  }
  const preset = presetOfId(id)
  if (!preset) return
  set({ canvas: { width: preset.width, height: preset.height }, canvasPresetId: preset.id })
}

/** 自定义宽高：越界只夹住这一边，不把另一边的值一起冲掉 */
function setCustomCanvas(which: 'width' | 'height', raw: number) {
  if (!Number.isFinite(raw)) return
  const v = Math.min(CANVAS_SIDE_MAX, Math.max(CANVAS_SIDE_MIN, Math.round(raw)))
  set({
    canvas: { ...props.modelValue.canvas, [which]: v },
    canvasPresetId: CUSTOM_CANVAS_PRESET.id,
  })
}

const backgroundBusy = ref(false)

/**
 * 背景图:值来自 Halo 内置的附件输入(URL 字符串),取回后内嵌为 dataURL。
 * 输入被清空(用户移除图片)时回到渐变模式,避免留下「图片模式却没有图」的状态。
 */
async function onPickBackground(value: unknown) {
  const link = typeof value === 'string' ? value.trim() : ''
  if (!link) {
    set({ backgroundImage: null, backgroundMode: 'gradient' })
    return
  }
  if (backgroundBusy.value) return
  backgroundBusy.value = true
  uploadError.value = ''
  proxyNotice.value = false
  try {
    set({
      backgroundImage: await fetchLogoAsDataUrl(link, () => { proxyNotice.value = true }),
      backgroundMode: 'image',
    })
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : '背景图读取失败'
  } finally {
    backgroundBusy.value = false
  }
}

/** 恢复默认 Logo:有内置默认则回退到默认图,无(设置 logoUrl 为空)则直接隐藏 */
function restoreDefaultLogo() {
  set({ logoDataUrl: null, logoHidden: !props.defaultLogoUrl })
}

const attachmentBusy = ref(false)

/**
 * 从 Halo 内置的附件输入取图。
 *
 * 该输入的值为 URL 字符串(站内附件是 permalink,也可能是在它里面粘贴的外链),
 * 仍要取回并内嵌为 dataURL:导出 SVG 必须自包含,存档也只接受 data:image/*。
 * 外链跨域时沿用 Logo 链接导入同一条代理兜底,并同步置位第三方外发披露。
 */
async function onPickAttachment(value: unknown) {
  const link = typeof value === 'string' ? value.trim() : ''
  if (!link || attachmentBusy.value) return
  attachmentBusy.value = true
  uploadError.value = ''
  proxyNotice.value = false
  try {
    set({ logoDataUrl: await fetchLogoAsDataUrl(link, () => { proxyNotice.value = true }) })
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : '附件读取失败'
  } finally {
    attachmentBusy.value = false
  }
}

</script>

<template>
  <aside class="panel">
    <header class="p-head">
      <span class="dot" aria-hidden="true"></span>
      <b>封面生成器</b>
      <span class="dim">{{ canvasText }}</span>
      <span class="spacer"></span>
      <span v-if="fontStatus === 'loading'" class="meta font-status">字体加载中…</span>
      <span v-else-if="fontStatus === 'error'" class="meta font-status is-error">字体不可用</span>
    </header>

    <!-- 方案放在最顶部:它操作的是「整份参数」,层级高于下面任何单个分区 -->
    <div class="eyebrow">方案</div>
    <section class="card" aria-label="方案">
      <div class="lb">
        <b>方案名</b>
        <span class="meta">最多 {{ SCHEME_NAME_MAX }} 字 · 同名覆盖</span>
      </div>
      <div class="scheme-save">
        <input
          v-model="schemeName"
          class="sd-field"
          type="text"
          :maxlength="SCHEME_NAME_MAX"
          placeholder="例如：周报封面"
          aria-label="方案名"
          @keydown.enter.prevent="onSaveScheme"
        />
        <button type="button" class="sd-btn-quiet" aria-label="保存当前方案" @click="onSaveScheme">
          保存当前方案
        </button>
      </div>
      <p
        v-if="schemeNoticeText"
        class="scheme-notice"
        :class="{ 'is-error': schemeNoticeIsError }"
        role="status"
      >
        {{ schemeNoticeText }}
      </p>
      <p v-if="!schemes.length" class="hint">还没有保存的方案</p>
      <ul v-else class="scheme-list" aria-label="已保存方案">
        <li v-for="scheme in schemes" :key="scheme.id" class="scheme-item">
          <div class="scheme-info">
            <b class="scheme-name" :title="scheme.name">{{ scheme.name }}</b>
            <span class="meta scheme-time">{{ formatSchemeTime(scheme.savedAt) }}</span>
          </div>
          <div class="scheme-actions">
            <button
              type="button"
              class="sd-btn-ghost"
              :aria-label="`载入方案 ${scheme.name}`"
              @click="onLoadScheme(scheme.id)"
            >
              载入
            </button>
            <button
              type="button"
              class="sd-btn-ghost"
              :aria-label="`删除方案 ${scheme.name}`"
              @click="onDeleteScheme(scheme.id)"
            >
              删除
            </button>
          </div>
        </li>
      </ul>
    </section>

    <div class="eyebrow">画布</div>
    <section class="card">
      <div class="lb"><b>分辨率</b><span class="meta">换比例不会丢内容</span></div>
      <div class="presets" role="group" aria-label="画布分辨率">
        <button
          v-for="preset in presetOptions"
          :key="preset.id"
          type="button"
          class="preset"
          :class="{ 'is-on': activePresetId === preset.id }"
          :aria-pressed="activePresetId === preset.id"
          :title="`${preset.width} × ${preset.height}`"
          @click="applyPreset(preset.id)"
        >
          <span class="preset-label">{{ preset.label }}</span>
          <span class="preset-ratio">{{ preset.ratio }}</span>
        </button>
      </div>
      <!-- 自定义宽高：只在选中「自定义」时出现，避免八个预设旁边常驻两个输入框 -->
      <div v-if="isCustomCanvas" class="row2 custom-size">
        <label class="field">
          <span class="lb">宽</span>
          <input
            class="sd-field"
            type="number"
            :min="CANVAS_SIDE_MIN"
            :max="CANVAS_SIDE_MAX"
            :value="modelValue.canvas.width"
            aria-label="自定义画布宽度"
            @change="setCustomCanvas('width', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <label class="field">
          <span class="lb">高</span>
          <input
            class="sd-field"
            type="number"
            :min="CANVAS_SIDE_MIN"
            :max="CANVAS_SIDE_MAX"
            :value="modelValue.canvas.height"
            aria-label="自定义画布高度"
            @change="setCustomCanvas('height', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>

      <label class="tg">
        <input
          type="checkbox"
          :checked="modelValue.smartGuides"
          @change="set({ smartGuides: ($event.target as HTMLInputElement).checked })"
        />
        智能参考线
      </label>
      <p class="hint">拖动元素时显示画布中线与其他元素的对齐线，并自动吸附</p>
    </section>

    <div class="eyebrow">文字内容</div>
    <section class="card">
      <div class="lb"><b>标题</b><span class="meta">{{ modelValue.titleMode === 'split' ? '左 │ 右' : '整块自动换行' }}</span></div>
      <div class="seg" role="group" aria-label="标题排版模式">
        <button
          type="button"
          class="seg-btn"
          :class="{ 'is-on': modelValue.titleMode === 'split' }"
          :aria-pressed="modelValue.titleMode === 'split'"
          @click="set({ titleMode: 'split' })"
        >
          左右分缝
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ 'is-on': modelValue.titleMode === 'flow' }"
          :aria-pressed="modelValue.titleMode === 'flow'"
          @click="set({ titleMode: 'flow' })"
        >
          整块排版
        </button>
      </div>

      <!-- 两种排版各有独立文本:切换模式不会互相覆盖,方便来回比较 -->
      <div v-if="modelValue.titleMode === 'split'" class="row2">
        <input
          :value="modelValue.titleLeft"
          class="sd-field"
          placeholder="左段"
          aria-label="标题左段"
          @input="set({ titleLeft: ($event.target as HTMLInputElement).value })"
        />
        <input
          :value="modelValue.titleRight"
          class="sd-field"
          placeholder="右段"
          aria-label="标题右段"
          @input="set({ titleRight: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <input
        v-else
        :value="modelValue.titleFlow"
        class="sd-field full"
        placeholder="整块标题，超宽自动换行"
        aria-label="整块标题"
        @input="set({ titleFlow: ($event.target as HTMLInputElement).value })"
      />

      <template v-if="modelValue.titleMode === 'split'">
        <div class="lb pad-top"><b>中缝间距</b><span class="meta">左右两段的距离</span></div>
        <SliderField
          :model-value="modelValue.seamGap"
          :min="0"
          :max="400"
          :step="4"
          label="中缝间距"
          suffix="px"
          @update:model-value="set({ seamGap: $event })"
        />
      </template>

      <!-- 标题字号已收敛到「元素 → 标题 → 大小」单一入口:
           两处数值控件操作同一个量时,在任一处拖动另一处不同步,读起来像「拖了没反应」 -->

      <!-- 副标题/域名水印:短文本字段与标题列同构的双列布局,不撑满整行(实机反馈) -->
      <div class="row2 pad-top">
        <div class="field">
          <div class="lb"><b>副标题</b><span class="meta">可选</span></div>
          <input
            :value="modelValue.subtitle"
            class="sd-field"
            placeholder="留空则不显示"
            aria-label="副标题"
            @input="set({ subtitle: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <div class="field">
          <div class="lb"><b>域名水印</b><span class="meta">默认右下</span></div>
          <input
            :value="modelValue.watermark"
            class="sd-field"
            placeholder="example.com"
            aria-label="域名水印"
            @input="set({ watermark: ($event.target as HTMLInputElement).value })"
          />
        </div>
      </div>
    </section>

    <div class="eyebrow">背景</div>
    <section class="card">
      <div class="lb">
        <b>背景</b>
        <span class="meta">{{ modelValue.backgroundMode === 'gradient' ? '渐变' : '图片' }}</span>
      </div>
      <div class="seg" role="group" aria-label="背景模式">
        <button
          type="button"
          class="seg-btn"
          :class="{ 'is-on': modelValue.backgroundMode === 'gradient' }"
          :aria-pressed="modelValue.backgroundMode === 'gradient'"
          @click="set({ backgroundMode: 'gradient' })"
        >
          渐变
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ 'is-on': modelValue.backgroundMode === 'image' }"
          :aria-pressed="modelValue.backgroundMode === 'image'"
          @click="set({ backgroundMode: 'image' })"
        >
          图片
        </button>
      </div>

      <template v-if="modelValue.backgroundMode === 'image'">
        <!-- Halo 自带三合一:上传 / 附件库 / 输入链接 -->
        <div class="picker-slot">
          <FormKit type="attachment" :accepts="['image/*']" @input="onPickBackground" />
        </div>
        <p v-if="backgroundBusy" class="hint" role="status">正在读取背景图…</p>
        <div class="lb pad-top"><b>压暗</b><span class="meta">让标题在照片上仍读得清</span></div>
        <SliderField
          :model-value="modelValue.backgroundScrim"
          :min="0"
          :max="CANVAS.BACKGROUND_SCRIM_MAX"
          :step="5"
          label="背景压暗"
          suffix="%"
          @update:model-value="set({ backgroundScrim: $event })"
        />
      </template>
    </section>

    <GradientPicker
      v-if="modelValue.backgroundMode === 'gradient'"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    ></GradientPicker>

    <!-- Logo 与背景同属「铺底」，但两者互不相关：挤在同一个「外观」分区里
         会让人以为 Logo 属于背景设置，因此各给一个分区标题 -->
    <div class="eyebrow">Logo</div>
    <section class="card">
      <div class="logo-head">
        <b>Logo</b>
        <span class="state">{{ modelValue.logoHidden ? '已隐藏' : '显示中' }}</span>
        <span class="spacer"></span>
        <button v-if="modelValue.logoDataUrl" type="button" class="sd-btn-ghost" @click="restoreDefaultLogo">
          恢复默认
        </button>
        <button
          type="button"
          class="switch"
          role="switch"
          :aria-checked="!modelValue.logoHidden"
          aria-label="显示或隐藏 Logo"
          @click="set({ logoHidden: !modelValue.logoHidden })"
        ></button>
      </div>

      <!-- 图片来源只保留 Halo 自带三合一(上传 / 附件库 / 输入链接):
           插件自绘的上传字段与「从图片链接导入」做的是同一件事的第二、第三个入口,
           三处并存时用户得先判断该用哪个,入口本身反而成了负担 -->
      <div class="picker-slot">
        <FormKit type="attachment" :accepts="['image/*']" @input="onPickAttachment" />
      </div>
      <p v-if="attachmentBusy" class="hint" role="status">正在读取附件图片…</p>
      <p class="hint">上传或链接导入的图都会转 Base64 内嵌(≤ 2 MB),导出的 SVG 不依赖外链,单文件可用</p>
      <p v-if="proxyNotice" class="hint proxy-notice" role="status">
        已通过公共代理 wsrv.nl 获取:图片链接已发送给第三方服务
      </p>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>
    </section>

    <div class="eyebrow">元素</div>
    <ElementsPanel
      :model-value="modelValue"
      :selected="selectedId"
      :font="font ?? null"
      @update:model-value="emit('update:modelValue', $event)"
      @select="emit('select', $event)"
    ></ElementsPanel>
  </aside>
</template>

<style scoped>
/* ---- 毛玻璃面板(外壳)---- */
.panel {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--pit-sp-4);
  padding: var(--pit-sp-6) var(--pit-sp-6) var(--pit-sp-5);
  border-radius: var(--sd-r-panel);
  background: var(--sd-surface-panel);
  -webkit-backdrop-filter: blur(28px) saturate(170%);
  backdrop-filter: blur(28px) saturate(170%);
  border: 1px solid var(--sd-edge-bright);
  border-top-color: var(--sd-edge-bright-strong);
  box-shadow:
    var(--sd-shadow-panel),
    inset 0 1px 0 var(--sd-edge-hairline);
  animation: sd-rise var(--sd-dur-enter) var(--sd-ease) both;
}

/* ---- 分组卡(内芯,与外壳同心圆角);错峰延迟走 token(H2)---- */
.card {
  background: var(--sd-surface-card);
  border-radius: var(--sd-r-card);
  border: 1px solid var(--sd-edge-hairline);
  box-shadow: var(--sd-shadow-card);
  padding: var(--pit-sp-4);
  animation: sd-rise var(--sd-dur-enter) var(--sd-ease) both;
}
.card:nth-of-type(1) {
  animation-delay: var(--sd-delay-1);
}
.card:nth-of-type(2) {
  animation-delay: var(--sd-delay-2);
}

/* ---- 任务分区眉标(V2:S1)---- */
.eyebrow {
  margin: 2px 2px -6px;
  font-size: var(--sd-fs-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--sd-text-2);
}

/* ---- 面板头 ---- */
.p-head {
  display: flex;
  align-items: center;
  gap: var(--pit-sp-2);
  animation: sd-rise var(--sd-dur-enter) var(--sd-ease) both;
}
.p-head b {
  font-size: var(--sd-fs-lg);
  font-weight: 700;
  letter-spacing: -0.022em; /* 大字号负字距 */
}
.p-head .dim {
  font-size: var(--sd-fs-sm);
  color: var(--sd-text-2);
  font-variant-numeric: tabular-nums;
}
.p-head .spacer { flex: 1; }
.font-status { color: var(--sd-text-2); }
.font-status.is-error { color: var(--sd-danger-text); }
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--sd-accent-dot);
  align-self: center;
  box-shadow: 0 0 10px rgb(57 197 187 / 55%);
}

/* ---- 标签行 ---- */
.lb {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--pit-sp-2);
}
.lb.pad-top {
  margin-top: var(--pit-sp-4);
}

/* 附件库入口:与上方的链接导入行留出间距 */
.picker-slot {
  margin-top: 8px;
}
.lb b {
  font-size: var(--sd-fs-md);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.meta {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  font-variant-numeric: tabular-nums;
}

/* ---- 分辨率预设:小卡片网格,当前项以主题青实底标出 ---- */
.presets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.preset {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
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

.preset:hover {
  border-color: var(--sd-accent);
  background: var(--sd-surface-hover);
}

.preset.is-on {
  color: var(--sd-text-on-accent);
  background: var(--sd-accent-strong);
  border-color: var(--sd-accent-strong);
}

.preset-label {
  font-size: var(--sd-fs-sm);
  font-weight: 600;
}

.preset-ratio {
  font-size: var(--sd-fs-xs);
  opacity: 0.75;
}

.preset:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sd-focus-ring);
}

/* ---- 输入控件 ---- */
/* 字段外壳走共享类 sd-field(tokens.css);此处只管布局 */
.row2 {
  display: flex;
  gap: var(--pit-sp-2);
}

/* ---- 标题排版模式分段控件 ---- */
.seg {
  display: flex;
  gap: 4px;
  margin: 6px 0 8px;
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
  transition: color var(--sd-dur-hover) var(--sd-ease),
    background-color var(--sd-dur-hover) var(--sd-ease);
}

.seg-btn:hover {
  color: var(--sd-text);
}

.seg-btn.is-on {
  color: var(--sd-text-on-accent);
  background: var(--sd-accent-strong);
}

.seg-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sd-focus-ring);
}
.row2 input {
  flex: 1;
  min-width: 0;
}

/* 整块标题输入独占一行 */
.sd-field.full {
  width: 100%;
}
.row2.pad-top {
  margin-top: var(--pit-sp-4);
}
/* 副标题/域名水印双列:与标题左右两列同宽同构(实机反馈) */
.field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.field .lb {
  margin-bottom: var(--pit-sp-2);
}

/* ---- 滑杆(iOS 材质:蓝填充 + 白浮钮);控件高 24px 保证点击目标(D1)---- */
.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 24px;
  border: none;
  border-radius: var(--sd-r-pill);
  /* 4px 轨道画在 24px 控件中线:视觉不变,命中区扩到整条 */
  background: linear-gradient(
      90deg,
      var(--sd-accent) var(--fill, 100%),
      var(--sd-line) var(--fill, 100%)
    )
    left center / 100% 4px no-repeat;
  padding: 0;
  margin: 0;
  cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--sd-surface-thumb);
  border: 0.5px solid rgb(0 0 0 / 4%);
  box-shadow: var(--sd-shadow-thumb);
  transition: transform var(--sd-dur-move) var(--sd-ease);
}
.slider::-webkit-slider-thumb:hover {
  transform: scale(1.08);
}
.slider::-webkit-slider-thumb:active {
  transform: scale(1.16);
}
.slider:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--sd-focus-ring);
}

/* ---- 按钮两级走共享类 sd-btn-quiet / sd-btn-ghost(tokens.css),此处无本地样式 ---- */

/* ---- Logo 卡(A2 打磨):头部只留标题/状态/开关,主体是单槽位媒体字段 ---- */
.logo-head {
  display: flex;
  align-items: center;
  gap: var(--pit-sp-2);
  margin-bottom: var(--pit-sp-2);
}
.logo-head b {
  font-size: var(--sd-fs-md);
  font-weight: 600;
}
.logo-head .state {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
}
.logo-head .spacer { flex: 1; }

.switch {
  width: 40px;
  height: 24px;
  border: none;
  border-radius: var(--sd-r-pill);
  background: rgb(120 120 128 / 32%);
  position: relative;
  cursor: pointer;
  padding: 0;
  flex: 0 0 auto;
  transition: background var(--sd-dur-hover) var(--sd-ease);
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--sd-surface-thumb);
  box-shadow: var(--sd-shadow-thumb);
  transition: transform var(--sd-dur-move) var(--sd-ease);
}
.switch[aria-checked='true'] {
  background: var(--sd-accent);
}
.switch[aria-checked='true']::after {
  transform: translateX(16px);
}
.switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--sd-focus-ring);
}

/* ---- 方案卡:命名快照的保存 / 列表 / 载入 / 删除 ---- */
.scheme-save {
  display: flex;
  gap: var(--pit-sp-2);
  align-items: stretch;
}
.scheme-save input {
  flex: 1;
  min-width: 0;
}
.scheme-notice {
  margin: var(--pit-sp-2) 0 0;
  font-size: var(--sd-fs-sm);
  line-height: 1.5;
  color: var(--sd-text-2);
}
.scheme-notice.is-error {
  color: var(--sd-danger-text);
}
.scheme-list {
  list-style: none;
  margin: var(--pit-sp-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scheme-item {
  display: flex;
  align-items: center;
  gap: var(--pit-sp-2);
  padding: 6px 8px;
  background: var(--sd-surface-raised);
  border: 1px solid var(--sd-line);
  border-radius: var(--sd-r-control);
}
.scheme-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--pit-sp-2);
}
.scheme-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--sd-fs-sm);
  font-weight: 600;
  color: var(--sd-text);
}
.scheme-time {
  flex: 0 0 auto;
}
.scheme-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
}
/* 行内小按钮:沿用 sd-btn-ghost 的材质,只收紧尺寸 */
.scheme-actions button {
  padding: 4px 8px;
  font-size: var(--sd-fs-xs);
}

/* ---- 提示文本 ---- */
/* 复选行：与输入框同一套排版语汇（小标签 + 控件） */
.tg {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: var(--sd-fs-sm);
  color: var(--sd-text);
  cursor: pointer;
}

.tg input {
  accent-color: var(--sd-accent);
}

.custom-size {
  margin-top: 10px;
}

.hint {
  color: var(--sd-text-2);
  font-size: var(--sd-fs-sm);
  line-height: 1.55;
  margin: var(--pit-sp-2) 0 0;
}
/* 代理披露:第三方外发须可感知,弱于错误但区别于普通 hint(评审 M3) */
.proxy-notice {
  color: var(--sd-text);
  border-left: 2px solid var(--sd-line-strong);
  padding-left: var(--pit-sp-2);
}
.error {
  color: var(--sd-danger-text);
  font-size: var(--sd-fs-sm);
  line-height: 1.5;
  margin: var(--pit-sp-2) 0 0;
}
</style>
