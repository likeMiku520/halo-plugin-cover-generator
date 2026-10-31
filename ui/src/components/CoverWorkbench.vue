<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { STORAGE_KEY, useCoverState, persistError } from '../composables/useCoverState'
import { usePluginSettings, pluginSettingsDegraded, type PluginSettings } from '../composables/usePluginSettings'
import { fetchLogoAsDataUrl } from '../lib/logoFetcher'
import { loadCoverFont } from '../lib/fontLoader'
import { PRESETS } from '../lib/presets'
import { buildCoverSvg, type FontLike } from '../lib/svgBuilder'
import { describeCanvas } from '../lib/canvasPresets'
import { coverAttachmentFileName, downloadPng, downloadSvg, svgFileName, svgToPngBlob } from '../lib/exporters'
import { updatePostCover, uploadCoverPng, type PostSummary } from '../api/haloClient'
import { BUILTIN_FONT_URL } from '../lib/fontLoader'
import { CANVAS, customSizeLimitsOf, normalizeAnchor, scaleLimitsOf } from '../lib/layout'
import type { Anchor } from '../lib/types'
import {
  anchorOfTargets, clampScalePercent, deleteSelection, useCanvasInteraction,
  type AnchorPatch, type SelectionId,
} from '../composables/useCanvasInteraction'
import ControlPanel from './ControlPanel.vue'
import CoverPreview from './CoverPreview.vue'
import OutputBar from './OutputBar.vue'
import CanvasOverlay from './CanvasOverlay.vue'
import HistoryBar from './HistoryBar.vue'
import { useHistory } from '../composables/useHistory'

/**
 * 内置字体资产地址:插件内默认走 JAR 静态资源(M7 出包,见 BUILTIN_FONT_URL);
 * 视觉验证 harness 以 prop 注入打包资产地址,便于脱离宿主独立预览。
 */
const props = withDefaults(
  defineProps<{
    /** 覆盖内置字体地址(harness 专用;宿主内留空走 ReverseProxy 静态路径) */
    bundledFontUrl?: string
  }>(),
  { bundledFontUrl: '' },
)

const state = useCoverState()

/**
 * 撤销 / 重做。历史归 useHistory 所有,这个组件只负责把按钮接上:
 * 一次连续拖动会被合并成一步(默认 400ms 静默窗口),不会拖一下产生几十步。
 */
const { undo, redo, canUndo, canRedo } = useHistory(state)

/**
 * 画布交互。选中态只有这一份:面板点选与画布上按下元素都写到这里
 * (画布上按住元素即可拖动,未选中的元素先选中再拖)。
 * 这里另提供键盘微调:方向键 1 步、Shift 10 步。
 */
// 解构取得顶层 ref：嵌套在对象里的 ref 在模板中不会自动解包
const {
  selected: canvasSelection,
  select: selectCanvas,
  nudge: nudgeCanvas,
} = useCanvasInteraction()

/**
 * 标题字号的取值域。
 *
 * 直接从 layout 的画布常量派生（面板「大小」滑杆用的 64/210 也声明与它们一致），
 * 免得这份边界在第三个地方又抄一遍然后各自漂移。
 */
const TITLE_FONT_MIN = CANVAS.TITLE_MIN
const TITLE_FONT_MAX = CANVAS.TITLE_BASE

/** 选中目标的锚点写入:内置元素进 layout,自定义元素进 customElements。
 *
 * 以现有锚点为底、只覆盖本次改动的字段:拖动/滚轮/旋转/拉大/键盘各改各的,
 * 若从零构造锚点对象,没提到的字段(透明度等)会被一并抹回默认值。
 */
