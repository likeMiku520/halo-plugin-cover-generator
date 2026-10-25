import { describe, expect, it, vi } from 'vitest'
import {
  anchorOfTargets, canDeleteSelection, clampScalePercent, deleteSelection, hitTest,
  ROTATION_MAGNETS, useCanvasDrag, useCanvasInteraction,
  type AnchorSource, type SelectionId,
} from './useCanvasInteraction'
import type { Anchor, AnchorMap, CustomElement, LayerKey } from '../lib/types'
import type { ElementBox } from '../lib/elementGeometry'
// scaleLimitsOf 的归属已收到 layout：滚轮与面板共用同一份，测试也直接对着它
import { ELEMENT_SCALE_LIMITS, defaultAnchors, defaultCoverState, scaleLimitsOf } from '../lib/layout'

/**
 * 画布交互。
 *
 * 画布固定 1024×1024、包围盒坐标全用整数像素：比例值的分母都是 2 的幂，
 * 吸附位置与距离断言不会掺入浮点噪声。
 */
const CANVAS = { width: 1024, height: 1024 }

const RATIO = (px: number) => px / CANVAS.width

const anchorAt = (x: number, y: number, scale = 1): Anchor => ({ x, y, scale, opacity: 1, rotation: 0 })

/** 微调/拖动共用的锚点来源：内置 layout + 若干自定义元素 */
function sourceOf(customs: Record<string, Anchor> = {}, layout: AnchorMap = defaultAnchors()): AnchorSource {
  return {
    layout,
    customElements: Object.entries(customs).map(([id, anchor]) => ({ id, anchor })),
  }
}

/** 以 (cx, cy) 为中心、边长 128px 的包围盒（边缘落在比例值的 1/16 网格上） */
function boxCenteredAt(cx: number, cy: number, id: SelectionId = 'title'): ElementBox {
  const half = 64
  return {
    id, label: id, x: cx - half, y: cy - half, width: 128, height: 128, centerY: cy,
  }
}

const dragCtx = (boxes: ElementBox[] = [], snap = false) => ({ canvas: CANVAS, boxes, snap })

describe('hitTest 命中测试', () => {
  const box = boxCenteredAt(512, 512)

  it('指针落在包围盒内命中该元素', () => {
    expect(hitTest({ boxes: [box], point: { x: 0.5, y: 0.5 }, canvas: CANVAS })).toBe('title')
    expect(hitTest({ boxes: [box], point: { x: 0.55, y: 0.45 }, canvas: CANVAS })).toBe('title')
  })

  it('空白处返回 null(点空白不改选中、也不拖动)', () => {
    expect(hitTest({ boxes: [box], point: { x: 0.1, y: 0.1 }, canvas: CANVAS })).toBeNull()
    expect(hitTest({ boxes: [], point: { x: 0.5, y: 0.5 }, canvas: CANVAS })).toBeNull()
  })

  it('重叠时取图层顺序靠上的元素(与遮挡关系一致)', () => {
    const under = boxCenteredAt(512, 512, 'logo')
    const over = boxCenteredAt(512, 512, 'title')
    const layers: LayerKey[] = ['logo', 'title']
    expect(hitTest({ boxes: [under, over], point: { x: 0.5, y: 0.5 }, canvas: CANVAS, layers }))
      .toBe('title')
    // 把 Logo 调到上层后命中结果随之翻转
    expect(hitTest({
      boxes: [under, over], point: { x: 0.5, y: 0.5 }, canvas: CANVAS,
      layers: ['title', 'logo'],
    })).toBe('logo')
  })

  it('缺失图层表时按包围盒次序取靠后的(自定义元素天然在上层)', () => {
    const builtin = boxCenteredAt(512, 512, 'title')
    const custom = boxCenteredAt(512, 512, 'custom:abc')
    expect(hitTest({ boxes: [builtin, custom], point: { x: 0.5, y: 0.5 }, canvas: CANVAS }))
      .toBe('custom:abc')
  })

  it('退化包围盒(宽高为 0)不参与命中,避免空元素抢走点击', () => {
    const empty: ElementBox = { id: 'title', label: '标题', x: 512, y: 512, width: 0, height: 0, centerY: 512 }
    expect(hitTest({ boxes: [empty], point: { x: 0.5, y: 0.5 }, canvas: CANVAS })).toBeNull()
  })

  it('旋转元素按其包围盒命中(旋转后的包围盒仍能一次点中)', () => {
    const rotated: ElementBox = {
      ...boxCenteredAt(512, 512),
      rotation: 30,
      pivot: { x: 512, y: 512 },
    }
    expect(hitTest({ boxes: [rotated], point: { x: 0.5, y: 0.5 }, canvas: CANVAS })).toBe('title')
  })
})

