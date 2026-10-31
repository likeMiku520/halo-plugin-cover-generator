import { ref, watch, onScopeDispose } from 'vue'
import type { Ref } from 'vue'
import type { Anchor, AnchorKey, AnchorMap, CoverState, CustomElement, CustomKind, LayerKey, TextStyleMap, TextTarget, TitleMode } from '../lib/types'
import { DEFAULT_PRESET } from '../lib/presets'
import { CUSTOM_CANVAS_PRESET, findPreset } from '../lib/canvasPresets'
import { splitTitle } from '../lib/splitTitle'
import {
  CANVAS, REF_H, REF_W, TEXT_STYLE_LIMITS, defaultAnchors, defaultCoverState, defaultLayers, defaultTextStyles,
  isValidCanvasSize, normalizeAnchor, normalizeBackgroundScrim, normalizeCanvasSize,
  normalizeSeamGap, normalizeTextStyle,
} from '../lib/layout'

/** 工作台状态存档键;CoverWorkbench 需同名键判断「是否存在存档」(archive-wins 播种门槛) */
export const STORAGE_KEY = 'halo-plugin-cover-generator/state/v1'
const KEY = STORAGE_KEY

/** 最近一次落盘失败的用户可读原因(空串 = 正常)。
 *  模块级共享:存档键唯一,任一实例写入失败对全部实例同样成立 */
export const persistError = ref('')
const PERSIST_FAILED_MESSAGE = '本地存档保存失败(存储空间不足或隐私模式),刷新后更改将丢失'

/** 自定义元素数量上限:每一项都会显著增大存档与 SVG 体积,需要显式边界 */
export const MAX_CUSTOM_ELEMENTS = 12

function defaults(): CoverState {
  // 全部默认值集中在 layout.ts（含默认渐变 = 海洋组的薄荷），
  // 保证渲染基准与状态初值只有一个来源
  return defaultCoverState()
}

/** 迁移迭代 2 之前的旧档：单框 title 按宽度中点拆为左右两段 */
function migrate(raw: Record<string, unknown>, base: CoverState): CoverState {
  const merged = { ...base, ...raw } as CoverState & { title?: string }
  if (typeof raw.title === 'string' && raw.titleLeft === undefined) {
    const { left, right } = splitTitle(raw.title)
    merged.titleLeft = left
    merged.titleRight = right
  }
  delete merged.title
  return merged
}

const HEX = /^#[0-9a-f]{6}$/i

