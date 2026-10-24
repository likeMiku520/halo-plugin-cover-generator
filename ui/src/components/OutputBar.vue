<script setup lang="ts">
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue'
import type { PostSummary } from '../api/haloClient'
import PostPicker from './PostPicker.vue'
import { useDismiss } from '../composables/useDismiss'

/**
 * 输出动作条(评审 V2/S1):导出、保存、绑定动作整体移出左面板,
 * 贴着预览窗落位——动作与结果同处一屏,面板回归纯「内容 + 外观」表单。
 *
 * 智能保存(S2):未选文章 = 「保存到附件」;选中文章后主按钮变
 * 「保存并绑定」,另给「仅保存」次级出口。上传/绑定两条
 * 链路逻辑原样留在工作台,本组件只管触发与呈现反馈。
 */
const props = defineProps<{
  /** 字体就绪且有标题才可导出(与原 canExport 契约一致) */
  canExport: boolean
  /** 字体加载失败的中文原因(导出禁用时展示) */
  fontError: string
  /** PNG 导出进行中(C2:按钮防重入) */
  exporting: boolean
  exportError: string
  /** 当前封面摘要(尺寸/预设/字号),仅展示 */
  summary: string
  copySuccess: string
  copyError: string
  saving: boolean
  saveError: string
  savePermalink: string
  /** 相对 permalink 解析后的绝对地址(仅展示链接用) */
  permalinkHref: string
  selectedPost: PostSummary | null
  binding: boolean
  bindError: string
  bindSuccess: string
  /** 下载动作成功反馈:'svg'/'png' 短暂置位,父组件 2.5s 后清空 */
  downloadFlash: '' | 'svg' | 'png'
}>()
const emit = defineEmits<{
  (e: 'update:selectedPost', v: PostSummary | null): void
  (e: 'export-svg'): void
  (e: 'export-png', scale?: number): void
  (e: 'copy-svg'): void
  (e: 'save'): void
  (e: 'save-only'): void
}>()

/** C2:本地下传 PNG 倍率(1 = 标准,2 = 2x 高清);保存到附件恒为 1x */
const pngScale = ref(1)
const pngMenuOpen = ref(false)
/** caret 触发件:菜单经 Esc 关闭时把焦点还给触发钮(B3) */
const caretBtn = ref<HTMLButtonElement>()
const splitEl = ref<HTMLElement>()
useDismiss(splitEl, pngMenuOpen, (reason) => {
  pngMenuOpen.value = false
  if (reason === 'escape') caretBtn.value?.focus()
})
function pickPngScale(v: number) {
  pngScale.value = v
  pngMenuOpen.value = false
}
/** 主按钮点击按当前倍率导出,并收起尚开着的角度菜单(B3) */
function exportPng() {
  pngMenuOpen.value = false
  emit('export-png', pngScale.value)
}

/** PNG 菜单键盘契约(M10,ARIA menu):caret 上 ↓/↑ 开菜单并聚焦首/末项,
 *  菜单内 ↓/↑ 循环移动、Home/End 跳首末(与 PostPicker 的键盘可达性对齐) */
function focusMenuEdge(last: boolean) {
  const items = splitEl.value?.querySelectorAll<HTMLButtonElement>('.menu-item')
  if (!items?.length) return
  ;(last ? items[items.length - 1] : items[0])?.focus()
}
function onCaretKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  pngMenuOpen.value = true
  void nextTick(() => focusMenuEdge(e.key === 'ArrowUp'))
}
function onMenuKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  const items = [...(splitEl.value?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])]
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  if (current === -1) return
  e.preventDefault()
  let next = current
  if (e.key === 'ArrowDown') next = (current + 1) % items.length
  else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
  else if (e.key === 'Home') next = 0
  else next = items.length - 1
  items[next]?.focus()
}

/** 动作成功反馈:按钮短暂变「✓ …」再复原(触发源沿用父级成功信号) */
const FEEDBACK_MS = 2500
const copyFlash = ref(false)
const saveFlash = ref(false)
let copyFlashTimer: ReturnType<typeof setTimeout> | undefined
let saveFlashTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.copySuccess, (v) => {
  if (!v) return
  copyFlash.value = true
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  copyFlashTimer = setTimeout(() => { copyFlash.value = false }, FEEDBACK_MS)
})
watch(() => props.savePermalink, (v) => {
  if (!v) return
  saveFlash.value = true
  if (saveFlashTimer) clearTimeout(saveFlashTimer)
  saveFlashTimer = setTimeout(() => { saveFlash.value = false }, FEEDBACK_MS)
})
// 改选文章即清掉上一轮的 ✓ 闪存:它属于旧目标的动作,不得盖在新目标上(与工作台清 bindSuccess 对称)
watch(() => props.selectedPost, () => {
  saveFlash.value = false
  if (saveFlashTimer) clearTimeout(saveFlashTimer)
})
onBeforeUnmount(() => {
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  if (saveFlashTimer) clearTimeout(saveFlashTimer)
})

