import { describe, expect, it } from 'vitest'
import { builtinBoxes, customBoxes } from './elementGeometry'
import { buildCoverSvg, createMeasure, makeCtx } from './svgBuilder'
import { defaultCoverState, defaultTextStyles } from './layout'
import type { CoverState, CustomElement } from './types'

/**
 * 元素命中几何。
 *
 * 命中框、选中框与渲染必须共用同一份换算：这里锁住的是「框跟着图元走」——
 * 尤其是竖排换列之后，框必须按换列后的实际占位算宽高，否则选中框会与文字脱节。
 * 画布钉在参考尺寸 1200×630（出厂默认是 1200×675），数值断言都按它校准；
 * 度量一律走无字体路径（0.55em/字），与预览在没有字体时的行为一致。
 */
const CANVAS = { width: 1200, height: 630 }

function makeState(patch: Partial<CoverState> = {}): CoverState {
  return { ...defaultCoverState(), canvas: { ...CANVAS }, ...patch }
}

/** 与预览层同源的包围盒：同一个 elementGeometry，同一个 measure */
function boxesOf(state: CoverState) {
  const ctx = makeCtx(state.canvas)
  const measure = createMeasure(null)
  return [
    ...builtinBoxes(state, measure, ctx, false),
    ...customBoxes(state.customElements, measure, ctx),
  ]
}

const boxOf = (state: CoverState, id: string) => boxesOf(state).find((b) => b.id === id)!

/** 竖排标题状态：整块排版、字号 210（步进与列距正好都等于字号，数值好推） */
function verticalTitleState(text: string, patch: Partial<CoverState> = {}): CoverState {
  return makeState({
    titleMode: 'flow',
    titleFlow: text,
    titleFontSize: 210,
    ...patch,
    textStyles: {
      ...defaultTextStyles(),
      title: { ...defaultTextStyles().title, direction: 'vertical' },
    },
  })
}

/** 自定义文字元素：默认居中的 40px 竖排/横排文字 */
function customText(
  text: string, direction: 'horizontal' | 'vertical', patch: Partial<CustomElement> = {},
): CustomElement {
  return {
    id: 't1', kind: 'text', content: '', text, size: 40,
    anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
    color: '#ffffff', bold: false, tracking: 0, curve: 0, direction, aspect: 1,
    ...patch,
  }
}

const verticalWatermarkStyle = () => ({
  ...defaultTextStyles().watermark, direction: 'vertical' as const,
})