/** 从不可信对象里取一个可选数字字段；非数字/缺失都返回 undefined 交给调用方回落 */
function optionalNumber(v: unknown, key: string): number | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const raw = (v as Record<string, unknown>)[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

/** 旧档把旋转存在 textStyles[key].rotation 里；2.0 起旋转归 anchor 所有 */
function legacyStyleRotations(v: unknown): Partial<Record<AnchorKey, number>> {
  if (typeof v !== 'object' || v === null) return {}
  const src = v as Record<string, unknown>
  const out: Partial<Record<AnchorKey, number>> = {}
  for (const key of TEXT_TARGETS) out[key] = optionalNumber(src[key], 'rotation')
  return out
}

/** 弯曲度收敛进 ±100；缺失时回落 0（直线） */
function normalizeCurve(v: number | undefined): number {
  if (v === undefined) return 0
  return Math.round(Math.min(TEXT_STYLE_LIMITS.CURVE_MAX, Math.max(TEXT_STYLE_LIMITS.CURVE_MIN, v)))
}

function isValidAnchor(v: unknown): v is Anchor {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return typeof a.x === 'number' && Number.isFinite(a.x)
    && typeof a.y === 'number' && Number.isFinite(a.y)
    && typeof a.scale === 'number' && Number.isFinite(a.scale)
}

const CUSTOM_KINDS: CustomKind[] = ['image', 'text', 'svg']

/** 三个可单独调排版的内置文字元素:校验与 UI 共用同一份清单 */
export const TEXT_TARGETS: TextTarget[] = ['title', 'subtitle', 'watermark']

function isValidCustomElement(v: unknown): v is CustomElement {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  if (typeof e.id !== 'string' || e.id === '') return false
  if (!CUSTOM_KINDS.includes(e.kind as CustomKind)) return false
  if (typeof e.content !== 'string' || typeof e.text !== 'string') return false
  if (typeof e.size !== 'number' || !Number.isFinite(e.size)) return false
  if (!isValidAnchor(e.anchor)) return false
  if (typeof e.color !== 'string' || !HEX.test(e.color)) return false
  if (typeof e.bold !== 'boolean') return false
  if (typeof e.tracking !== 'number' || !Number.isFinite(e.tracking)) return false
  // image 只接受 dataURL:与 Logo 同一边界,外链会破坏「导出 SVG 自包含」
  if (e.kind === 'image' && !/^data:image\//i.test(e.content)) return false
  // svg 只接受 SVG 标记;真正的白名单过滤在录入时完成(sanitizeSvgMarkup)
  if (e.kind === 'svg' && !/<svg[\s>]/i.test(e.content)) return false
  return true
}

/**
 * 存档信任边界：localStorage 数据不可信。此处逐字段判定——
 * 合法字段保留、非法字段回退默认值，而不是整档丢弃：新增字段(布局/自定义元素)
 * 在旧档中必然缺失，整档回退会把用户已有的标题与渐变色一起抹掉。
 * 颜色额外做 #rrggbb 校验：全部活写入点均产出该形态，非 hex 只可能来自
 * 不可信存档，原样放行会直插 SVG 标记(评审 M2)
 */
function isValidCover(v: unknown): v is CoverState {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  if (typeof s.titleLeft !== 'string' || typeof s.titleRight !== 'string'
    || typeof s.subtitle !== 'string' || typeof s.watermark !== 'string'
    || typeof s.titleFontSize !== 'number' || !Number.isFinite(s.titleFontSize)
    || (s.presetId !== null && typeof s.presetId !== 'string')
    || typeof s.logoHidden !== 'boolean') return false
  // logoDataUrl 除类型外还须为 data:image/*:全部活写入点(上传/导入/播种)
  // 均产出该形态,外链 URI 只可能来自不可信存档,放行会破坏「SVG 自包含、
  // 不依赖外链」承诺(评审Minor-M1;标签逃逸另由 esc 兜底)
  if (s.logoDataUrl !== null
    && (typeof s.logoDataUrl !== 'string' || !/^data:image\//i.test(s.logoDataUrl))) return false
  if (typeof s.gradient !== 'object' || s.gradient === null) return false
  const g = s.gradient as Record<string, unknown>
  if (typeof g.angle !== 'number' || !Number.isFinite(g.angle) || !Array.isArray(g.stops)) return false
  return g.stops.every(st =>
    typeof st === 'object' && st !== null
    && typeof (st as Record<string, unknown>).offset === 'number'
    && typeof (st as Record<string, unknown>).color === 'string'
    && HEX.test((st as Record<string, unknown>).color as string))
}

/**
 * 把不可信存档中的新增字段收敛成合法值;返回是否发生过替换。
 *
 * 判定依据必须是「原始存档」而不是合并后的对象:merged 由 defaults() 铺底，
 * 新增字段天然已存在，用它判断永远得出「无需修复」，旧档也就不会被回写。
 */
function repairNewFields(
  merged: CoverState & Record<string, unknown>,
  raw: Record<string, unknown>,
): boolean {
  let repaired = false
  // 画布尺寸：旧档无此字段 ⇒ 回落到 1200×630，与旧版硬编码画布一致
  const rawCanvas = raw.canvas
  if (!isValidCanvasSize(rawCanvas)) {
    merged.canvas = { width: REF_W, height: REF_H }
    repaired = true
  } else {
    merged.canvas = normalizeCanvasSize(rawCanvas)
  }
  if (merged.titleMode !== 'split' && merged.titleMode !== 'flow') {
    merged.titleMode = 'split'
    repaired = true
  }
  const anchors = defaultAnchors()
  const rawLayout = raw.layout as Record<string, unknown> | undefined
  // 1.x 把旋转存在 textStyles[key].rotation 里，2.0 起旋转归 anchor 所有，先把旧值取出来
  const legacyRotations = legacyStyleRotations(raw.textStyles)
  const layout = {} as AnchorMap
  for (const key of Object.keys(anchors) as (keyof AnchorMap)[]) {
    const candidate = rawLayout?.[key]
    if (isValidAnchor(candidate)) {
      layout[key] = normalizeAnchor({
        ...candidate,
        rotation: optionalNumber(candidate, 'rotation') ?? legacyRotations[key] ?? 0,
      } as Anchor)
    } else {
      // 旧档无 layout 字段:补齐默认锚点(等价于改造前的硬编码位置),观感不变
      // 旧档的旋转同样要过归一化：-900 这种值必须收敛进 ±180
      layout[key] = normalizeAnchor({ ...anchors[key], rotation: legacyRotations[key] ?? 0 } as Anchor)
      repaired = true
    }
  }
  merged.layout = layout
  if (typeof raw.smartGuides !== 'boolean') {
    merged.smartGuides = false
    repaired = true
  }
  // 记住选中的分辨率模式：只按尺寸反查无法区分「宽屏预设」与「自定义填了同一组数字」
  merged.canvasPresetId = typeof raw.canvasPresetId === 'string' && raw.canvasPresetId !== ''
    ? raw.canvasPresetId
    : (findPreset(merged.canvas)?.id ?? CUSTOM_CANVAS_PRESET.id)
  const rawElements = raw.customElements
  let customIds: string[] = []
  if (!Array.isArray(rawElements)) {
    merged.customElements = []
    repaired = true
  } else {
    const kept = rawElements.filter(isValidCustomElement).slice(0, MAX_CUSTOM_ELEMENTS)
    if (kept.length !== rawElements.length) repaired = true
    merged.customElements = kept.map((e) => ({
      ...e,
      anchor: normalizeAnchor({
        ...e.anchor,
        // 旧档的旋转在元素上，现在归 anchor
        rotation: optionalNumber(e, 'rotation') ?? optionalNumber(e.anchor, 'rotation') ?? 0,
      } as Anchor),
      // 下表三项都是 2.0 新增：旧档必然缺失，补默认值而不是把整条元素判为非法
      curve: normalizeCurve(optionalNumber(e, 'curve')),
      direction: e.direction === 'vertical' ? 'vertical' : 'horizontal',
      aspect: optionalNumber(e, 'aspect') ?? 1,
    }))
    customIds = kept.map((e) => e.id)
  }
  // 两种排版的文本各自独立：旧档没有 titleFlow 字段，迁移时用当前左右两段填充一次，
  // 这样从分缝切到整块不会看到空标题（此后两者互不覆盖）
  if (typeof raw.titleFlow !== 'string') {
    merged.titleFlow = `${merged.titleLeft}${merged.titleRight}`
    repaired = true
  }
  if (typeof raw.seamGap !== 'number' || !Number.isFinite(raw.seamGap)) {
    merged.seamGap = CANVAS.SEAM_GAP
    repaired = true
  } else {
    merged.seamGap = normalizeSeamGap(raw.seamGap)
  }
  // 背景三字段旧档必然缺失。背景图只接受 data:image/*(与 Logo 同一条信任边界:
  // 放行外链会破坏「导出 SVG 自包含」),非法值就地回落为渐变而不是整档丢弃,
  // 并维持「image 模式必有背景图」这一不变式。
  if (raw.backgroundMode !== 'gradient' && raw.backgroundMode !== 'image') {
    merged.backgroundMode = 'gradient'
    repaired = true
  }
  const rawBgImage = raw.backgroundImage
  if (rawBgImage === undefined) {
    merged.backgroundImage = null
    repaired = true
  } else if (rawBgImage === null) {
    merged.backgroundImage = null
  } else if (typeof rawBgImage === 'string' && /^data:image\//i.test(rawBgImage)) {
    merged.backgroundImage = rawBgImage
  } else {
    merged.backgroundImage = null
    repaired = true
  }
  if (typeof raw.backgroundScrim !== 'number' || !Number.isFinite(raw.backgroundScrim)) {
    merged.backgroundScrim = CANVAS.BACKGROUND_SCRIM
    repaired = true
  } else {
    merged.backgroundScrim = normalizeBackgroundScrim(raw.backgroundScrim)
  }
  if (merged.backgroundMode === 'image' && !merged.backgroundImage) {
    merged.backgroundMode = 'gradient'
    repaired = true
  }
  // 文字排版样式旧档必然缺失;逐字段收敛而不是整块丢弃,已调好的字距/角度不因
  // 某一个字段非法而全部复原
  const rawStyles = raw.textStyles
  const styleDefaults = defaultTextStyles()
  if (typeof rawStyles !== 'object' || rawStyles === null) {
    merged.textStyles = styleDefaults
    repaired = true
  } else {
    const src = rawStyles as Record<string, unknown>
    const next = {} as TextStyleMap
    for (const key of TEXT_TARGETS) {
      if (src[key] === undefined) repaired = true
      next[key] = normalizeTextStyle(src[key], styleDefaults[key])
    }
    merged.textStyles = next
  }
  // 图层顺序先收敛为已知键并去重，再补上缺失项（新增元素、旧档无该字段）。
// 不去重会让同一元素被绘制两次（存档可被手工编辑，属于不可信输入）
  const known = new Set<string>(['title', 'subtitle', 'watermark', 'logo',
    ...customIds.map((id) => `custom:${id}`)])
  const declared: LayerKey[] = []
  if (Array.isArray(raw.layers)) {
    for (const k of raw.layers as unknown[]) {
      if (typeof k !== 'string' || !known.has(k)) continue
      if (declared.includes(k as LayerKey)) continue
      declared.push(k as LayerKey)
    }
  }
  const missing = [...known].filter((k) => !declared.includes(k as LayerKey)) as LayerKey[]
  if (declared.length !== known.size) repaired = true
  const ordered = [...declared, ...missing]
  // 自定义元素缺失时按默认次序补齐在前，避免升级后新元素默认压住标题
  merged.layers = ordered.length
    ? ordered
    : defaultLayers(customIds)
  if (raw.titleMode === undefined || raw.layout === undefined || raw.customElements === undefined
    || raw.canvas === undefined || raw.layers === undefined) {
    repaired = true
  }
  return repaired
}

/**
 * 把不可信的状态对象收敛成合法状态。
 *
 * 存档读取与「方案」载入走同一条路：两者拿到的都是可能被手工编辑过的 JSON，
 * 谁都不能直接塞进 state。返回 repaired 让调用方决定是否立即回写。
 */
export function adoptCoverState(raw: unknown): { state: CoverState; repaired: boolean } {
  try {
    if (typeof raw !== 'object' || raw === null) return { state: defaults(), repaired: false }
    const parsed = raw as Record<string, unknown>
    const migrated = typeof parsed.title === 'string' && parsed.titleLeft === undefined
    const merged = migrate(parsed, defaults())
    if (!isValidCover(merged)) return { state: defaults(), repaired: false }
    // 类型合法但语义越界的内容级修复(评审#2/M2):空 stops 会产出不渲染的
    // <linearGradient>(背景消失且「止」取色器失效);越界 offset/字号/角度
    // 污染 UI 显示。修复保留其余字段,不做整档回退;修复即回写。
    const newFieldsRepaired = repairNewFields(merged as CoverState & Record<string, unknown>, parsed)
    const repaired = normalize(merged)
    return { state: merged, repaired: migrated || newFieldsRepaired || repaired }
  } catch {
    return { state: defaults(), repaired: false }
  }
}

function load(): { state: CoverState; migrated: boolean } {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { state: defaults(), migrated: false }
    const { state, repaired } = adoptCoverState(JSON.parse(raw))
    return { state, migrated: repaired }
  } catch {
    return { state: defaults(), migrated: false }
  }
}

/** 内容级归一:返回 true 表示发生过修复。渐变修复后选中预设必然脱钩,归位默认。 */
function normalize(merged: CoverState): boolean {
  let repaired = false
  if (merged.gradient.stops.length < 2) {
    merged.gradient = { angle: DEFAULT_PRESET.angle, stops: DEFAULT_PRESET.stops.map((s) => ({ ...s })) }
    merged.presetId = DEFAULT_PRESET.id
    repaired = true
  } else {
    const angle = ((merged.gradient.angle % 360) + 360) % 360
    if (angle !== merged.gradient.angle) {
      merged.gradient.angle = angle
      repaired = true
    }
    for (const st of merged.gradient.stops) {
      const offset = Math.min(100, Math.max(0, st.offset))
      if (offset !== st.offset) {
        st.offset = offset
        repaired = true
      }
    }
  }
  const fontSize = Math.min(CANVAS.TITLE_BASE, Math.max(CANVAS.TITLE_MIN, merged.titleFontSize))
  if (fontSize !== merged.titleFontSize) {
    merged.titleFontSize = fontSize
    repaired = true
  }
  return repaired
}

/** 唯一状态源：深层 watch 防抖持久化到 localStorage（避免大 Logo 时每击键全量序列化），
 *  离页/切后台时立即落盘兜底；超配额/隐私模式降级内存态并经 persistError 显式提示 */
export function useCoverState(): Ref<CoverState> {
  const { state: initial, migrated } = load()
  const state = ref<CoverState>(initial)
  if (migrated) {
    // 旧档迁移后立即回写新结构，不再残留旧字段
    try {
      localStorage.setItem(KEY, JSON.stringify(initial))
      persistError.value = ''
    } catch {
      persistError.value = PERSIST_FAILED_MESSAGE
    }
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const persist = () => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    try {
      localStorage.setItem(KEY, JSON.stringify(state.value))
      persistError.value = ''
    } catch {
      // 超配额/隐私模式:降级内存态,但必须显式暴露——
      // 静默吞掉会让用户在无感知下丢失此后全部编辑(评审 M4)
      persistError.value = PERSIST_FAILED_MESSAGE
    }
  }
  watch(state, () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(persist, 300)
  }, { deep: true })
  // 离页/切后台兜底落盘。处理器必须是具名引用:visibilitychange 若用匿名函数,
  // 作用域销毁后无法 removeEventListener,监听器经闭包持有整份 state,
  // 随进出工作台次数线性泄漏(评审 I2)
  const onPageHide = () => persist()
  const onVisibilityChange = () => { if (document.hidden) persist() }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // 组件作用域销毁(SPA 路由离开工作台)时,原生监听不在 Vue 的清理范围:
  // 先冲刷未到期的防抖写入(否则最后 300ms 内的编辑丢失),再摘除监听
  onScopeDispose(() => {
    persist()
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }, true)
  return state
}

/** 标题排版模式的合法值守卫，供 UI 双向绑定使用 */
export function toTitleMode(v: string): TitleMode {
  return v === 'flow' ? 'flow' : 'split'
}