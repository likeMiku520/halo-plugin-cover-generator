import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { Anchor, AnchorKey, AnchorMap, CanvasSize, CoverState, LayerKey } from '../lib/types'
import { CANVAS, normalizeRotation, scaleLimitsOf } from '../lib/layout'
import type { ElementBox } from '../lib/elementGeometry'
import { snapAnchor, type AlignRect, type Guide } from '../lib/smartGuides'

/** 可交互目标：四个内置元素 + 自定义元素 */
export type SelectionId = AnchorKey | `custom:${string}`

export const ANCHOR_KEYS: AnchorKey[] = ['logo', 'title', 'subtitle', 'watermark']

const SELECTION_LABEL: Record<AnchorKey, string> = {
  logo: 'Logo',
  title: '标题',
  subtitle: '副标题',
  watermark: '水印',
}

export function anchorLabel(key: AnchorKey): string {
  return SELECTION_LABEL[key]
}

/**
 * 画布交互写回状态的最小字段集。
 *
 * 只列交互真正会改的字段：透明度由面板负责，
 * 交互回写时以现有锚点为底合并，绝不能因为「没提这个字段」而把它抹回默认值。
 */
export interface AnchorPatch {
  x?: number
  y?: number
  scale?: number
  /** 旋转角（度）：旋转手柄写回，由写回路径的 normalizeRotation 收敛进 ±180 */
  rotation?: number
}

/** 微调步长：方向键 1 步，Shift+方向键 10 步（单位为画布宽/高的千分之一） */
const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

/**
 * 锚点来源：内置元素在 layout，自定义元素在 customElements。
 *
 * 用结构类型而不是整个 CoverState：交互层只需要「按 id 取到锚点」这一件事，
 * 传完整状态或只传这两张表都成立，测试也就不必造一整份状态。
 */
export interface AnchorSource {
  layout: AnchorMap
  customElements: { id: string; anchor: Anchor }[]
}

/**
 * 按目标 id 取锚点（内置元素在 layout，自定义元素在 customElements）。
 *
 * 键盘微调、拖动、滚轮与写回共用这一份取值：各写一套的话，
 * 就会出现「拖得动、方向键却纹丝不动」这类按元素种类分叉的行为。
 */
export function anchorOfTargets(source: AnchorSource, id: SelectionId): Anchor | null {
  if (id.startsWith('custom:')) {
    const target = id.slice('custom:'.length)
    return source.customElements.find((el) => el.id === target)?.anchor ?? null
  }
  return source.layout[id as AnchorKey] ?? null
}

/**
 * 画布选中态与键盘微调。
 *
 * 选中由「元素」面板与画布点击共同驱动，两边都只是调用方：
 * 选中态本身只有工作台那一份，避免画布与面板各持一份而互相看不见对方的选择。
 */
export function useCanvasInteraction() {
  const selected = ref<SelectionId | null>(null)

  const hasSelection = computed(() => selected.value !== null)

  function select(id: SelectionId | null) {
    selected.value = id
  }

  /**
   * 键盘微调：方向键移动选中元素，Shift 加大步长。
   * 返回更新后的锚点与目标 id；非方向键或未选中时返回 null。
   * 只改位置——透明度/旋转原样带过，越界由写回路径的 normalizeAnchor 收敛。
   */
  function nudge(
    ev: KeyboardEvent,
    source: AnchorSource,
  ): { id: SelectionId; anchor: Anchor } | null {
    const id = selected.value
    if (!id) return null
    const step = (ev.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP) / 1000
    // 自定义元素同样在 source 里：内置与自定义的微调走同一条取值路径
    const current = anchorOfTargets(source, id)
    if (!current) return null
    let dx = 0
    let dy = 0
    switch (ev.key) {
      case 'ArrowLeft': dx = -step; break
      case 'ArrowRight': dx = step; break
      case 'ArrowUp': dy = -step; break
      case 'ArrowDown': dy = step; break
      default: return null
    }
    ev.preventDefault()
    return { id, anchor: { ...current, x: current.x + dx, y: current.y + dy } }
  }

  return { selected, hasSelection, select, nudge }
}