function applyAnchor(id: SelectionId, next: AnchorPatch) {
  const base = anchorOfId(id)
  if (!base) return
  const x = next.x ?? base.x
  const y = next.y ?? base.y
  /** 这次补丁是否真的改倍率：只有改倍率时才需要折算到「该元素的大小 owner」 */
  const scaling = next.scale !== undefined && next.scale !== base.scale
  const ratio = scaling && base.scale > 0 ? next.scale! / base.scale : 1

  // 标题的「大小」由 titleFontSize 独家承担(面板那条滑杆写的就是它,并把倍率归位 1)。
  // 若照其他元素那样写 anchor.scale,滚轮只动到「可用宽度预算」,短标题几乎看不出变化。
  if (id === 'title' && scaling) {
    // 先把存档里可能不为 1 的倍率折算进字号再乘本次比值:归位倍率时观感大小不跳变
    const fontSize = Math.min(
      TITLE_FONT_MAX,
      Math.max(TITLE_FONT_MIN, Math.round(state.value.titleFontSize * base.scale * ratio)),
    )
    // 已顶到字号上下限:值没变,重渲染与存档写入都是白费
    if (fontSize === state.value.titleFontSize && base.scale === 1) return
    state.value.titleFontSize = fontSize
    state.value.layout = { ...state.value.layout, title: normalizeAnchor({ ...base, x, y, scale: 1 }) }
    return
  }

  // 自定义图片/SVG 的「大小」由 el.size(面板的「宽度/边长」px 滑杆)独家承担:面板已不再给
  // 它们显示「大小(%)」滑杆,若滚轮继续写 anchor.scale,就会「画面变了、面板没变」(实机反馈)。
  // 文字元素不在此列:它的「大小(%)」滑杆读的正是 anchor.scale。
  if (scaling && id.startsWith('custom:')) {
    const target = id.slice('custom:'.length)
    const el = state.value.customElements.find((c) => c.id === target)
    if (el && el.kind !== 'text') {
      // 先把可能不为 1 的倍率折算进 px 再乘本次比值:归位倍率时画面大小不跳变。
      // 边界取 layout 的 customSizeLimitsOf（按类型取行，与面板滑杆同一份）
      const limits = customSizeLimitsOf(el.kind)
      const size = Math.min(
        limits.max,
        Math.max(limits.min, Math.round(el.size * base.scale * ratio)),
      )
      if (size === el.size && base.scale === 1) return // 已顶到 px 上下限
      state.value.customElements = state.value.customElements.map((c) => c.id === target
        ? {
            ...c,
            size,
            anchor: normalizeAnchor({
              ...c.anchor, x, y, scale: 1, rotation: next.rotation ?? c.anchor.rotation,
            }),
          }
        : c)
      return
    }
  }

  // 其余元素:倍率写在锚点上,边界在写回这**一次**统一裁决——面板滑杆/滚轮/拉大手柄
  // 都不各自夹取,「拖动只给比值、边界由 owner 裁决」才有一致的落点。
  // 旋转对所有元素通用,同样落在锚点的 rotation 上(收敛进 ±180)。
  const limits = scaleLimitsOf(id)
  const scale = scaling
    ? clampScalePercent(
        Math.round(next.scale! * 100), Math.round(base.scale * 100), limits.min, limits.max,
      ) / 100
    : base.scale
  const anchor = normalizeAnchor({
    ...base,
    x,
    y,
    scale,
    rotation: next.rotation ?? base.rotation,
  })
  if (id.startsWith('custom:')) {
    const target = id.slice('custom:'.length)
    state.value.customElements = state.value.customElements.map((el) =>
      el.id === target ? { ...el, anchor } : el,
    )
    return
  }
  state.value.layout = { ...state.value.layout, [id as keyof typeof state.value.layout]: anchor }
}

/** 取某选中目标的完整锚点(内置元素在 layout,自定义元素在 customElements) */
function anchorOfId(id: SelectionId): Anchor | null {
  return anchorOfTargets(state.value, id)
}

/**
 * 选中框上的 ×。
 *
 * 动作策略只有 deleteSelection 一份(Logo 关显示/副标题水印清空/自定义元素真删除);
 * 这里只负责把补丁并进状态,并在元素真的消失时清掉选中态——否则选中态会指向不存在的目标。
 */
function onCanvasDelete(id: SelectionId) {
  const result = deleteSelection(state.value, id)
  if (!result) return
  state.value = { ...state.value, ...result.patch }
  if (result.clearSelection && canvasSelection.value === id) selectCanvas(null)
}

/** 键盘微调:方向键 1 步、Shift 10 步;无选中时不拦截按键 */
function onCanvasKeydown(ev: KeyboardEvent) {
  const next = nudgeCanvas(ev, state.value)
  if (!next) return
  applyAnchor(next.id, next.anchor)
}

/** 画布交互开始/结束:交互期间预览跟手,结束后回到 150ms 合帧 */
function onCanvasInteracting(on: boolean) {
  canvasInteracting.value = on
}

/**
 * 列表入口跳转带回的输入(Console 路由 query;vue-router 由宿主提供,
 * 常规进入菜单时无相关 query)。挂载时一次性合并。
 */
const routeQuery = (
  getCurrentInstance()?.appContext.config.globalProperties as {
    $route?: { query?: Record<string, unknown> }
  }
)?.$route?.query