describe('竖排文字的命中框', () => {
  it('换列后框变宽变矮：宽度覆盖整个列阵，高度停在最高的一列', () => {
    const one = boxOf(verticalTitleState('一二'), 'title')
    const many = boxOf(verticalTitleState('一二三四五六'), 'title')
    // 单列：宽 = 字号 210、高 = 步进 210 × 2 字
    expect(one.width).toBe(210)
    expect(one.height).toBe(420)
    // 可用高度 630 × 0.9333 ≈ 588 ⇒ 每列 2 字，六个字排 3 列：宽 = 210 + 2 × 列距 210
    expect(many.width).toBe(630)
    expect(many.height).toBe(420)
  })

  it('换列后框高不超过可用高度（否则选中框会溢出可用版面）', () => {
    const box = boxOf(verticalTitleState('一二三四五六七八九十'), 'title')
    expect(box.height).toBeLessThanOrEqual(CANVAS.height * 0.9333)
  })

  it('命中框与渲染同源：左右边界正好落在首末列的字缘上', () => {
    const state = verticalTitleState('一二三四五六')
    const box = boxOf(state, 'title')
    const svg = buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' })
    const xs = [...svg.matchAll(/<text x="([-\d.]+)"/g)].map((m) => Number(m[1]))
    // 竖排里一个字的占位就是 1em：列心 ± 字号/2 正是框的左右边界
    expect(Math.min(...xs) - 105).toBeCloseTo(box.x, 5)
    expect(Math.max(...xs) + 105).toBeCloseTo(box.x + box.width, 5)
    // 整块竖直居中在锚点 y = 315 上：框心即锚点
    expect(box.centerY).toBe(315)
    expect(box.y + box.height / 2).toBeCloseTo(315, 5)
  })

  it('整块标题只看 titleFlow，不会误用分缝文本去量框', () => {
    const state = verticalTitleState('一二', {
      titleLeft: '很长的分缝左段', titleRight: '很长的分缝右段',
    })
    // 框按 titleFlow 的两个字算：宽 = 字号、高 = 两字（分缝文本与此无关）
    expect(boxOf(state, 'title')).toMatchObject({ width: 210, height: 420 })
  })

  it('分缝模式下左右两段各自成列阵，框心落在各自的段心上', () => {
    const state = makeState({
      titleMode: 'split', titleLeft: '一二三四五六', titleRight: '短', titleFontSize: 210,
      textStyles: {
        ...defaultTextStyles(),
        title: { ...defaultTextStyles().title, direction: 'vertical' },
      },
    })
    const [left, right] = boxesOf(state).filter((b) => b.id === 'title')
    // 中缝半宽 = 80 / 2：左段段心 560、右段段心 640，框都以段心为心
    expect(left.label).toBe('标题(左)')
    expect(left.x + left.width / 2).toBeCloseTo(560, 5)
    expect(left.width).toBe(630)   // 六个字按每列 2 字换列
    expect(right.label).toBe('标题(右)')
    expect(right.x + right.width / 2).toBeCloseTo(640, 5)
    expect(right.width).toBe(210)  // 一个字只有一列
  })

  it('换列后旋转支点仍是元素锚点（选中框据此旋转）', () => {
    const state = verticalTitleState('一二三四五六', {
      layout: {
        ...defaultCoverState().layout,
        title: { x: 0.4, y: 0.6, scale: 1, opacity: 1, rotation: 45 },
      },
    })
    const box = boxOf(state, 'title')
    expect(box.pivot).toEqual({ x: 0.4 * CANVAS.width, y: 0.6 * CANVAS.height })
    expect(box.rotation).toBe(45)
    expect(box.centerY).toBe(0.6 * CANVAS.height)
  })

  it('竖排水印：单列时与旧口径逐字段一致，换列后按列数展开', () => {
    const style = { ...defaultTextStyles(), watermark: verticalWatermarkStyle() }
    const short = boxOf(makeState({ watermark: '水印', textStyles: style }), 'watermark')
    // 字号 26、步进 26 × 1.08：单列宽 = 字号、高 = 步进 × 2，列心落在锚点 x = 0.95 × 1200
    expect(short.width).toBe(26)
    expect(short.height).toBeCloseTo(26 * 1.08 * 2, 4)
    expect(short.x).toBeCloseTo(CANVAS.width * 0.95 - 13, 4)

    const long = boxOf(makeState({ watermark: '水'.repeat(20), textStyles: style }), 'watermark')
    // 预算 = 630 × 0.35 ≈ 220、步进 28.08 ⇒ 每列 7 字，20 字排 3 列
    expect(long.width).toBeCloseTo(26 + 2 * 26 * 1.08, 4)
    expect(long.height).toBeCloseTo(26 * 1.08 * 7, 4)
  })

  it('竖排副标题：框高不超过可用高度，框宽随列数增长', () => {
    const state = makeState({
      subtitle: '副'.repeat(30),
      textStyles: {
        ...defaultTextStyles(),
        subtitle: { ...defaultTextStyles().subtitle, direction: 'vertical' },
      },
    })
    const box = boxOf(state, 'subtitle')
    // 字号 = 34 × 0.5 = 17、字距 0.3 ⇒ 列距 22.1；30 字按每列 13 字排 3 列
    expect(box.height).toBeLessThanOrEqual(CANVAS.height * 0.9333 * 0.5)
    expect(box.width).toBeCloseTo(17 + 2 * 22.1, 4)
    expect(box.height).toBeCloseTo(22.1 * 13, 4)
  })

  it('竖排自定义文字元素：框随列数增长，换行也计入', () => {
    const one = boxOf(makeState({ customElements: [customText('三个字', 'vertical')] }), 'custom:t1')
    const many = boxOf(
      makeState({ customElements: [customText('字'.repeat(40), 'vertical')] }), 'custom:t1',
    )
    const broken = boxOf(makeState({ customElements: [customText('字\n字', 'vertical')] }), 'custom:t1')
    expect(one.width).toBe(40)      // 单列：宽 = 字号
    expect(one.height).toBe(120)
    // 预算 = 630 × 0.75 = 472.5、步进 40 ⇒ 每列 11 字，40 字排 4 列
    expect(many.width).toBe(40 + 3 * 40)
    expect(many.height).toBe(11 * 40)
    // \n 按强制换列处理：两个字分成两列，框因此更宽更矮
    expect(broken.width).toBe(80)
    expect(broken.height).toBe(40)
  })

  it('横排元素的命中框口径不变（竖排换列不介入横排）', () => {
    // 出厂默认：整块排版、横排、字号 105（七个字未超可用宽度）
    const box = boxOf(makeState(), 'title')
    expect(box.width).toBeCloseTo(7 * 105 * 0.55, 5)
    // 基线到视觉上下缘仍是 0.78em / 0.2em 的经验比例
    expect(box.height).toBeCloseTo(105 * 0.98, 5)
  })
})