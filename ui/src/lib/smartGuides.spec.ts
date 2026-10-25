import { describe, expect, it } from 'vitest'
import { SNAP_THRESHOLD_RATIO, snapAnchor, type AlignRect } from './smartGuides'

/**
 * 参考线数学。
 *
 * 画布取 1024×1024 且坐标全用整数像素：比例值的分母都是 2 的幂，
 * 距离比较不会掺入浮点噪声，于是「平局」这类断言才能真的成立。
 */
const CANVAS = { width: 1024, height: 1024 }

/** 造一个中心落在指定比例位置的矩形 */
function boxAtCenter(cx: number, cy: number, w = 0.2, h = 0.2): AlignRect {
  return {
    x: (cx - w / 2) * CANVAS.width,
    y: (cy - h / 2) * CANVAS.height,
    width: w * CANVAS.width,
    height: h * CANVAS.height,
  }
}

/** 单个元素的中心与左右边缘（比例值），用于把期望值写成人能看懂的形式 */
const ratio = (px: number) => px / CANVAS.width

describe('snapAnchor 画布中线', () => {
  it('元素中心落在中线附近时吸附到 50%，并给出居中垂直参考线', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.504, 0.3),
      canvas: CANVAS,
      others: [],
    })

    expect(result.dx).toBeCloseTo(-0.004, 10)
    expect(result.guides).toEqual([{ axis: 'x', position: 0.5 }])
  })

  it('超出阈值(1.2%)不吸附、不给参考线', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.5 + SNAP_THRESHOLD_RATIO + 0.001, 0.3),
      canvas: CANVAS,
      others: [],
    })

    expect(result.dx).toBe(0)
    expect(result.guides).toEqual([])
  })

  it('阈值上调后 1% 的偏离也能吸上(旧阈值 0.6% 时吸不住)', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.51, 0.3),
      canvas: CANVAS,
      others: [],
    })

    expect(result.dx).toBeCloseTo(-0.01, 10)
    expect(result.guides).toEqual([{ axis: 'x', position: 0.5 }])
  })

  it('阈值边界上仍然吸附(闭区间)', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.5 + SNAP_THRESHOLD_RATIO, 0.3),
      canvas: CANVAS,
      others: [],
    })

    expect(result.dx).toBeCloseTo(-SNAP_THRESHOLD_RATIO, 10)
    expect(result.guides).toEqual([{ axis: 'x', position: 0.5 }])
  })

  it('纵向中线同理:元素中心靠近 50% 高度时吸附并给出水平参考线', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.2, 0.5 - SNAP_THRESHOLD_RATIO),
      canvas: CANVAS,
      others: [],
    })

    expect(result.dy).toBeCloseTo(SNAP_THRESHOLD_RATIO, 10)
    expect(result.guides).toEqual([{ axis: 'y', position: 0.5 }])
  })

  it('两轴同时靠近则同时吸附,给出两条参考线', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.504, 0.504),
      canvas: CANVAS,
      others: [],
    })

    expect(result.guides).toEqual([
      { axis: 'x', position: 0.5 },
      { axis: 'y', position: 0.5 },
    ])
  })

  it('画布中线只认元素中心:宽元素把边缘贴到中线不会被吸走', () => {
    // 左边缘距中线 0.003(在阈值内)，但中心远在 0.6 之外
    const wide: AlignRect = {
      x: (0.5 - 0.003) * CANVAS.width,
      y: 0,
      width: 0.2 * CANVAS.width,
      height: 0.2 * CANVAS.height,
    }
    const result = snapAnchor({ box: wide, canvas: CANVAS, others: [] })

    expect(result.dx).toBe(0)
    expect(result.guides).toEqual([])
  })
})