describe('useCanvasInteraction 选中与键盘微调', () => {
  it('选中/取消选中,hasSelection 随之变化', () => {
    const { selected, hasSelection, select } = useCanvasInteraction()
    expect(hasSelection.value).toBe(false)

    select('title')
    expect(selected.value).toBe('title')
    expect(hasSelection.value).toBe(true)

    select(null)
    expect(hasSelection.value).toBe(false)
  })

  it('方向键微调选中元素:一步为画布宽高的千分之一', () => {
    const { select, nudge } = useCanvasInteraction()
    select('title')
    const source = sourceOf()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })

    const next = nudge(ev, source)

    expect(next?.id).toBe('title')
    expect(next?.anchor.x).toBeCloseTo(source.layout.title.x + 0.001, 10)
    // 只改位置:透明度/旋转原样带过,写回路径不会把它们抹掉
    expect(next?.anchor).toMatchObject({
      opacity: source.layout.title.opacity,
      rotation: source.layout.title.rotation,
    })
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Shift 加速:一步为千分之十', () => {
    const { select, nudge } = useCanvasInteraction()
    select('subtitle')
    const source = sourceOf()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, cancelable: true })

    expect(nudge(ev, source)?.anchor.y).toBeCloseTo(source.layout.subtitle.y + 0.01, 10)
  })

  it('选中自定义元素后方向键同样微调(锚点取自 customElements)', () => {
    const { select, nudge } = useCanvasInteraction()
    select('custom:el-1')
    const source = sourceOf({ 'el-1': anchorAt(0.2, 0.3) })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })

    const next = nudge(ev, source)

    expect(next?.id).toBe('custom:el-1')
    expect(next?.anchor.x).toBeCloseTo(0.201, 10)
    expect(next?.anchor.y).toBeCloseTo(0.3, 10)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Shift 加速对自定义元素同样生效;目标已不存在时不写回', () => {
    const { select, nudge } = useCanvasInteraction()
    select('custom:el-1')
    const source = sourceOf({ 'el-1': anchorAt(0.2, 0.3, 1) })

    const fast = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, cancelable: true })
    expect(nudge(fast, source)?.anchor.y).toBeCloseTo(0.31, 10)

    // 元素在别处被删掉(存档被改):找不到锚点就什么都不做,不能抛错
    select('custom:deleted')
    const gone = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    expect(nudge(gone, source)).toBeNull()
    expect(gone.defaultPrevented).toBe(false)
  })

  it('未选中或非方向键时不介入(不阻止默认行为)', () => {
    const { nudge } = useCanvasInteraction()
    const source = sourceOf()
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    expect(nudge(arrow, source)).toBeNull()
    expect(arrow.defaultPrevented).toBe(false)

    const { select, nudge: nudge2 } = useCanvasInteraction()
    select('title')
    const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
    expect(nudge2(other, source)).toBeNull()
    expect(other.defaultPrevented).toBe(false)
  })

  it('anchorOfTargets 同时覆盖内置与自定义元素', () => {
    const source = sourceOf({ 'el-1': anchorAt(0.2, 0.3) })

    expect(anchorOfTargets(source, 'logo')).toBe(source.layout.logo)
    expect(anchorOfTargets(source, 'custom:el-1')).toBe(source.customElements[0].anchor)
    expect(anchorOfTargets(source, 'custom:missing')).toBeNull()
  })
})

describe('clampScalePercent 倍率边界(面板/滚轮/写回共用)', () => {
  it('界内的目标原样返回', () => {
    expect(clampScalePercent(120, 100, 20, 300)).toBe(120)
  })

  it('超上界:界内值夹到上界,本就在界外的值只允许往回走', () => {
    expect(clampScalePercent(400, 100, 20, 300)).toBe(300)
    // 旧档存的 400% 继续往上滚：不再越走越远
    expect(clampScalePercent(420, 400, 20, 300)).toBe(400)
    // 往回滚则允许（朝界内）
    expect(clampScalePercent(380, 400, 20, 300)).toBe(380)
  })

  it('低于下界同理:界内值夹到下界,界外值只允许朝界内走', () => {
    expect(clampScalePercent(5, 100, 20, 300)).toBe(20)
    expect(clampScalePercent(8, 10, 20, 300)).toBe(10)
    expect(clampScalePercent(12, 10, 20, 300)).toBe(12)
  })
})