onMounted(() => mergeRouteQuery(routeQuery))

/** 仅当 query 携带回传输入时合并;query 优先于本地存档(显式带回即用户意图) */
function mergeRouteQuery(query: Record<string, unknown> | undefined) {
  if (!query) return
  const titleLeft = typeof query.titleLeft === 'string' ? query.titleLeft : ''
  const titleRight = typeof query.titleRight === 'string' ? query.titleRight : ''
  const presetId = typeof query.presetId === 'string' ? query.presetId : ''
  const postName = typeof query.postName === 'string' ? query.postName : ''
  const postTitle = typeof query.postTitle === 'string' ? query.postTitle : ''
  if (!titleLeft && !titleRight && !presetId && !postName) return
  // 路由回传的两段文本属于分缝模式，切回该模式再写入，避免与整块模式互相污染
  if (titleLeft || titleRight) {
    if (titleLeft) state.value.titleLeft = titleLeft
    if (titleRight) state.value.titleRight = titleRight
    state.value.titleMode = 'split'
  }
  const preset = PRESETS.find((p) => p.id === presetId)
  if (preset) {
    state.value.gradient = { angle: preset.angle, stops: [...preset.stops] }
    state.value.presetId = preset.id
  }
  // 文章列表「生成封面」跳转携带的目标文章:直接预选(名称+标题即 PostPicker 契约)
  if (postName) selectedPost.value = { name: postName, title: postTitle }
}
/**
 * 插件设置的默认 Logo。settings.logoUrl 是远程直链,不得直接进 SVG
 * (破坏自包含且污染画布 PNG 导出),须经 fetchLogoAsDataUrl 转为 dataURL 后:
 * 1) 播种进 state.logoDataUrl(无存档时);2) 作为 svgBuilder 的渲染兜底
 */
const defaultLogoDataUrl = ref('')

/** 无存档时以插件设置为初始默认;有存档则完全尊重存档(archive-wins) */
function seedDefaults(settings: PluginSettings) {
  const hasArchive = !!localStorage.getItem(STORAGE_KEY)
  if (hasArchive) return
  // 仅在初始态未被用户改动时播种,避免异步设置晚到覆盖已输入内容
  if (settings.watermark && state.value.watermark === '') {
    state.value.watermark = settings.watermark
  }
  if (!settings.logoUrl || state.value.logoDataUrl !== null) return
  fetchLogoAsDataUrl(settings.logoUrl, () => {
    // 播种路径无导入面板可挂提示,至少显式留痕:默认 Logo 直链经第三方代理外发
    console.warn('[cover-generator] 默认 Logo 直链跨域受限,已改经公共代理 wsrv.nl 获取,链接已发送给第三方服务')
  })
    .then((dataUrl) => {
      if (state.value.logoDataUrl !== null) return // 转换期间用户已导入自己的 Logo
      state.value.logoDataUrl = dataUrl
      // 不动 logoHidden:无存档时初始即为显示态,这里唯一能把置为隐藏的
      // 是用户在拉取窗口内的显式操作——必须尊重,不得翻回(评审 M5,与 catch 分支对称)
      defaultLogoDataUrl.value = dataUrl
    })
    .catch(() => {
      // 默认 Logo 拉取/转换失败:与成功路径对称,仅在用户尚未导入自己的 Logo 时
      // 回退隐藏态;已有用户 Logo(转换期间导入)则不得强行隐藏
      if (state.value.logoDataUrl === null) {
        state.value.logoHidden = true
      }
    })
}

const font = ref<FontLike | null>(null)
const fontError = ref('')

onMounted(async () => {
  try {
    // 插件设置唯一读取点:播种默认值与字体选择共用同一次 ConfigMap 读取(失败已静默回退全默认值)
    const settings = await usePluginSettings()
    seedDefaults(settings)
    // S3 自定义字体:设置页配置了 fontUrl 则优先加载之,空串沿用内置资产;
    // 配置了但加载失败 ⇒ 走降级禁导出,不得静默改用内置字体掩盖配置错误
    font.value = await loadCoverFont(settings.fontUrl || props.bundledFontUrl || BUILTIN_FONT_URL)
  } catch {
    fontError.value = '字体加载失败:预览已降级为系统字体,'
  }
})

/** C3:字体加载状态外显(loading 时头部提示,error 时输出条给原因),不再静默禁按钮 */
const fontStatus = computed<'loading' | 'ready' | 'error'>(() =>
  font.value ? 'ready' : fontError.value ? 'error' : 'loading',
)