/** 主按钮文案(评审实机反馈):两种状态各取五字定长,选中文章前后按钮宽度
 *  恒定不跳变;目标文章由检索框回显与「已选择:」行呈现,不在按钮里拉长 */
const saveLabel = computed(() => (props.selectedPost ? '保存并绑定' : '保存到附件'))
const saveBusyLabel = computed(() => (props.binding ? '绑定中…' : '保存中…'))
</script>

<template>
  <footer class="output-bar card">
    <div class="bar-note">
      <span class="meta">{{ summary }}</span>
    </div>

    <div class="row-main">
      <PostPicker
        class="bind"
        :model-value="selectedPost"
        @update:model-value="emit('update:selectedPost', $event)"
      ></PostPicker>
      <button
        class="primary"
        :disabled="!canExport || saving || binding"
        @click="emit('save')"
      >{{ saveFlash ? '✓ 已保存' : saving || binding ? saveBusyLabel : saveLabel }}</button>
      <button
        v-if="selectedPost"
        class="sd-btn-ghost"
        :disabled="!canExport || saving || binding"
        @click="emit('save-only')"
      >仅保存</button>

      <!-- 下载组:竖 hairline 与保存组分隔,窄屏整组折行 -->
      <span class="dl-group">
        <span ref="splitEl" class="split">
          <button
            class="sd-btn-quiet"
            :disabled="!canExport || exporting"
            @click="exportPng"
          >{{ downloadFlash === 'png' ? '✓ 已下载' : exporting ? '导出中…' : `下载 PNG${pngScale === 2 ? ' 2×' : ''}` }}</button>
          <button
            ref="caretBtn"
            class="caret"
            aria-haspopup="menu"
            :aria-expanded="pngMenuOpen"
            aria-controls="cover-png-menu"
            aria-label="选择 PNG 导出尺寸"
            @click="pngMenuOpen = !pngMenuOpen"
            @keydown="onCaretKeydown"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1.5 3.5 5 7l3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <span
            v-if="pngMenuOpen"
            id="cover-png-menu"
            class="png-menu sd-pop"
            role="menu"
            aria-label="PNG 导出尺寸"
            @keydown="onMenuKeydown"
          >
            <button
              type="button"
              class="menu-item sd-menu-item"
              role="menuitemradio"
              :aria-checked="pngScale === 1"
              :data-on="pngScale === 1 || undefined"
              @click="pickPngScale(1)"
            >
              标准 1200 × 630<small>「下载 PNG」的导出尺寸;保存到附件恒为标准</small>
            </button>
            <button
              type="button"
              class="menu-item sd-menu-item"
              role="menuitemradio"
              :aria-checked="pngScale === 2"
              :data-on="pngScale === 2 || undefined"
              @click="pickPngScale(2)"
            >
              高清 2400 × 1260<small>2 倍分辨率,文件更大</small>
            </button>
          </span>
        </span>
        <button class="sd-btn-quiet" :disabled="!canExport" @click="emit('export-svg')">
          {{ downloadFlash === 'svg' ? '✓ 已下载' : '下载 SVG' }}
        </button>
        <button class="sd-btn-quiet" :disabled="!canExport" @click="emit('copy-svg')">
          {{ copyFlash ? '✓ 已复制' : '复制 SVG' }}
        </button>
      </span>
    </div>

    <!-- 已选择行(评审实机回归):从检索框列移到反馈区,动作列保持单行高度、
         按钮不随选中状态膨胀 -->
    <p v-if="selectedPost" class="notice chosen">已选择:{{ selectedPost.title }}</p>
    <!-- A5:导出不可用的两个原因各给一行说明,不让用户对着一排禁用按钮猜 -->
    <p v-if="fontError" class="error">{{ fontError }}导出不可用</p>
    <p v-else-if="!canExport" class="notice">填写标题后可导出或保存</p>
    <p v-if="bindSuccess" class="success">{{ bindSuccess }}</p>
    <p v-if="bindError" class="error">{{ bindError }}</p>
    <p v-if="copySuccess" class="success">{{ copySuccess }}</p>
    <p v-if="copyError" class="error">{{ copyError }}</p>
    <p v-if="savePermalink" class="success">
      已保存到附件库:<a :href="permalinkHref" target="_blank" rel="noopener">{{ savePermalink }}</a>
    </p>
    <p v-if="saveError" class="error">{{ saveError }}</p>
    <p v-if="exportError" class="error">{{ exportError }}</p>
  </footer>
</template>

