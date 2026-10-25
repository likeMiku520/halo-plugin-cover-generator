import type { CanvasSize } from './types'

/**
 * 智能参考线：拖动时的对齐吸附计算。
 *
 * 本模块只做「给定位移算吸附量」这一件纯计算，不持有任何状态，
 * 因为吸附量必须每帧从「未吸附的原始位置」重新算：一旦把上一帧的吸附结果
 * 当作下一帧的基准，元素贴上参考线后就再也拉不开（吸附变成粘住）。
 */

/**
 * 吸附阈值：画布宽/高的 0.6%。
 * 用比例而不是像素——画布可从 1200×630 换到 2133 高的竖版，
 * 固定像素阈值在小画布上过宽、在大画布上又吸不住。
 */
export const SNAP_THRESHOLD_RATIO = 0.006

/**
 * 距离比较的浮点余量：比例值由像素除法得来，数学上恰好等于阈值的对齐
 * 会因为 1e-16 的误差时灵时不灵。1e-9 的比例在 1200px 画布上不到百万分之一像素，
 * 不会把「明显够不着」的对齐吸进来。
 */
const SNAP_EPSILON = 1e-9

/** 参考线轴向：x 为垂直线（对齐横向坐标），y 为水平线 */
export type GuideAxis = 'x' | 'y'

export interface Guide {
  axis: GuideAxis
  /** 对齐位置：0–1 画布比例，渲染时直接当百分比用 */
  position: number
}

/** 参与对齐计算的矩形：画布像素坐标，与 elementGeometry 的包围盒同形 */
export interface AlignRect {
  x: number
  y: number
  width: number
  height: number
  /** 纵向视觉中心（几何层提供）；缺省时退化为包围盒中线 */
  centerY?: number
}

export interface SnapResult {
  /** 需要加到锚点上的位移（画布比例）；0 表示该轴未吸附 */
  dx: number
  dy: number
  /** 命中的参考线，最多两条（一竖一横） */
  guides: Guide[]
}

/** 候选对齐位类型：中心与边缘。同距平局时中心对中心优先 */
type CandidateKind = 'center' | 'edge'

interface Candidate {
  value: number
  kind: CandidateKind
  /**
   * 仅允许被「元素中心」命中。
   * 画布中线是「把元素摆到画布中间」，被宽元素的左右边缘贴上去反而会把元素推偏，
   * 因此它只跟中心比。
   */
  centerOnly?: boolean
}

/** 中心排在最前：距离相同时先撞上「中心对中心」，与用户理解的「中心对齐」一致 */
function candidatesOf(center: number, start: number, end: number): Candidate[] {
  return [
    { value: center, kind: 'center' },
    { value: start, kind: 'edge' },
    { value: end, kind: 'edge' },
  ]
}

/** 平局取舍：中心对中心 > 边缘对边缘 > 中心对边缘 */
function kindRank(a: Candidate, b: Candidate): number {
  if (a.kind === 'center' && b.kind === 'center') return 0
  if (a.kind === b.kind) return 1
  return 2
}

/** 单轴吸附：返回位移与该轴对齐到的位置（未命中返回 null） */
function snapAxis(
  dragged: Candidate[], targets: Candidate[], threshold: number,
): { delta: number; guide: number | null } {
  let best: { delta: number; guide: number; rank: number; distance: number } | null = null
  for (const d of dragged) {
    for (const t of targets) {
      if (t.centerOnly && d.kind !== 'center') continue
      const distance = Math.abs(t.value - d.value)
      if (distance > threshold + SNAP_EPSILON) continue
      const rank = kindRank(d, t)
      // 距离优先，平局看对齐类型；两者都相同则先到者胜（遍历次序固定 ⇒ 结果确定）
      const better = best === null || distance < best.distance
        || (distance === best.distance && rank < best.rank)
      if (better) best = { delta: t.value - d.value, guide: t.value, rank, distance }
    }
  }
  return best ? { delta: best.delta, guide: best.guide } : { delta: 0, guide: null }
}

/**
 * 计算吸附位移与参考线。
 *
 * box 必须是「未吸附位置」上的包围盒（被拖元素按下时的包围盒整体平移而来），
 * 用吸附后的盒子回算会让吸附自我强化。
 */
export function snapAnchor(input: {
  box: AlignRect
  canvas: CanvasSize
  /** 其余元素的包围盒：候选对齐位来自它们 */
  others: AlignRect[]
  threshold?: number
}): SnapResult {
  const { box, canvas, others } = input
  const threshold = input.threshold ?? SNAP_THRESHOLD_RATIO
  const W = canvas.width
  const H = canvas.height
  // 画布尺寸为 0 时全部分母失效；宁可不吸附，也不产出 NaN 坐标
  if (!(W > 0) || !(H > 0) || threshold <= 0) return { dx: 0, dy: 0, guides: [] }

  const centerY = box.centerY ?? box.y + box.height / 2
  const draggedX = candidatesOf((box.x + box.width / 2) / W, box.x / W, (box.x + box.width) / W)
  const draggedY = candidatesOf(centerY / H, box.y / H, (box.y + box.height) / H)

  // 画布中线 + 其他元素的中心与两条边缘
  const targetsX: Candidate[] = [{ value: 0.5, kind: 'center', centerOnly: true }]
  const targetsY: Candidate[] = [{ value: 0.5, kind: 'center', centerOnly: true }]
  for (const o of others) {
    // 退化矩形（宽高为 0）没有可对齐的视觉边缘，放进来只会制造假参考线
    if (!(o.width > 0) || !(o.height > 0)) continue
    const ocy = o.centerY ?? o.y + o.height / 2
    targetsX.push(...candidatesOf((o.x + o.width / 2) / W, o.x / W, (o.x + o.width) / W))
    targetsY.push(...candidatesOf(ocy / H, o.y / H, (o.y + o.height) / H))
  }

  const sx = snapAxis(draggedX, targetsX, threshold)
  const sy = snapAxis(draggedY, targetsY, threshold)
  const guides: Guide[] = []
  if (sx.guide !== null) guides.push({ axis: 'x', position: sx.guide })
  if (sy.guide !== null) guides.push({ axis: 'y', position: sy.guide })
  return { dx: sx.delta, dy: sy.delta, guides }
}