const svg = computed(() =>
  // 默认 Logo 用已转换的 dataURL 兜底(远程直链永不出现在 SVG 中);空串 ⇒ svgBuilder 视为无默认
  buildCoverSvg({ state: state.value, font: font.value, defaultLogoDataUrl: defaultLogoDataUrl.value }),
)

/**
 * G1:预览渲染防抖。SVG 含 feTurbulence 噪点与投影滤镜,逐击键全量重渲染
 * 在低端机上有可感知卡顿;预览延迟 150ms 合帧,导出/复制仍取实时 svg(见下),
 * 功能与产物完全不变。
 */
const PREVIEW_DEBOUNCE_MS = 150
const previewSvg = ref(svg.value)
let previewTimer: ReturnType<typeof setTimeout> | undefined

/** 立刻落到预览:清掉待触发的合帧,避免随后被一帧旧值盖回去 */
function flushPreview(v: string) {
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = undefined
  }
  previewSvg.value = v
}

/**
 * 画布交互(拖动/滚轮)进行中。
 *
 * 防抖是为「打字时不逐字符重渲染」服务的,但拖动期间它会让图元落后于指针
 * (框走了、字还在原地,看起来就是卡顿)。交互期间直接渲染,交互一结束即恢复防抖。
 */
const canvasInteracting = ref(false)

watch(svg, (v) => {
  if (canvasInteracting.value) {
    flushPreview(v)
    return
  }
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => { previewSvg.value = v }, PREVIEW_DEBOUNCE_MS)
})

// 交互结束补上最后一帧:状态写入与结束信号可能落在同一拍,不能留下 150ms 的空窗
watch(canvasInteracting, (on) => {
  if (!on) flushPreview(svg.value)
})

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})

/** 当前生效的标题文本：两种排版各自取值，导出判断与文件名都以它为准 */
const titleText = computed(() =>
  state.value.titleMode === 'flow'
    ? state.value.titleFlow
    : state.value.titleLeft + state.value.titleRight)

const canExport = computed(() => !!font.value && !!titleText.value.trim())
const exportError = ref('')

/** 下载成功反馈('svg'/'png'):按钮短暂变「✓ 已下载」,2.5s 后复原 */
const downloadFlash = ref<'' | 'svg' | 'png'>('')
let downloadFlashTimer: ReturnType<typeof setTimeout> | undefined
function flashDownload(kind: 'svg' | 'png') {
  downloadFlash.value = kind
  if (downloadFlashTimer) clearTimeout(downloadFlashTimer)
  downloadFlashTimer = setTimeout(() => { downloadFlash.value = '' }, 2500)
}

function exportSvg() {
  downloadSvg(svg.value, svgFileName(titleText.value, 'svg'))
  flashDownload('svg')
}

/** C2:PNG 导出进行中防重入(画布渲染数百 ms,连点会排队) */
const exporting = ref(false)
async function exportPng(scale = 1) {
  if (exporting.value) return
  exporting.value = true
  try {
    await downloadPng(
      svg.value, state.value.canvas,
      svgFileName(titleText.value, 'png'), scale,
    )
    exportError.value = ''
    flashDownload('png')
  } catch (e) {
    // 渲染/编码失败必须给出界面反馈,避免用户误以为导出成功
    exportError.value = e instanceof Error ? e.message : 'PNG 导出失败'
  } finally {
    exporting.value = false
  }
}

const copySuccess = ref('')
const copyError = ref('')

/** C1:复制当前 SVG 源码到剪贴板;成败均须给出界面反馈 */
async function copySvgSource() {
  try {
    await navigator.clipboard.writeText(svg.value)
    // 先清再设(下一拍):2.5s 窗口内重复复制时,OutputBar 的 ✓ 闪存 watch 才会重新触发(评审M8)
    copySuccess.value = ''
    copyError.value = ''
    await nextTick()
    copySuccess.value = 'SVG 源码已复制到剪贴板'
    // 提示不常驻:2.5s 后清行,再次复制时 OutputBar 的按钮 ✓ 反馈可重新触发
    setTimeout(() => {
      if (copySuccess.value === 'SVG 源码已复制到剪贴板') copySuccess.value = ''
    }, 2500)
  } catch (e) {
    copyError.value = `复制失败:${e instanceof Error && e.message ? e.message : '剪贴板不可用'}`
    copySuccess.value = ''
  }
}