/** 画布坐标点：0–1 比例，与渲染共用同一套坐标（除以画布尺寸即可） */
export interface CanvasPoint {
  x: number
  y: number
}

/**
 * 选中元素能否删除（即选中框右上角是否显示 ×）。
 * 标题不可删除：标题一旦清掉，这张封面就没有主体了；要退出标题编辑走「点空白取消选中」。
 */
export function canDeleteSelection(id: SelectionId): boolean {
  return id !== 'title'
}

export interface DeleteResult {
  /** 并入状态的补丁；调用方负责合并，策略本身不碰状态容器 */
  patch: Partial<CoverState>
  /** 是否同时清掉选中态：元素真的没了才清，避免选中态指向不存在的目标 */
  clearSelection: boolean
}

/**
 * 选中元素上「×」的动作策略——唯一一份。
 *
 * Logo 只关显示（不删用户选的图）、副标题/水印清空输入、自定义元素真删除并同步图层表；
 * 标题返回 null（按钮也不渲染）。放在这里而不是散进组件：画布与面板日后各加入口时，
 * 策略仍然只有这一处，不会出现「某个入口删得掉、另一个删不掉」。
 */
export function deleteSelection(state: CoverState, id: SelectionId): DeleteResult | null {
  if (!canDeleteSelection(id)) return null
  if (id === 'logo') return { patch: { logoHidden: true }, clearSelection: false }
  if (id === 'subtitle') return { patch: { subtitle: '' }, clearSelection: false }
  if (id === 'watermark') return { patch: { watermark: '' }, clearSelection: false }
  const target = id.slice('custom:'.length)
  return {
    patch: {
      customElements: state.customElements.filter((el) => el.id !== target),
      // 图层表必须同步清理：留着已删除的键，绘制次序里就会挂着一个不存在的元素
      layers: state.layers.filter((key) => key !== (`custom:${target}` as LayerKey)),
    },
    clearSelection: true,
  }
}

// ---------------------------------------------------------------------------
// 画布指针交互（拖动 / 滚轮 / 参考线）
//
// 与上面的选中态分开成两个组合式函数：选中态归工作台持有（面板与画布共读一份），
// 而拖动会话只属于预览层那一次指针操作。若合成一个实例，
// 预览层就会多出一个「谁也没在看的 selected」，日后误用必然出现两份选择。
// ---------------------------------------------------------------------------

/**
 * 命中测试：返回指针落在哪个元素上，空白处返回 null。
 *
 * 用包围盒（而非事件目标）判定：多个元素可以上下重叠，且命中框里还有
 * 选中环、标签等子节点，按坐标判定才能保证「点到谁就是谁」。
 * 旋转元素按未旋转的包围盒命中——视觉上略宽，但旋转后的小字仍能一次点中。
 */
export function hitTest(input: {
  boxes: ElementBox[]
  point: CanvasPoint
  canvas: CanvasSize
  /** 图层顺序（数组靠后者在上层）；重叠时取上层，与肉眼所见一致 */
  layers?: LayerKey[]
}): SelectionId | null {
  const { boxes, point, canvas, layers } = input
  const px = point.x * canvas.width
  const py = point.y * canvas.height
  let bestId: SelectionId | null = null
  let bestOrder = -Infinity
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]
    if (!(box.width > 0) || !(box.height > 0)) continue
    if (px < box.x || px > box.x + box.width || py < box.y || py > box.y + box.height) continue
    // 不在图层表中的元素排在已知图层之后（自定义元素本就在包围盒数组末尾，天然更靠上）
    const inLayers = layers ? layers.indexOf(box.id as LayerKey) : -1
    const order = inLayers >= 0 ? inLayers : (layers?.length ?? 0) + i
    if (order >= bestOrder) {
      bestOrder = order
      bestId = box.id as SelectionId
    }
  }
  return bestId
}

/** 一次拖动会话：按下时的锚点与包围盒是一切位移的基准 */
interface DragSession {
  id: SelectionId
  origin: Anchor
  box: ElementBox
  /** 按下时的指针位置（画布比例） */
  start: CanvasPoint
}