describe('useCanvasDrag 拖动改位置', () => {
  it('按住元素拖动,位置按指针位移改变比例', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })
    expect(drag.dragging.value).toBe(true)

    const next = drag.move({ x: 0.7, y: 0.6 }, dragCtx())

    expect(next?.id).toBe('title')
    expect(next?.x).toBeCloseTo(0.7, 10)
    expect(next?.y).toBeCloseTo(0.6, 10)
  })

  it('坐标夹在 0–100%,拖出画布不会越界', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    expect(drag.move({ x: 4, y: 9 }, dragCtx())).toMatchObject({ x: 1, y: 1 })
    expect(drag.move({ x: -4, y: -9 }, dragCtx())).toMatchObject({ x: 0, y: 0 })
  })

  it('没有按下过指针时 move 返回 null(空白处的移动不算拖动)', () => {
    const drag = useCanvasDrag()
    expect(drag.move({ x: 0.6, y: 0.6 }, dragCtx())).toBeNull()
    expect(drag.dragging.value).toBe(false)
  })

  it('关闭参考线时不吸附、不产出参考线', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    const next = drag.move({ x: 0.505, y: 0.62 }, dragCtx([], false))

    expect(next?.x).toBeCloseTo(0.505, 10)
    expect(drag.guides.value).toEqual([])
  })

  it('开启参考线时吸附到画布中线,并给出居中参考线', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    // 原始位置 0.505，距中线 0.005(在 0.6% 阈值内)
    const next = drag.move({ x: 0.505, y: 0.62 }, dragCtx([], true))

    expect(next?.x).toBeCloseTo(0.5, 10)
    expect(drag.guides.value).toEqual([{ axis: 'x', position: 0.5 }])
  })

  it('吸附后能自然脱离:指针移出阈值即恢复跟手,不会粘在中线上', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    expect(drag.move({ x: 0.505, y: 0.62 }, dragCtx([], true))?.x).toBeCloseTo(0.5, 10)
    // 同一次拖动内继续移动：吸附量不得被累加进基准
    const away = drag.move({ x: 0.53, y: 0.62 }, dragCtx([], true))

    expect(away?.x).toBeCloseTo(0.53, 10)
    expect(drag.guides.value).toEqual([])
  })

  it('与其他元素对齐时吸附到它的中心并画出该线', () => {
    const drag = useCanvasDrag()
    // 另一元素(x=300..428px ⇒ 中心 364/1024)，放在画布下半部避免纵向干扰
    const other: ElementBox = {
      id: 'subtitle', label: '副标题', x: 300, y: 800, width: 128, height: 60, centerY: 830,
    }
    const centerX = RATIO(364)
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    // 指针落在另一元素中心右侧 2px 处(阈值内)
    const next = drag.move(
      { x: centerX + RATIO(2), y: 0.62 },
      dragCtx([other, boxCenteredAt(512, 512, 'title')], true),
    )

    expect(next?.x).toBeCloseTo(centerX, 10)
    expect(drag.guides.value).toEqual([{ axis: 'x', position: centerX }])
  })

  it('被拖元素自己被排除在候选之外(不会吸附到自己身上)', () => {
    const drag = useCanvasDrag()
    const self = boxCenteredAt(512, 512, 'title')
    drag.begin({ id: 'title', anchor: anchorAt(0.5, 0.5), box: self, point: { x: 0.5, y: 0.5 } })

    const next = drag.move({ x: 0.6, y: 0.62 }, dragCtx([self, boxCenteredAt(300, 900, 'logo')], true))

    expect(next?.x).toBeCloseTo(0.6, 10)
    expect(drag.guides.value).toEqual([])
  })

  it('被边界截断的轴不画参考线(线在那儿而元素没贴上去更误导)', () => {
    const drag = useCanvasDrag()
    // 右对齐元素：锚点在右缘(1.0)，包围盒右缘比锚点缩进 2px
    const box: ElementBox = { id: 'watermark', label: '水印', x: 1014, y: 448, width: 8, height: 128, centerY: 512 }
    drag.begin({ id: 'watermark', anchor: anchorAt(1, 0.5), box, point: { x: 1, y: 0.5 } })

    // 另一元素右缘正好贴住画布右缘：吸附量会把锚点推到 1.0 之外，只能截断
    const other: ElementBox = {
      id: 'title', label: '标题', x: 900, y: 0, width: 124, height: 64, centerY: 32,
    }
    const next = drag.move({ x: 1, y: 0.5 }, dragCtx([other], true))

    expect(next?.x).toBe(1) // 夹在边界
    // 横向被截断 ⇒ 不画竖线；纵向中心恰在中线上，横线保留
    expect(drag.guides.value).toEqual([{ axis: 'y', position: 0.5 }])
  })

  it('结束拖动后参考线消失', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })
    drag.move({ x: 0.505, y: 0.62 }, dragCtx([], true))
    expect(drag.guides.value).not.toEqual([])

    drag.end()

    expect(drag.guides.value).toEqual([])
    expect(drag.dragging.value).toBe(false)
    expect(drag.move({ x: 0.9, y: 0.9 }, dragCtx([], true))).toBeNull()
  })

  it('拖动以按下点为基准:来回移动不累积位移', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    expect(drag.move({ x: 0.6, y: 0.5 }, dragCtx())?.x).toBeCloseTo(0.6, 10)
    expect(drag.move({ x: 0.55, y: 0.5 }, dragCtx())?.x).toBeCloseTo(0.55, 10)
    expect(drag.move({ x: 0.6, y: 0.5 }, dragCtx())?.x).toBeCloseTo(0.6, 10)
  })

  it('吸附量不进基准:进出吸附区后回到原位仍是同一个值', () => {
    const drag = useCanvasDrag()
    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })

    expect(drag.move({ x: 0.505, y: 0.62 }, dragCtx([], true))?.x).toBeCloseTo(0.5, 10)
    expect(drag.move({ x: 0.53, y: 0.62 }, dragCtx([], true))?.x).toBeCloseTo(0.53, 10)
    // 回到吸附区内：仍吸到 0.5，而不是被上一次的吸附量带到 0.495
    expect(drag.move({ x: 0.505, y: 0.62 }, dragCtx([], true))?.x).toBeCloseTo(0.5, 10)
  })
})