const saving = ref(false)
const saveError = ref('')
const savePermalink = ref('')

async function saveToAttachment() {
  // 防重入:任一上传链路(保存/绑定)在途都忽略——两条链路共用同一次上传,
  // 绑定在途时走「仅保存」会并发第二次附件上传(评审#1)
  if (saving.value || binding.value) return
  saving.value = true
  saveError.value = ''
  savePermalink.value = ''
  try {
    savePermalink.value = await uploadCurrentCover()
  } catch (e) {
    // 上传失败只提示错误,本地下载不受影响(M10 回退路径)
    saveError.value = e instanceof Error ? e.message : '上传附件失败'
  } finally {
    saving.value = false
  }
}

/** 上传当前封面到附件库并返回 permalink(保存到附件 / 保存并绑定共用,M10 契约) */
async function uploadCurrentCover(): Promise<string> {
  // 保存时现读插件设置,尊重用户在设置页的最新策略/分组选择
  const settings = await usePluginSettings()
  const blob = await svgToPngBlob(svg.value, state.value.canvas)
  const { permalink } = await uploadCoverPng(
    blob,
    coverAttachmentFileName(titleText.value),
    settings,
  )
  return permalink
}

/** 绑定目标文章(PostPicker v-model);null 表示尚未选择 */
const selectedPost = ref<PostSummary | null>(null)
const binding = ref(false)
const bindError = ref('')
const bindSuccess = ref('')

// 切换选中文章即清空上一轮绑定反馈,避免「封面已绑定到《旧标题》」停留在新选择旁
watch(selectedPost, () => {
  bindError.value = ''
  bindSuccess.value = ''
})

/**
 * 保存并绑定(M11):上传成功后把返回的 permalink 写入所选文章的 spec.cover。
 * 绑定失败(含乐观锁重试后仍冲突)时附件已上传的事实保留展示,本地下载不受影响。
 */
async function saveAndBind() {
  if (binding.value || saving.value || !selectedPost.value) return // 防重入(与仅保存共享互斥,评审#1) + 必须先选定文章
  const target = selectedPost.value
  binding.value = true
  bindError.value = ''
  bindSuccess.value = ''
  try {
    const permalink = await uploadCurrentCover()
    savePermalink.value = permalink
    await updatePostCover(target.name, permalink)
    bindSuccess.value = `封面已绑定到《${target.title}》`
  } catch (e) {
    bindError.value = e instanceof Error ? e.message : '绑定文章封面失败'
  } finally {
    binding.value = false
  }
}

/** S2 智能保存:主按钮按「是否选定了文章」在保存与保存并绑定间切换,链路原样复用 */
function smartSave() {
  if (selectedPost.value) void saveAndBind()
  else void saveToAttachment()
}

/** 仅保存到附件(选中文章后的次级出口):跳过绑定写回 */
function saveOnly() {
  void saveToAttachment()
}

/** 输出条摘要行:尺寸 + 比例 + 当前样式名 + 字号(仅展示) */
const summary = computed(() => {
  const preset = PRESETS.find((p) => p.id === state.value.presetId)
  const styleName = preset ? preset.name : `自定义 · ${state.value.gradient.angle}°`
  return `${describeCanvas(state.value.canvas)} · ${styleName} · 字号 ${state.value.titleFontSize} px`
})

/** 仅展示用:相对 permalink 解析为绝对地址(存储/返回的 permalink 值保持相对路径不变) */
const permalinkHref = computed(() =>
  savePermalink.value ? new URL(savePermalink.value, window.location.origin).href : '',
)
</script>