/** 一次旋转会话：以元素锚点为圆心，记下按下时的指针角与当时的旋转角 */
interface RotateSession {
  id: SelectionId
  origin: Anchor
  /** 圆心（画布比例）：就是元素锚点，渲染层也是绕它转的 */
  center: CanvasPoint
  startAngle: number
}

/**
 * 一次拉大会话：以元素锚点为圆心，每一步按「这一步的距离 / 上一步的距离」缩放。
 *
 * 为什么是逐步比值而不是「当前距离 / 起点距离」的绝对映射：标题与自定义图片/SVG 的
 * 大小各有 owner（字号、px 边长），写回时锚点倍率会被归位成 1，于是「写回的倍率」
 * 在那类元素上等于「这次乘多少」。逐步比值与滚轮是同一个语义，
 * 绝对映射则会被当成一次乘法而连乘出错误结果（实测差值一倍）。
 */
interface ScaleSession {
  id: SelectionId
  center: CanvasPoint
  /** 上一步的指针距离（px）：分母，已做下限保护 */
  lastDistance: number
}

/** 指针到圆心的距离（画布像素） */
function distanceOf(point: CanvasPoint, center: CanvasPoint, canvas: CanvasSize): number {
  const dx = (point.x - center.x) * canvas.width
  const dy = (point.y - center.y) * canvas.height
  return Math.hypot(dx, dy)
}

/**
 * 指针相对圆心的角度（度）。
 *
 * 必须换算到画布像素再算：比例坐标的 x/y 分母不同（宽 vs 高），
 * 直接对比例值取 atan2 会让非正方形画布上的角度整体歪掉。
 */