describe('useCanvasDrag 滚轮改大小', () => {
  const wheel = (deltaY: number, deltaMode = 0) => {
    const ev = new WheelEvent('wheel', { deltaY, deltaMode, cancelable: true })
    return ev
  }

  it('上滚变大、下滚变小,且结果落在整数百分比上', () => {
    const drag = useCanvasDrag()

    const up = drag.scaleByWheel(wheel(-100), 'logo', 1)
    expect(up).toBeCloseTo(1.02, 10)
    expect(Math.abs(up! * 100 - Math.round(up! * 100))).toBeLessThan(1e-9)

    const down = drag.scaleByWheel(wheel(100), 'logo', 1)
    expect(down).toBeCloseTo(0.98, 10)
    expect(Math.abs(down! * 100 - Math.round(down! * 100))).toBeLessThan(1e-9)
  })

  it('步进平滑:不足一个百分点的滚动先攒着,攒够才动一格', () => {
    const drag = useCanvasDrag()

    // 30px ⇒ 0.6%，不足 1%：先不动，避免慢滚时一格一格地跳
    expect(drag.scaleByWheel(wheel(-30), 'logo', 1)).toBeNull()
    // 再 30px ⇒ 累计 1.2% ⇒ 走 1%
    expect(drag.scaleByWheel(wheel(-30), 'logo', 1)).toBeCloseTo(1.01, 10)
  })

  it('任意滚动次数后倍率都停在整数百分比', () => {
    const drag = useCanvasDrag()
    let scale = 1
    for (const delta of [-30, -30, -7, 55, -12, 130, -3]) {
      scale = drag.scaleByWheel(wheel(delta), 'logo', scale) ?? scale
      expect(Math.abs(scale * 100 - Math.round(scale * 100))).toBeLessThan(1e-9)
    }
  })

  it('倍率边界按选中元素取,与面板滑杆同一份表', () => {
    const drag = useCanvasDrag()

    // 副标题：1%–100%
    expect(drag.scaleByWheel(wheel(-100), 'subtitle', 0.99)).toBeCloseTo(1, 10)
    expect(drag.scaleByWheel(wheel(-100), 'subtitle', 1)).toBeNull() // 已在 100%：不写回
    expect(drag.scaleByWheel(wheel(100), 'subtitle', 0.02)).toBeCloseTo(0.01, 10)
    expect(drag.scaleByWheel(wheel(100), 'subtitle', 0.01)).toBeNull()

    // 水印：1%–300%
    expect(drag.scaleByWheel(wheel(-100), 'watermark', 2.99)).toBeCloseTo(3, 10)
    expect(drag.scaleByWheel(wheel(-100), 'watermark', 3)).toBeNull()
    expect(drag.scaleByWheel(wheel(100), 'watermark', 0.02)).toBeCloseTo(0.01, 10)

    // 其余（Logo / 标题 / 自定义元素）：20%–300%
    expect(drag.scaleByWheel(wheel(-100), 'logo', 2.99)).toBeCloseTo(3, 10)
    expect(drag.scaleByWheel(wheel(-100), 'custom:el-1', 3)).toBeNull()
    expect(drag.scaleByWheel(wheel(100), 'logo', 0.21)).toBeCloseTo(0.2, 10)
    expect(drag.scaleByWheel(wheel(100), 'title', 0.2)).toBeNull()
  })

  it('scaleLimitsOf 把元素映射到对应的那一档(与面板同表)', () => {
    expect(scaleLimitsOf('subtitle')).toEqual(ELEMENT_SCALE_LIMITS.subtitle)
    expect(scaleLimitsOf('watermark')).toEqual(ELEMENT_SCALE_LIMITS.watermark)
    expect(scaleLimitsOf('logo')).toEqual(ELEMENT_SCALE_LIMITS.other)
    expect(scaleLimitsOf('title')).toEqual(ELEMENT_SCALE_LIMITS.other)
    expect(scaleLimitsOf('custom:el-1')).toEqual(ELEMENT_SCALE_LIMITS.other)
  })

  it('旧档里低于下限的倍率逐步回到界内,不会被一次滚动弹到下限', () => {
    const drag = useCanvasDrag()

    // Logo 存档为 10%（比面板下限 20% 更小）：向上滚走一格是 12%，而不是直接跳到 20%
    expect(drag.scaleByWheel(wheel(-100), 'logo', 0.1)).toBeCloseTo(0.12, 10)
    // 继续向上滚若干格后进入界内并停在上限
    expect(drag.scaleByWheel(wheel(-3000), 'logo', 0.28)).toBeCloseTo(0.38, 10)
  })

  it('单次事件的步进有上限,异常大的 deltaY 不会一滚跳掉半个大小', () => {
    const drag = useCanvasDrag()

    // 3000px 折算 60%，限幅后只走 10%
    expect(drag.scaleByWheel(wheel(-3000), 'logo', 1)).toBeCloseTo(1.1, 10)
  })

  it('行模式(deltaMode=1)按行折算,不会被当成 3 像素而纹丝不动', () => {
    const drag = useCanvasDrag()

    // 10 行 × 16px = 160px ⇒ 3.2% ⇒ 走 3%
    expect(drag.scaleByWheel(wheel(-10, 1), 'logo', 1)).toBeCloseTo(1.03, 10)
  })

  it('纵向 deltaY 为 0 时不介入(横向滚动交还页面)', () => {
    const drag = useCanvasDrag()

    expect(drag.scaleByWheel(wheel(0), 'logo', 1)).toBeNull()
  })
})