<template>
  <main class="cover-workbench">
    <div v-if="persistError" class="persist-error" role="alert">{{ persistError }}</div>
    <div v-if="pluginSettingsDegraded" class="settings-degraded" role="status">
      插件设置读取失败,已临时使用默认设置(附件策略/分组等可能不符)
    </div>
    <ControlPanel
      v-model="state"
      :default-logo-url="defaultLogoDataUrl"
      :font-status="fontStatus"
      :selected="canvasSelection"
      :font="font"
      @select="selectCanvas"
    ></ControlPanel>
    <section class="stage-col" @keydown="onCanvasKeydown">
      <div class="window-wrap">
        <CoverPreview :svg="previewSvg" :canvas="state.canvas">
          <CanvasOverlay
            :state="state"
            :selected="canvasSelection"
            :font="font"
            :has-logo="!!(state.logoDataUrl || defaultLogoDataUrl)"
            :guides="state.smartGuides"
            @select="selectCanvas"
            @anchor="applyAnchor"
            @interacting="onCanvasInteracting"
            @delete="onCanvasDelete"
          ></CanvasOverlay>
        </CoverPreview>
      </div>
      <!-- 撤销 / 重做:放在预览框**外面**的下方右侧,不压住画布 -->
      <div class="history-row">
        <HistoryBar :can-undo="canUndo" :can-redo="canRedo" @undo="undo" @redo="redo" />
      </div>
      <OutputBar
        v-model:selected-post="selectedPost"
        :can-export="canExport"
        :font-error="fontError"
        :exporting="exporting"
        :export-error="exportError"
        :summary="summary"
        :copy-success="copySuccess"
        :copy-error="copyError"
        :saving="saving"
        :save-error="saveError"
        :save-permalink="savePermalink"
        :permalink-href="permalinkHref"
        :binding="binding"
        :bind-error="bindError"
        :bind-success="bindSuccess"
        :download-flash="downloadFlash"
        @export-svg="exportSvg"
        @export-png="exportPng"
        @copy-svg="copySvgSource"
        @save="smartSave"
        @save-only="saveOnly"
      ></OutputBar>
    </section>
  </main>
</template>

<style>
/* 页面级样式(Console 隔离):本块与 tokens.css 的选择器均锚定 .cover-workbench 根类,
 * 不使用 :root/body/* 等全局作用域,避免污染 Console;
 * 内容取自前身 main.css 中工作台确实需要的部分(箱型、面板滚动条、减动效)。 */
@import '../assets/tokens.css';

.cover-workbench,
.cover-workbench *,
.cover-workbench *::before,
.cover-workbench *::after {
  box-sizing: border-box;
}

/* 面板内滚动条:细、无轨道感(仅工作台内部生效) */
.cover-workbench ::-webkit-scrollbar {
  width: 8px;
}
.cover-workbench ::-webkit-scrollbar-thumb {
  background: var(--sd-line-strong);
  border-radius: var(--sd-r-pill);
}
.cover-workbench ::-webkit-scrollbar-track {
  background: transparent;
}

/* 减动效:保留理解性反馈,去除位移与缩放(仅工作台内部生效) */
@media (prefers-reduced-motion: reduce) {
  .cover-workbench,
  .cover-workbench *,
  .cover-workbench *::before,
  .cover-workbench *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>

<style scoped>
/* 前身 App.vue 的 .layout 改名 .cover-workbench 并作为设计令牌挂载点;
 * 高度由 100dvh(独立应用)改为预留 Console 顶栏/页头的视口高度 */
.cover-workbench {
  height: calc(100dvh - 150px);
  min-height: 520px;
  display: grid;
  grid-template-columns: 400px minmax(0, 1fr);
  gap: var(--pit-sp-3);
  padding: var(--pit-sp-5) var(--pit-sp-6) var(--pit-sp-5) var(--pit-sp-5);
  align-items: stretch;
  font-family: var(--sd-font);
  color: var(--sd-text);
}

/* 右列:预览窗占满余量,输出动作条贴其下方(V2:S1 输出右置) */
.stage-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pit-sp-3);
}
.window-wrap {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
}

/* 撤销 / 重做:预览框外侧的右下角,不与画布争夺点击区 */
.history-row {
  display: flex;
  justify-content: flex-end;
}

/* 本地存档落盘失败警示(persistError 非空时出现,恢复后自动消失) */
.persist-error {
  grid-column: 1 / -1;
  padding: var(--pit-sp-2) var(--pit-sp-3);
  border: 1px solid var(--sd-danger);
  border-radius: var(--sd-r-control);
  color: var(--sd-danger-text); /* 文字用 AA 达标深档,边框保留系统红 */
  font-size: var(--sd-fs-md);
}

/* 设置降级弱提示:弱于错误警示,仅告知默认值顶替了用户配置(评审 M6) */
.settings-degraded {
  grid-column: 1 / -1;
  padding: var(--pit-sp-2) var(--pit-sp-3);
  border: 1px solid var(--sd-line-strong);
  border-radius: var(--sd-r-control);
  color: var(--sd-text-2);
  font-size: var(--sd-fs-md);
}

@media (max-width: 960px) {
  .cover-workbench {
    height: auto;
    min-height: 520px;
    grid-template-columns: 1fr;
  }
  .window-wrap {
    min-height: 300px;
  }
}
</style>