function angleOf(point: CanvasPoint, center: CanvasPoint, canvas: CanvasSize): number {
  const dx = (point.x - center.x) * canvas.width
  const dy = (point.y - center.y) * canvas.height
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/** 滚轮一格（约 100px）约 2%：再大就跳格，再小则长滚也不动 */
const WHEEL_PERCENT_PER_PIXEL = 0.02
/** 行模式(deltaMode=1)与页模式(2)折算成像素：各家浏览器给出的单位差异极大 */
const WHEEL_LINE_PX = 16
const WHEEL_PAGE_PX = 400
/** 单次事件的步进上限：个别驱动会给出上千像素的 deltaY，不限幅会一滚跳掉半个大小 */
const WHEEL_MAX_STEP_PERCENT = 10
/**
 * 滚轮会话的静默窗口：最后一次滚动后这么久没有新事件才算「滚完了」。
 * 窗口内预览都不走防抖，滚完自动恢复（否则图元会落后于滚轮）。
 */
const WHEEL_IDLE_MS = 250

/** 锚点安全域：与 normalizeAnchor 同源，拖动时就把坐标夹住 */
const clampX = (n: number) => Math.min(1 - CANVAS.MARGIN_X, Math.max(CANVAS.MARGIN_X, n))
const clampY = (n: number) => Math.min(1 - CANVAS.MARGIN_Y, Math.max(CANVAS.MARGIN_Y, n))

/**
 * 倍率边界的夹取——面板滑杆、滚轮与写回路径共用这一套裁决。
 *
 * 界内的值直接夹到边界；当前值本就在界外时（旧档可能存着比面板更宽的倍率）
 * 只允许朝界内的方向继续走：既不会被一次滚动弹到另一头，也不会卡死在界外。
 */
export function clampScalePercent(
  target: number, current: number, min: number, max: number,
): number {
  if (target > max) return current > max ? Math.min(target, current) : max
  if (target < min) return current < min ? Math.max(target, current) : min
  return target
}

/**
 * 预览画布上的拖动、滚轮缩放与智能参考线。
 *
 * 只负责算出「下一个锚点值」并把参考线呈现出来，写回状态由调用方经既有更新路径完成，
 * 因此这里不碰 CoverState，也就不会出现绕开状态校验的第二条写入通道。
 */
export function useCanvasDrag() {
  const guides = ref<Guide[]>([])
  const dragging = ref(false)
  const wheeling = ref(false)
  const rotating = ref(false)
  const scaling = ref(false)
  /**
   * 是否正处于一次画布交互（拖动/旋转/拉大/滚轮窗口）中。
   * 预览层据此旁路渲染防抖：防抖是为打字合帧，交互期间它只会让图元落后于指针。
   */
  const interacting = computed(
    () => dragging.value || rotating.value || scaling.value || wheeling.value,
  )
  let session: DragSession | null = null
  let rotateSession: RotateSession | null = null
  let scaleSession: ScaleSession | null = null
  /** 不足一个百分点的零头：攒到下一次滚轮，慢滚时既不「纹丝不动」也不跳格 */
  let wheelRemainder = 0
  let wheelIdleTimer: ReturnType<typeof setTimeout> | undefined

  // 组件卸载时清掉待触发的窗口计时器；组合式函数也可能在组件外被调用（测试），故先判作用域
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (wheelIdleTimer) clearTimeout(wheelIdleTimer)
    })
  }

  /** 进入拖动：以按下瞬间的锚点与包围盒为基准 */
  function begin(o: { id: SelectionId; anchor: Anchor; box: ElementBox; point: CanvasPoint }) {
    session = { id: o.id, origin: { ...o.anchor }, box: { ...o.box }, start: { ...o.point } }
    dragging.value = true
    guides.value = []
  }

  /**
   * 指针移动：返回该写回的锚点坐标；未在拖动中返回 null。
   *
   * 位置一律由「按下点 + 累计指针位移」重算，绝不累加吸附量，
   * 这样指针离开吸附范围的那一刻元素就自然脱离（不粘住）。
   */
  function move(
    point: CanvasPoint,
    ctx: { canvas: CanvasSize; boxes: ElementBox[]; snap: boolean },
  ): { id: SelectionId; x: number; y: number } | null {
    const s = session
    if (!s) return null
    const { canvas } = ctx
    const rawX = clampX(s.origin.x + (point.x - s.start.x))
    const rawY = clampY(s.origin.y + (point.y - s.start.y))
    let x = rawX
    let y = rawY
    let nextGuides: Guide[] = []
    if (ctx.snap) {
      // 被拖元素在「未吸附位置」上的包围盒：按下时的框整体平移，尺寸不变
      const box: AlignRect = {
        x: s.box.x + (rawX - s.origin.x) * canvas.width,
        y: s.box.y + (rawY - s.origin.y) * canvas.height,
        width: s.box.width,
        height: s.box.height,
        centerY: s.box.centerY + (rawY - s.origin.y) * canvas.height,
      }
      const snapped = snapAnchor({
        box,
        canvas,
        others: ctx.boxes.filter((b) => b.id !== s.id),
      })
      x = clampX(rawX + snapped.dx)
      y = clampY(rawY + snapped.dy)
      // 被边界截断的轴不画线：线画在那里而元素并没有贴上去，比不画更误导
      nextGuides = snapped.guides.filter((g) =>
        (g.axis === 'x' ? x === rawX + snapped.dx : y === rawY + snapped.dy))
    }
    guides.value = nextGuides
    return { id: s.id, x, y }
  }

  /** 结束拖动：参考线只属于拖动过程，松手即消失 */
  function end() {
    session = null
    rotateSession = null
    scaleSession = null
    dragging.value = false
    rotating.value = false
    scaling.value = false
    guides.value = []
  }

  /**
   * 进入旋转：以按下瞬间的指针角为基准，之后写回的是「转了这么多度」而不是绝对角，
   * 这样手柄抓在哪、元素就从哪个角度开始转，不会一按下就跳到某个固定角度。
   */
  function beginRotate(o: {
    id: SelectionId; anchor: Anchor; canvas: CanvasSize; point: CanvasPoint
  }) {
    const center = { x: o.anchor.x, y: o.anchor.y }
    rotateSession = {
      id: o.id,
      origin: { ...o.anchor },
      center,
      startAngle: angleOf(o.point, center, o.canvas),
    }
    rotating.value = true
  }

  /** 指针移动：返回该写回的旋转角；未在旋转中返回 null */
  function rotateTo(
    point: CanvasPoint,
    canvas: CanvasSize,
  ): { id: SelectionId; rotation: number } | null {
    const r = rotateSession
    if (!r) return null
    const delta = angleOf(point, r.center, canvas) - r.startAngle
    // 收敛交给 normalizeRotation：面板滑杆与旋转手柄共用同一套 ±180 边界
    return { id: r.id, rotation: normalizeRotation(r.origin.rotation + delta) }
  }

  /** 进入拉大：记下按下点到锚点的距离，之后每一步按距离比缩放 */
  function beginScale(o: {
    id: SelectionId; anchor: Anchor; canvas: CanvasSize; point: CanvasPoint
  }) {
    const center = { x: o.anchor.x, y: o.anchor.y }
    // 下限 1px：按下点几乎压在锚点上时分母不能是 0，否则比值会炸成 Infinity
    const startDistance = Math.max(distanceOf(o.point, center, o.canvas), 1)
    scaleSession = { id: o.id, center, lastDistance: startDistance }
    scaling.value = true
  }

  /**
   * 指针移动：返回该写回的倍率（整数百分比）；未在拉大中或没有变化时返回 null。
   *
   * currentScale 由调用方从状态里读（与滚轮同一份来源）：写回的倍率对「倍率归位为 1」的
   * 元素意味着乘多少，对其他元素意味着新的倍率，两种语义在同一个公式下都成立。
   *
   * 这里**不夹边界**：一次拖到底要能直接从 24px 到 600px，边界交给写回路径按 owner
   * 的那一次裁决（图片/SVG 夹 px、字号夹 pt、其余元素夹 scaleLimitsOf）。
   */
  function scaleTo(
    point: CanvasPoint,
    canvas: CanvasSize,
    currentScale: number,
  ): { id: SelectionId; scale: number } | null {
    const s = scaleSession
    if (!s) return null
    const distance = distanceOf(point, s.center, canvas)
    const stepRatio = distance / s.lastDistance
    // 分母即使这一步不写回也要推进：否则下一步的比值会从旧位置起算而跳变
    s.lastDistance = Math.max(distance, 1)
    const current = Math.round(currentScale * 100)
    const percent = Math.round(current * stepRatio)
    if (percent === current) return null
    return { id: s.id, scale: percent / 100 }
  }

  /**
   * 滚轮缩放：返回新的倍率（必为整数百分比）；未产生变化时返回 null。
   * 上滚放大、下滚缩小；边界按当前选中元素取（与面板滑杆同一份表）。
   */
  function scaleByWheel(ev: WheelEvent, id: SelectionId, currentScale: number): number | null {
    const mode = ev.deltaMode === 1 ? WHEEL_LINE_PX : ev.deltaMode === 2 ? WHEEL_PAGE_PX : 1
    const px = ev.deltaY * mode
    if (!Number.isFinite(px) || px === 0) return null
    // deltaY<0 是上滚 ⇒ 变大，与「向上＝放大」的直觉一致
    wheelRemainder += -px * WHEEL_PERCENT_PER_PIXEL
    const raw = Math.trunc(wheelRemainder)
    if (raw === 0) return null
    wheelRemainder -= raw // 已消费的整步不再重复计入
    const steps = Math.max(-WHEEL_MAX_STEP_PERCENT, Math.min(WHEEL_MAX_STEP_PERCENT, raw))
    const current = Math.round(currentScale * 100)
    const target = current + steps
    const limits = scaleLimitsOf(id)
    const percent = clampScalePercent(target, current, limits.min, limits.max)
    // 顶到边界后清零零头：否则反向滚动要先「还债」，手感像卡住
    if (percent !== target) wheelRemainder = 0
    // 已经在边界上：本次滚动不产生变化，不写回状态（页面滚动仍由调用方拦下）
    if (percent === current) return null
    return percent / 100
  }

  /** 标记一次滚轮活动：窗口内预览不走防抖，滚完（静默 WHEEL_IDLE_MS）自动收起 */
  function markWheelActivity() {
    wheeling.value = true
    if (wheelIdleTimer) clearTimeout(wheelIdleTimer)
    wheelIdleTimer = setTimeout(() => {
      wheeling.value = false
      wheelIdleTimer = undefined
    }, WHEEL_IDLE_MS)
  }

  return {
    guides, dragging, rotating, scaling, wheeling, interacting,
    begin, move, beginRotate, rotateTo, beginScale, scaleTo, end, scaleByWheel, markWheelActivity,
  }
}