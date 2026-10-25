<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CoverState } from '../lib/types'
import type { SelectionId } from '../composables/useCanvasInteraction'
import type { FontLike } from '../lib/svgBuilder'
import { CANVAS_PRESETS, describeCanvas, presetOfId } from '../lib/canvasPresets'
import { validateLogoUrl, fetchLogoAsDataUrl, fetchAttachmentAsDataUrl } from '../lib/logoFetcher'
import type { AttachmentSummary } from '../api/haloClient'
import AttachmentPicker from './AttachmentPicker.vue'
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

const fileInput = ref<HTMLInputElement>()
const uploadError = ref('')
const logoUrlInput = ref('')
const importing = ref(false)
/** 代理兜底披露(评审 M3):本次导入走了公共代理时置位,界面明示第三方外发 */
const proxyNotice = ref(false)

function set(patch: Partial<CoverState>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

/** 分段控件的缺省选中值:未传入时视为无选中元素 */
const selectedId = computed(() => props.selected ?? null)
/** 当前分辨率描述 */
const canvasText = computed(() => describeCanvas(props.modelValue.canvas))
/** 当前命中的预设 id（自定义尺寸时为 null） */
const activePresetId = computed(() => presetOfId(
  CANVAS_PRESETS.find(
    (c) => c.width === props.modelValue.canvas.width && c.height === props.modelValue.canvas.height,
  )?.id ?? '',
)?.id ?? null)

function applyPreset(id: string) {
  const preset = presetOfId(id)
  if (!preset) return
  set({ canvas: { width: preset.width, height: preset.height } })
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = '' // 重置选择器:被拒后可重选同一文件再次触发 change
  if (!f) return
  if (!f.type.startsWith('image/')) {
    uploadError.value = '仅支持图片文件'
    return
  }
  if (f.size > 2 * 1024 * 1024) {
    uploadError.value = '图片不能超过 2 MB'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    set({ logoDataUrl: String(reader.result) })
    uploadError.value = ''
  }
  // 读取失败(文件被删/占用/磁盘错误)必须显式反馈,与「静默失败显式化」原则一致(评审M7)
  reader.onerror = () => {
    uploadError.value = '图片读取失败，请重试'
  }
  reader.readAsDataURL(f)
}

async function importFromUrl() {
  if (importing.value) return // 防重入:导入进行中忽略 Enter 与重复点击
  const invalid = validateLogoUrl(logoUrlInput.value)
  if (invalid) {
    uploadError.value = invalid
    return
  }
  importing.value = true
  uploadError.value = ''
  proxyNotice.value = false
  try {
    const dataUrl = await fetchLogoAsDataUrl(logoUrlInput.value.trim(), () => {
      proxyNotice.value = true
    })
    set({ logoDataUrl: dataUrl })
    uploadError.value = ''
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : '导入失败'
  } finally {
    importing.value = false
  }
}

/** 恢复默认 Logo:有内置默认则回退到默认图,无(设置 logoUrl 为空)则直接隐藏 */
function restoreDefaultLogo() {
  set({ logoDataUrl: null, logoHidden: !props.defaultLogoUrl })
}

const attachmentBusy = ref(false)

/** 从博客附件选图:取回并内嵌为 dataURL,与上传/链接导入同一条自包含边界 */
async function onPickAttachment(attachment: AttachmentSummary) {
  if (attachmentBusy.value) return
  attachmentBusy.value = true
  uploadError.value = ''
  try {
    set({ logoDataUrl: await fetchAttachmentAsDataUrl(attachment.link) })
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : '附件读取失败'
  } finally {
    attachmentBusy.value = false
  }
}

/** 当前生效 Logo(缩略图展示与预览同源:自定义优先,回退内置默认) */
function currentLogoSrc() {
  return props.modelValue.logoDataUrl || props.defaultLogoUrl || ''
}

/** 媒体字段文案:按「自定义 / 内置默认 / 空」三态给主副文案 */
const mediaMain = computed(() =>
  props.modelValue.logoDataUrl || props.defaultLogoUrl ? '替换图片' : '上传图片',
)
const mediaSub = computed(() => {
  if (props.modelValue.logoDataUrl) return '当前为自定义 Logo'
  if (props.defaultLogoUrl) return '当前为内置默认 Logo'
  return 'PNG / JPG / SVG,≤ 2 MB'
})
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

    <div class="eyebrow">画布</div>
    <section class="card">
      <div class="lb"><b>分辨率</b><span class="meta">换比例不会丢内容</span></div>
      <div class="presets" role="group" aria-label="画布分辨率">
        <button
          v-for="preset in CANVAS_PRESETS"
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
    </section>

    <div class="eyebrow">内容</div>
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

    <div class="eyebrow">外观</div>
    <GradientPicker
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    ></GradientPicker>

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

      <!-- 上传:整行可点击的媒体字段(复用 sd-field 外壳;div 仅键盘聚焦出环) -->
      <div
        class="media-field sd-field"
        role="button"
        tabindex="0"
        aria-label="上传或替换 Logo 图片"
        @click="fileInput?.click()"
        @keydown.enter.prevent="fileInput?.click()"
        @keydown.space.prevent="fileInput?.click()"
      >
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
        <span
          class="logo-thumb"
          :style="currentLogoSrc() ? { backgroundImage: `url(${currentLogoSrc()})` } : undefined"
        >
          <span v-if="!currentLogoSrc()" class="logo-mark" aria-hidden="true"></span>
        </span>
        <span class="media-text">
          <b>{{ mediaMain }}</b>
          <small>{{ mediaSub }}</small>
        </span>
        <span class="media-go" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M7 9.6V2.6M4.4 5.2 7 2.6l2.6 2.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M2.4 9.8v1a1.4 1.4 0 0 0 1.4 1.4h6.4a1.4 1.4 0 0 0 1.4-1.4v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          浏览
        </span>
      </div>
      <!-- 链接导入:常驻输入框,不藏在文字链后面 -->
      <div class="url-label">从图片链接导入</div>
      <div class="row2 url-row">
        <input
          v-model="logoUrlInput"
          class="sd-field sd-field--mono"
          placeholder="粘贴图床直链 https://…"
          aria-label="Logo 图片链接"
          @keydown.enter="importFromUrl"
        />
        <button type="button" class="sd-btn-quiet" :disabled="importing" @click="importFromUrl">
          {{ importing ? '导入中…' : '导入' }}
        </button>
      </div>
      <!-- 附件库:站内已上传的图直接选,不必先下载再本地上传 -->
      <div class="picker-slot">
        <AttachmentPicker @pick="onPickAttachment" />
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
  box-shadow: 0 0 10px rgb(253 160 133 / 55%);
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

/* 媒体字段:整行可点击(sd-field 外壳走共享类),此处只管布局 */
.media-field {
  display: flex;
  align-items: center;
  gap: var(--pit-sp-3);
  cursor: pointer;
}
.logo-thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--sd-r-small);
  background-color: var(--sd-surface-panel);
  background-size: cover;
  background-position: center;
  box-shadow: 0 0 0 1px var(--sd-line) inset;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}
.logo-mark {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--sd-accent);
  opacity: 0.85;
}
.media-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.media-text b {
  font-size: var(--sd-fs-md);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.media-text small {
  font-size: var(--sd-fs-sm);
  color: var(--sd-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-fs-md);
  font-weight: 600;
  color: var(--sd-text-accent);
  flex: 0 0 auto;
}

/* 链接导入:常驻输入行,标签与渐变卡分组标题同规格 */
.url-label {
  margin: var(--pit-sp-3) 0 var(--pit-sp-1);
  font-size: var(--sd-fs-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--sd-text-2);
}
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

/* ---- 提示文本 ---- */
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