describe('snapAnchor 与其他元素对齐', () => {
  it('与另一元素的中心对齐时吸附到它的中心并画出该线', () => {
    const other = boxAtCenter(0.3, 0.8)
    const result = snapAnchor({
      box: boxAtCenter(0.302, 0.3),
      canvas: CANVAS,
      others: [other],
    })

    expect(result.dx).toBeCloseTo(-0.002, 10)
    expect(result.guides).toEqual([{ axis: 'x', position: 0.3 }])
  })

  it('边缘对边缘同样吸附:被拖元素左缘贴到另一元素右缘', () => {
    // 另一元素:192–291px ⇒ 右缘 291/1024
    const other: AlignRect = { x: 192, y: 0, width: 99, height: 99 }
    // 被拖元素:左缘 293px(距右缘 2px)，中心 301px(离另一元素的候选位都远)
    const dragged: AlignRect = { x: 293, y: 700, width: 16, height: 16 }
    const result = snapAnchor({ box: dragged, canvas: CANVAS, others: [other] })

    expect(result.dx).toBeCloseTo(ratio(291) - ratio(293), 10)
    expect(result.guides).toEqual([{ axis: 'x', position: ratio(291) }])
  })

  it('中心与边缘距离相同时优先「中心对中心」', () => {
    // 被拖元素:300–308px(中心 304)，另一元素:298–306px(中心 302)
    // 中心对中心 = 左缘对中心 = 2px，平局时必须选中心对中心
    //（纵向放在画布下方：否则中心离 50% 只有 0.008，阈值上调后会多出一条横线）
    const other: AlignRect = { x: 298, y: 0, width: 8, height: 8 }
    const dragged: AlignRect = { x: 300, y: 700, width: 8, height: 8 }
    const result = snapAnchor({ box: dragged, canvas: CANVAS, others: [other] })

    expect(result.dx).toBeCloseTo(ratio(302) - ratio(304), 10)
    expect(result.guides).toEqual([{ axis: 'x', position: ratio(302) }])
  })

  it('多个元素时取最近的一档:靠近谁就吸谁', () => {
    const near = boxAtCenter(0.3, 0.8)
    const far = boxAtCenter(0.3045, 0.2)
    const result = snapAnchor({
      box: boxAtCenter(0.305, 0.35),
      canvas: CANVAS,
      others: [near, far],
    })

    // 与 far 的中心差 0.0005，比与 near 的 0.005 近得多
    expect(result.dx).toBeCloseTo(-0.0005, 10)
    expect(result.guides).toEqual([{ axis: 'x', position: 0.3045 }])
  })

  it('纵向对齐另一元素中心', () => {
    const other = boxAtCenter(0.2, 0.75)
    const result = snapAnchor({
      box: boxAtCenter(0.9, 0.752),
      canvas: CANVAS,
      others: [other],
    })

    expect(result.dy).toBeCloseTo(-0.002, 10)
    expect(result.guides).toEqual([{ axis: 'y', position: 0.75 }])
  })

  it('退化矩形(宽高为 0)不参与对齐,避免产出假参考线', () => {
    const degenerate: AlignRect = { x: 300, y: 300, width: 0, height: 0 }
    const result = snapAnchor({
      box: boxAtCenter(0.5, 0.5),
      canvas: CANVAS,
      others: [degenerate],
    })

    // 只剩画布中线那两条
    expect(result.guides).toEqual([
      { axis: 'x', position: 0.5 },
      { axis: 'y', position: 0.5 },
    ])
  })

  it('画布尺寸非法时既不吸附也不产出 NaN', () => {
    const result = snapAnchor({
      box: boxAtCenter(0.5, 0.5),
      canvas: { width: 0, height: 0 },
      others: [boxAtCenter(0.3, 0.3)],
    })

    expect(result).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('阈值可覆盖:调大后原本够不着的距离也能吸上', () => {
    const other = boxAtCenter(0.3, 0.8)
    const box = boxAtCenter(0.32, 0.3)
    expect(snapAnchor({ box, canvas: CANVAS, others: [other] }).dx).toBe(0)
    expect(snapAnchor({ box, canvas: CANVAS, others: [other], threshold: 0.05 }).dx)
      .toBeCloseTo(-0.02, 10)
  })

  it('是纯函数:同样的输入重复调用得到同样的结果(不会自我强化)', () => {
    const other = boxAtCenter(0.3, 0.8)
    const box = boxAtCenter(0.302, 0.3)
    const first = snapAnchor({ box, canvas: CANVAS, others: [other] })
    const second = snapAnchor({ box, canvas: CANVAS, others: [other] })

    expect(second).toEqual(first)
  })
})