describe('useCanvasDrag 交互窗口(预览旁路防抖的信号)', () => {
  it('拖动期间 interacting 为真,松手即复位', () => {
    const drag = useCanvasDrag()
    expect(drag.interacting.value).toBe(false)

    drag.begin({
      id: 'title', anchor: anchorAt(0.5, 0.5), box: boxCenteredAt(512, 512),
      point: { x: 0.5, y: 0.5 },
    })
    expect(drag.dragging.value).toBe(true)
    expect(drag.interacting.value).toBe(true)

    drag.end()
    expect(drag.interacting.value).toBe(false)
  })

  it('滚轮活动开启窗口,静默 250ms 后自动收起(窗口内不打断)', () => {
    vi.useFakeTimers()
    try {
      const drag = useCanvasDrag()
      drag.markWheelActivity()
      expect(drag.interacting.value).toBe(true)

      vi.advanceTimersByTime(249)
      expect(drag.interacting.value).toBe(true)

      // 又滚了一下：窗口顺延，不能在中途掉回防抖
      drag.markWheelActivity()
      vi.advanceTimersByTime(249)
      expect(drag.interacting.value).toBe(true)

      vi.advanceTimersByTime(1)
      expect(drag.interacting.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useCanvasDrag 旋转手柄', () => {
  /** 正方形画布上以锚点为圆心的角度点：angle 以度计，0° 指向右、顺时针为正 */
  const atAngle = (angle: number, radius = 100): { x: number; y: number } => {
    const rad = (angle * Math.PI) / 180
    return {
      x: (512 + radius * Math.cos(rad)) / CANVAS.width,
      y: (512 + radius * Math.sin(rad)) / CANVAS.height,
    }
  }

  const beginRotateAt = (angle: number, rotation = 0) => {
    const drag = useCanvasDrag()
    drag.beginRotate({
      id: 'title',
      anchor: { ...anchorAt(0.5, 0.5), rotation },
      canvas: CANVAS,
      point: atAngle(angle),
    })
    return drag
  }

  it('写回的是「相对按下点转了多少度」,而不是绝对指针角', () => {
    const drag = beginRotateAt(0)

    // 指针从 0° 转到 90°（正下方）⇒ 旋转 +90°
    expect(drag.rotateTo(atAngle(90), CANVAS)).toEqual({ id: 'title', rotation: 90 })
    // 指针回到按下角 ⇒ 旋转回到 0，不会留下偏移
    expect(drag.rotateTo(atAngle(0), CANVAS)?.rotation).toBe(0)
  })

  it('在手柄上抓住已旋转的元素继续转:在原角度上累加', () => {
    const drag = beginRotateAt(0, 30)

    expect(drag.rotateTo(atAngle(90), CANVAS)?.rotation).toBe(120)
    expect(drag.rotateTo(atAngle(-30), CANVAS)?.rotation).toBe(0)
  })

  it('能转到 ±180,越界由 normalizeRotation 收敛', () => {
    const drag = beginRotateAt(0)

    // 转到 180°：正好落在边界上
    expect(drag.rotateTo(atAngle(180), CANVAS)?.rotation).toBe(180)
    // 从 180° 起逆时针横扫过 -90°（跨过 -180 的边界）⇒ 收敛到 -180
    const reverse = beginRotateAt(180)
    expect(reverse.rotateTo(atAngle(-90), CANVAS)?.rotation).toBe(-180)
  })

  it('非正方形画布上角度仍按像素算(比例坐标的 x/y 分母不同)', () => {
    // 1024×512 上「像素坐标 45°」的点：比例上并不成 45°，直接对比例取 atan2 会算成 63°
    const wide = { width: 1024, height: 512 }
    const drag = useCanvasDrag()
    drag.beginRotate({
      id: 'title', anchor: anchorAt(0.5, 0.5), canvas: wide, point: { x: 612 / 1024, y: 0.5 },
    })

    const turned = drag.rotateTo({ x: 612 / 1024, y: (256 + 100) / 512 }, wide)

    expect(turned?.rotation).toBeCloseTo(45, 6)
  })

  describe('角度磁力(仅手柄拖动)', () => {
    /** 磁力点附近的落点：-180 从 +3° 一侧靠近（atan2 的值域是 (-180,180]，-183° 会绕回 177°） */
    const nearMagnet = (m: number) => atAngle(m === -180 ? -177 : m - 3)

    it.each(ROTATION_MAGNETS)('落点距 %d° 在阈值内即吸到该磁力点', (magnet) => {
      const drag = beginRotateAt(0)

      expect(drag.rotateTo(nearMagnet(magnet), CANVAS)?.rotation).toBe(magnet)
    })

    it('负角度同样吸:0° 附近从负侧靠近、-45° 附近也吸', () => {
      expect(beginRotateAt(0).rotateTo(atAngle(-3), CANVAS)?.rotation).toBe(0)
      expect(beginRotateAt(0).rotateTo(atAngle(-48), CANVAS)?.rotation).toBe(-45)
      expect(beginRotateAt(0).rotateTo(atAngle(-92), CANVAS)?.rotation).toBe(-90)
    })

    it('离磁力点远时不吸:角度保持连续', () => {
      expect(beginRotateAt(0).rotateTo(atAngle(22), CANVAS)?.rotation).toBe(22)
      expect(beginRotateAt(0).rotateTo(atAngle(60), CANVAS)?.rotation).toBe(60)
      expect(beginRotateAt(0).rotateTo(atAngle(-70), CANVAS)?.rotation).toBe(-70)
    })

    it('阈值边界:正好 5° 吸住,6° 就自由(闭区间的两端都验)', () => {
      expect(beginRotateAt(0).rotateTo(atAngle(5), CANVAS)?.rotation).toBe(0) // 距 0° 正好 5° ⇒ 吸
      expect(beginRotateAt(0).rotateTo(atAngle(6), CANVAS)?.rotation).toBe(6)
      expect(beginRotateAt(0).rotateTo(atAngle(40), CANVAS)?.rotation).toBe(45) // 距 45° 正好 5° ⇒ 吸
      expect(beginRotateAt(0).rotateTo(atAngle(39), CANVAS)?.rotation).toBe(39) // 6° ⇒ 不吸
    })

    it('拖动过程中生效:同一次拖动里吸住、拖开后自然脱离', () => {
      const drag = beginRotateAt(0)

      // 每帧都从按下角重算，所以进出磁力点是即时的、不会粘住
      expect(drag.rotateTo(atAngle(39), CANVAS)?.rotation).toBe(39) // 还差 6° ⇒ 自由
      expect(drag.rotateTo(atAngle(44), CANVAS)?.rotation).toBe(45) // 进入阈值 ⇒ 吸住
      expect(drag.rotateTo(atAngle(52), CANVAS)?.rotation).toBe(52) // 拖开 ⇒ 恢复连续
      expect(drag.rotateTo(atAngle(88), CANVAS)?.rotation).toBe(90) // 靠近 90° ⇒ 又吸住
    })

    it('磁力不改变 ±180 的夹取语义:越过 180° 仍停在 180°,不环绕', () => {
      // 从 -170° 横扫到 +170°：内核角 340°，够不着任何磁力点，被 normalizeRotation 夹在 180°
      const past = beginRotateAt(-170)
      expect(past.rotateTo(atAngle(170), CANVAS)?.rotation).toBe(180)
      // 反向同理：内核角 -340° ⇒ 夹在 -180°
      const reverse = beginRotateAt(170)
      expect(reverse.rotateTo(atAngle(-170), CANVAS)?.rotation).toBe(-180)
    })

    it('磁力以「原角度 + 本次转角」为准:界外的原角度不被改写', () => {
      // 原角度 42°，指针从 0° 转到 45° ⇒ 内核 87° ⇒ 吸到 90°
      const drag = beginRotateAt(0, 42)
      expect(drag.rotateTo(atAngle(45), CANVAS)?.rotation).toBe(90)
      // 原角度 55°：离任何磁力点都超过阈值 ⇒ 原样保留
      const kept = beginRotateAt(55, 55)
      expect(kept.rotateTo(atAngle(55), CANVAS)?.rotation).toBe(55)
      // 原角度 50° 落在 45° 的阈值内：一按下滑动就会被吸到 45°（磁力作用于当前角度）
      const grabbed = beginRotateAt(50, 50)
      expect(grabbed.rotateTo(atAngle(50), CANVAS)?.rotation).toBe(45)
    })
  })

  it('旋转期间 interacting 为真,松手复位;未进入会话时 rotateTo 返回 null', () => {
    const drag = useCanvasDrag()
    expect(drag.rotateTo(atAngle(90), CANVAS)).toBeNull()

    drag.beginRotate({ id: 'logo', anchor: anchorAt(0.5, 0.5), canvas: CANVAS, point: atAngle(0) })
    expect(drag.rotating.value).toBe(true)
    expect(drag.interacting.value).toBe(true) // 预览据此旁路防抖，旋转才跟手

    drag.end()
    expect(drag.rotating.value).toBe(false)
    expect(drag.interacting.value).toBe(false)
    expect(drag.rotateTo(atAngle(90), CANVAS)).toBeNull()
  })
})

describe('deleteSelection 删除策略(唯一一份)', () => {
  const withCustom = (): CustomElement[] => [{
    id: 'el-1',
    kind: 'image',
    content: 'data:image/png;base64,AAAA',
    text: '',
    size: 200,
    anchor: anchorAt(0.5, 0.5),
    color: '#ffffff',
    bold: false,
    tracking: 0,
    curve: 0,
    direction: 'horizontal',
    aspect: 1,
  }]

  it('标题不可删除:策略返回 null,× 按钮也不该渲染', () => {
    const state = defaultCoverState()
    expect(deleteSelection(state, 'title')).toBeNull()
    expect(canDeleteSelection('title')).toBe(false)
  })

  it('Logo 只关闭显示,不动用户已选的图', () => {
    const state = { ...defaultCoverState(), logoHidden: false, logoDataUrl: 'data:image/png;base64,AA' }
    const result = deleteSelection(state, 'logo')

    expect(result?.patch).toEqual({ logoHidden: true })
    expect(result?.clearSelection).toBe(false)
    // 图还在:再次打开开关就能看到，不需要重新上传
    expect(state.logoDataUrl).toBe('data:image/png;base64,AA')
  })

  it('副标题与水印清空各自的输入框,元素本身仍在', () => {
    const state = { ...defaultCoverState(), subtitle: '副标题', watermark: 'example.com' }

    expect(deleteSelection(state, 'subtitle')?.patch).toEqual({ subtitle: '' })
    expect(deleteSelection(state, 'watermark')?.patch).toEqual({ watermark: '' })
    expect(deleteSelection(state, 'subtitle')?.clearSelection).toBe(false)
  })

  it('自定义元素真删除:同时从图层表移除并清掉选中态', () => {
    const base = defaultCoverState()
    const state = {
      ...base,
      customElements: withCustom(),
      layers: [...base.layers, 'custom:el-1' as LayerKey],
    }

    const result = deleteSelection(state, 'custom:el-1')

    expect(result?.patch.customElements).toEqual([])
    expect(result?.patch.layers).toEqual(base.layers)
    expect(result?.patch.layers).not.toContain('custom:el-1')
    expect(result?.clearSelection).toBe(true)
    expect(canDeleteSelection('custom:el-1')).toBe(true)
  })

  it('删除只影响目标元素:其余自定义元素与图层顺序保持原样', () => {
    const base = defaultCoverState()
    const second = { ...withCustom()[0], id: 'el-2' }
    const state = {
      ...base,
      customElements: [...withCustom(), second],
      layers: [...base.layers, 'custom:el-1' as LayerKey, 'custom:el-2' as LayerKey],
    }

    const result = deleteSelection(state, 'custom:el-2')

    expect(result?.patch.customElements?.map((el) => el.id)).toEqual(['el-1'])
    expect(result?.patch.layers).toEqual([...base.layers, 'custom:el-1'])
  })

  it('策略是纯函数:不改动传入的状态', () => {
    const base = defaultCoverState()
    const state = { ...base, customElements: withCustom(), subtitle: '副标题' }
    const snapshot = JSON.parse(JSON.stringify(state))

    deleteSelection(state, 'custom:el-1')
    deleteSelection(state, 'subtitle')

    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot)
  })
})

describe('useCanvasDrag 拉大手柄', () => {
  /** 画布 1024×1024、锚点在正中：距离就是到中心的像素距离 */
  const atDistance = (px: number, angle = 0): { x: number; y: number } => {
    const rad = (angle * Math.PI) / 180
    return {
      x: (512 + px * Math.cos(rad)) / CANVAS.width,
      y: (512 + px * Math.sin(rad)) / CANVAS.height,
    }
  }

  const beginScaleAt = (px: number, id: SelectionId = 'logo') => {
    const drag = useCanvasDrag()
    drag.beginScale({
      id, anchor: anchorAt(0.5, 0.5, 1), canvas: CANVAS, point: atDistance(px),
    })
    return drag
  }

  it('往外拖变大、往里拖变小,结果是整数百分比', () => {
    const drag = beginScaleAt(100)

    // 距离翻倍 ⇒ 写回 200%（当前 100%）
    expect(drag.scaleTo(atDistance(200), CANVAS, 1)).toEqual({ id: 'logo', scale: 2 })
    // 从 200% 的当前位置收回到起点距离 ⇒ 写回 100%
    expect(drag.scaleTo(atDistance(100), CANVAS, 2)).toEqual({ id: 'logo', scale: 1 })
  })

  it('写回的是「这一步乘多少」:对倍率被归位为 1 的元素也成立', () => {
    const drag = beginScaleAt(100)

    // 标题/自定义图片的锚点倍率写回后被归位成 1，每步读到的当前值都是 100%
    expect(drag.scaleTo(atDistance(150), CANVAS, 1)?.scale).toBe(1.5)
    // 150px → 50px：这一步是 1/3，写回 0.33（整数百分比）
    expect(drag.scaleTo(atDistance(50), CANVAS, 1)?.scale).toBeCloseTo(0.33, 10)
  })

  it('拖回起点距离时写回原值(不会停在半路)', () => {
    const drag = beginScaleAt(100)

    expect(drag.scaleTo(atDistance(150), CANVAS, 1)?.scale).toBe(1.5)
    expect(drag.scaleTo(atDistance(200), CANVAS, 1.5)?.scale).toBe(2)
    expect(drag.scaleTo(atDistance(100), CANVAS, 2)?.scale).toBe(1)
  })

  it('没变化时不重复写回(同一位置连续移动只写一次)', () => {
    const drag = beginScaleAt(100)

    expect(drag.scaleTo(atDistance(140), CANVAS, 1)?.scale).toBe(1.4)
    expect(drag.scaleTo(atDistance(140), CANVAS, 1.4)).toBeNull()
  })

  it('只给比值、不夹边界:一次拖到底由写回路径按 owner 裁决', () => {
    // 从 40px 拖到 1000px = 25 倍：手柄原样写 25，不在这里被夹成 3
    expect(beginScaleAt(40).scaleTo(atDistance(1000), CANVAS, 1)?.scale).toBe(25)
    // 元素身份不参与夹取：边界由写回路径取（图片 px / 字号 / scaleLimitsOf）
    expect(beginScaleAt(40, 'subtitle').scaleTo(atDistance(1000), CANVAS, 1)?.scale).toBe(25)
    expect(beginScaleAt(40, 'watermark').scaleTo(atDistance(1000), CANVAS, 1)?.scale).toBe(25)
  })

  it('往回拖同样不限幅:25 倍的距离收回原处就是 1/25', () => {
    expect(beginScaleAt(1000).scaleTo(atDistance(40), CANVAS, 1)?.scale).toBe(0.04)
  })

  it('距离按画布像素算:非正方形画布上的斜拖不会被拉偏', () => {
    const wide = { width: 1024, height: 512 }
    const drag = useCanvasDrag()
    // 圆心 (512,256)：按下在 (+100,+50)，拖到 (+200,+150)
    drag.beginScale({
      id: 'logo', anchor: anchorAt(0.5, 0.5), canvas: wide,
      point: { x: 612 / 1024, y: 306 / 512 },
    })

    const next = drag.scaleTo({ x: 712 / 1024, y: 406 / 512 }, wide, 1)

    // hypot(200,150)/hypot(100,50) = 2.2359… ⇒ 224%（若按比例坐标算会是 255%）
    expect(next?.scale).toBeCloseTo(2.24, 10)
  })

  it('起点距离为 0 也不会算出 Infinity', () => {
    const drag = useCanvasDrag()
    drag.beginScale({
      id: 'logo', anchor: anchorAt(0.5, 0.5), canvas: CANVAS, point: { x: 0.5, y: 0.5 },
    })

    const next = drag.scaleTo(atDistance(100), CANVAS, 1)

    expect(next).not.toBeNull()
    expect(Number.isFinite(next!.scale)).toBe(true)
    // 分母被兜到 1px：比值 100 ⇒ 写回 100 倍（夹取交给写回路径，不在这里炸成 Infinity）
    expect(next!.scale).toBe(100)
  })

  it('拉大期间 interacting 为真,松手复位;未进入会话时 scaleTo 返回 null', () => {
    const drag = useCanvasDrag()
    expect(drag.scaleTo(atDistance(200), CANVAS, 1)).toBeNull()

    drag.beginScale({ id: 'logo', anchor: anchorAt(0.5, 0.5), canvas: CANVAS, point: atDistance(100) })
    expect(drag.scaling.value).toBe(true)
    expect(drag.interacting.value).toBe(true) // 预览据此旁路防抖，拉大才跟手

    drag.end()
    expect(drag.scaling.value).toBe(false)
    expect(drag.interacting.value).toBe(false)
    expect(drag.scaleTo(atDistance(200), CANVAS, 1)).toBeNull()
  })
})