<style scoped>
.output-bar {
  width: min(100%, 980px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--pit-sp-2);
  animation: sd-rise var(--sd-dur-enter) var(--sd-ease) var(--sd-delay-5) both;
}
.bar-note {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--pit-sp-2);
}
.meta {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 主动作带:保存组(检索+主按钮)左,下载组右。
 * 检索框 flex-grow,折行判定只看 flex-basis:基值给 96,为「选中文章后
 * 主按钮变长 + 仅保存出现」在窄栏(约 700px 动作带)留足余量,不把下载组
 * 挤折行(实机两次反馈的布局跳变);排得下时输入框实际宽度由 grow 决定,
 * 与基值无关。极窄屏仍可折行兜底。 */
.row-main {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pit-sp-2);
  align-items: stretch;
}
.bind {
  flex: 1 1 96px;
  min-width: 0;
}
.dl-group {
  display: flex;
  gap: var(--pit-sp-2);
  align-items: stretch;
  margin-left: auto;
  padding-left: var(--pit-sp-3);
  border-left: 1px solid var(--sd-line);
}

/* ---- 三级按钮材质(F2):primary / quiet / ghost ---- */
.primary {
  flex: 0 0 auto;
  min-width: 180px;
  /* 两态文案各为五字,宽度经 min-width 恒定(选中文章前后不跳变);
   * 上限仅作未来文案变长时的省略号防御 */
  max-width: 240px;
  border: none;
  border-radius: var(--sd-r-cta);
  padding: 10px 18px;
  font-size: var(--sd-fs-base);
  font-weight: 600;
  font-family: var(--sd-font);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(180deg, var(--sd-accent-strong), var(--sd-accent-deep));
  color: var(--sd-text-on-accent);
  cursor: pointer;
  box-shadow:
    var(--sd-shadow-cta),
    inset 0 1px 0 var(--sd-edge-inset-light);
  transition:
    transform var(--sd-dur-press) ease-out,
    box-shadow var(--sd-dur-hover) var(--sd-ease),
    filter var(--sd-dur-hover) ease;
}
.primary:hover:not(:disabled) {
  filter: brightness(1.05);
  box-shadow:
    var(--sd-shadow-cta-hover),
    inset 0 1px 0 var(--sd-edge-inset-light);
}
.primary:active:not(:disabled) { transform: scale(0.97); }
.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.primary:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3.5px var(--sd-focus-ring),
    0 0 0 1px var(--sd-focus-border);
}

/* quiet/ghost 走共享类 sd-btn-quiet / sd-btn-ghost(tokens.css)。
 * 次级按钮统一药丸圆角(F2:primary 渐变 CTA 是唯一方圆 r-cta 形)。 */

/* 按钮 ✓ 成功反馈走文案前缀 + 成功行,不再保留未接线的 .is-ok 死样式(B2 移除) */

/* ---- PNG 倍率 split(S3):主按钮 + 菜单,向上弹(S4) ---- */
.split { position: relative; display: flex; }
/* split 组:quiet 的药丸圆角只保留外侧半边,拼成整颗胶囊 */
.split .sd-btn-quiet {
  border-radius: 0;
  border-top-left-radius: var(--sd-r-pill);
  border-bottom-left-radius: var(--sd-r-pill);
}
.caret {
  flex: 0 0 auto;
  border: none;
  cursor: pointer;
  background: var(--sd-surface-raised);
  box-shadow: 0 0 0 1px var(--sd-line) inset;
  border-radius: 0;
  border-top-right-radius: var(--sd-r-pill);
  border-bottom-right-radius: var(--sd-r-pill);
  padding: 0 8px;
  color: var(--sd-text-2);
  display: grid;
  place-items: center;
  transition: background var(--sd-dur-hover) var(--sd-ease);
}
.caret:hover { background: var(--sd-surface-hover); }
.caret:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3.5px var(--sd-focus-ring),
    0 0 0 1px var(--sd-focus-border);
}
/* 浮层外壳走共享类 sd-pop;此处只管定位与宽度 */
.png-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 200px;
}
.menu-item[data-on] {
  background: rgb(0 122 255 / 10%);
  color: var(--sd-text-accent);
  font-weight: 600;
}

/* ---- 反馈行 ---- */
/* A5:空标题导致的禁用原因提示(字体错误行优先,二者互斥) */
.notice {
  color: var(--sd-text-2);
  font-size: var(--sd-fs-sm);
  line-height: 1.5;
  margin: 0;
}
.chosen {
  color: var(--sd-text-accent); /* 选中回显,与成功行同族的强调色文字(AA 达标档) */
}
.success {
  color: var(--sd-text-accent); /* A3:accent-strong 在卡片材质上 4.49:1 踩线,改深档 */
  font-size: var(--sd-fs-sm);
  line-height: 1.5;
  margin: 0;
  word-break: break-all;
}
.success a { color: inherit; }
.error {
  color: var(--sd-danger-text);
  font-size: var(--sd-fs-sm);
  line-height: 1.5;
  margin: 0;
}
</style>
