import { describe, expect, it } from 'vitest'
import { builtinBoxes, customBoxes } from './elementGeometry'
import { buildCoverSvg, createMeasure, makeCtx, titleGeometry } from './svgBuilder'
import { defaultCoverState, defaultTextStyles, fullMaxWidth } from './layout'
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

/**
 * 标题包围盒与字间距。
 *
 * 绘制层按 letter-spacing 逐字推进,因此断行、缩字号与包围盒必须共用带字距的度量:
 * 之前只有渲染叠加了字距,几何仍按纯字宽算,选中框的宽度对字距完全不敏感。
 * 这一组把「框宽 = 实际推进量」钉死;数值按参考画布 1200×630 与降级度量
 * (无字体时 0.55em/字)校准,标题基字号 105 ⇒ 纯字宽 57.75/字。
 */
describe('标题包围盒跟随字间距', () => {
  const titleStyles = (tracking: number) => ({
    ...defaultTextStyles(),
    title: { ...defaultTextStyles().title, tracking },
  })

  /** 整块排版标题:参考画布、基字号 105 */
  const flowTitle = (text: string, tracking: number): CoverState => makeState({
    titleMode: 'flow', titleFlow: text, titleFontSize: 105, textStyles: titleStyles(tracking),
  })

  /** 从产物里读每行文字的 x 与 letter-spacing,按同一度量折算实际占位 */
  const renderedLines = (svg: string) =>
    [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map(([, attrs, content]) => {
      const attr = (name: string) => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(attrs)![1])
      const fontSize = attr('font-size')
      const spacing = attr('letter-spacing')
      const count = [...content].length
      return {
        attrs,
        content,
        x: attr('x'),
        fontSize,
        spacing,
        // 与 createMeasure(null) 同源:无字体时纯字宽按 0.55em/字估
        width: count * fontSize * 0.55 + spacing * Math.max(0, count - 1),
      }
    })

  it('同一段标题只改字距:框宽按「字宽 + 字距×间隔」单调变宽', () => {
    const widths = [0, 0.2, 0.4].map((t) => boxOf(flowTitle('ABCD', t), 'title').width)
    // 纯字宽 4 × 105 × 0.55 = 231;字距 21 / 42,四个字之间有三个间隔
    expect(widths[0]).toBeCloseTo(231, 5)
    expect(widths[1]).toBeCloseTo(231 + 21 * 3, 5)
    expect(widths[2]).toBeCloseTo(231 + 42 * 3, 5)
    expect(widths[0]).toBeLessThan(widths[1])
    expect(widths[1]).toBeLessThan(widths[2])
    // 变宽只向两侧展开,框心仍在标题锚点上
    for (const state of [flowTitle('ABCD', 0), flowTitle('ABCD', 0.4)]) {
      const box = boxOf(state, 'title')
      expect(box.x + box.width / 2).toBeCloseTo(CANVAS.width / 2, 5)
    }
  })

  it('框宽与产物一致:按 letter-spacing 折算的占位就是框宽', () => {
    const state = flowTitle('ABCD', 0.4)
    const box = boxOf(state, 'title')
    const svg = buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' })
    const line = renderedLines(svg)[0]
    expect(line.content).toBe('ABCD')
    expect(line.spacing).toBeCloseTo(42, 5)
    expect(line.width).toBeCloseTo(box.width, 5)
    // 居中:文字左缘与框左缘重合
    expect(line.x).toBeCloseTo(box.x, 2)
  })

  it('字距很大时按带字距的宽度换行:框不超可用宽度,行也画得下', () => {
    const state = flowTitle('A'.repeat(19), 1.5)
    const geo = titleGeometry(state, createMeasure(null), makeCtx(state.canvas))!
    const box = boxOf(state, 'title')
    // 每行最多 5 字:5×57.75 + 4×157.5 = 918.75 ≤ 1119.96,第 6 字到 1134 就超了
    // ⇒ 19 字排成 5/5/5/4 四行,最宽一行就是框宽
    expect(geo.lineCount).toBe(4)
    expect(geo.totalWidth).toBeCloseTo(918.75, 5)
    expect(box.width).toBeCloseTo(918.75, 5)
    expect(box.width).toBeLessThanOrEqual(fullMaxWidth(makeCtx(state.canvas)) + 1e-6)
    expect(box.x).toBeGreaterThanOrEqual(-1e-6)
    expect(box.x + box.width).toBeLessThanOrEqual(CANVAS.width + 1e-6)

    // 渲染端同样按带字距的宽度断行:四行都放得下,不需要 textLength 事后压扁
    const lines = renderedLines(buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' }))
    expect(lines.map((l) => l.content)).toEqual(['AAAAA', 'AAAAA', 'AAAAA', 'AAAA'])
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(fullMaxWidth(makeCtx(state.canvas)) + 1e-6)
      expect(line.attrs).not.toContain('textLength')
    }
  })

  it('无 Logo 合并标题:字距计入后字号缩到位,框宽等于实际占位', () => {
    const state = makeState({
      titleMode: 'split', titleLeft: 'A'.repeat(8), titleRight: '', logoHidden: true,
      titleFontSize: 105, textStyles: titleStyles(1.5),
    })
    const geo = titleGeometry(state, createMeasure(null), makeCtx(state.canvas))!
    // 105 号时带字距宽 8×57.75 + 7×157.5 = 1564.5 > 1119.96,
    // 缩到 floor(105×1119.96/1564.5) = 75 号 ⇒ 宽 8×41.25 + 7×112.5 = 1117.5
    expect(geo.fontSize).toBe(75)
    expect(geo.totalWidth).toBeCloseTo(1117.5, 5)
    expect(boxOf(state, 'title').width).toBeCloseTo(1117.5, 5)

    const line = renderedLines(buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' }))[0]
    expect(line.fontSize).toBe(75)
    expect(line.width).toBeCloseTo(1117.5, 5)
    // 缩字号已让它放得下,不需要再压扁
    expect(line.attrs).not.toContain('textLength')
  })

  it('分缝模式:左右两段各自成框,框宽随字距变宽且贴齐中缝', () => {
    const state = (tracking: number) => makeState({
      titleMode: 'split', titleLeft: 'AB', titleRight: 'CD', titleFontSize: 210,
      textStyles: titleStyles(tracking),
    })
    const pair = (tracking: number) => boxesOf(state(tracking)).filter((b) => b.id === 'title')
    const [l0, r0] = pair(0)
    const [l3, r3] = pair(0.3)
    // 基字号 210:两字纯字宽 231,字距 63(只有一个间隔)⇒ 294
    expect(l0.width).toBeCloseTo(231, 5)
    expect(l3.width).toBeCloseTo(294, 5)
    expect(r0.width).toBeCloseTo(231, 5)
    expect(r3.width).toBeCloseTo(294, 5)
    expect(l0.width).toBeLessThan(l3.width)
    expect(r0.width).toBeLessThan(r3.width)
    // 左段以中缝为右缘、右段以中缝为左缘:字距只让它们向各自外侧变宽
    for (const [left, right] of [[l0, r0], [l3, r3]]) {
      expect(left.x + left.width).toBeCloseTo(CANVAS.width / 2 - 40, 5)
      expect(right.x).toBeCloseTo(CANVAS.width / 2 + 40, 5)
    }
    expect(l0.label).toBe('标题(左)')
    expect(r0.label).toBe('标题(右)')
  })

  it('字号触底后仍按压缩后的实际宽度成框,不会比画出来的更宽', () => {
    const state = makeState({
      titleMode: 'split', titleLeft: 'A'.repeat(20), titleRight: 'B', titleFontSize: 210,
      textStyles: titleStyles(1.5),
    })
    const [left, right] = boxesOf(state).filter((b) => b.id === 'title')
    // 64 号字下左段带字距仍宽 2528 > 单侧预算 519.96:渲染端会横向压到预算内
    // ⇒ 框必须取同一个 min,否则框宽会是实际占位的近五倍
    const segMax = CANVAS.width * 0.4333
    expect(left.width).toBeCloseTo(segMax, 5)
    expect(left.x + left.width).toBeCloseTo(CANVAS.width / 2 - 40, 5)
    expect(right.width).toBeCloseTo(64 * 0.55, 5) // 单字没有字距

    const svg = buildCoverSvg({
      state, font: null, defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    const textLen = (attrs: string) => Number(/textLength="([-\d.]+)"/.exec(attrs)![1])
    const lines = renderedLines(svg)
    // 左段被压到预算内:textLength 就是框宽(与框同源)
    expect(textLen(lines[0].attrs)).toBeCloseTo(left.width, 1)
    expect(lines[0].x).toBeCloseTo(left.x, 1)
    // 右段一个 B 本来就放得下,不产生压缩
    expect(lines[1].attrs).not.toContain('textLength')
    expect(lines[1].x).toBeCloseTo(right.x, 5)
  })

  it('竖排标题:列距 = 字号 + 字距,框宽随字距变宽', () => {
    const state = (tracking: number) => makeState({
      titleMode: 'flow', titleFlow: '一二三四五六', titleFontSize: 210,
      textStyles: {
        ...defaultTextStyles(),
        title: { ...defaultTextStyles().title, tracking, direction: 'vertical' },
      },
    })
    // 字距 0 / 21 / 42:逐字步进 210 / 231 / 252,可用高度 587.98 仍每列 2 字 ⇒ 3 列
    const widths = [0, 0.1, 0.2].map((t) => boxOf(state(t), 'title').width)
    expect(widths[0]).toBeCloseTo(210 + 2 * 210, 5)
    expect(widths[1]).toBeCloseTo(210 + 2 * 231, 5)
    expect(widths[2]).toBeCloseTo(210 + 2 * 252, 5)
    expect(widths[0]).toBeLessThan(widths[1])
    expect(widths[1]).toBeLessThan(widths[2])

    // 与产物同源:首末列的列心把框撑满,列心间距就是「字号 + 字距」
    for (const tracking of [0, 0.1, 0.2]) {
      const s = state(tracking)
      const box = boxOf(s, 'title')
      const xs = [...buildCoverSvg({ state: s, font: null, defaultLogoDataUrl: '' })
        .matchAll(/<text x="([-\d.]+)"/g)].map((m) => Number(m[1]))
      expect(xs).toHaveLength(6)
      expect(Math.min(...xs) - 105).toBeCloseTo(box.x, 5)
      expect(Math.max(...xs) + 105).toBeCloseTo(box.x + box.width, 5)
      const columns = [...new Set(xs)].sort((a, b) => a - b)
      expect(columns[1] - columns[0]).toBeCloseTo(210 + 210 * tracking, 5)
    }
  })

  it('副标题的缩放路径同样带字距(与标题同一口径)', () => {
    const state = makeState({
      subtitle: 'ABCD',
      layout: {
        ...defaultCoverState().layout,
        subtitle: { x: 0.5, y: 0.8, scale: 1, opacity: 1, rotation: 0 },
      },
      textStyles: {
        ...defaultTextStyles(),
        subtitle: { ...defaultTextStyles().subtitle, tracking: 0.5 },
      },
    })
    // 字号 34、字距 17:文字宽 4×18.7 + 3×17 = 125.8,两侧装饰线各占 46+18
    const textWidth = 4 * 34 * 0.55 + 3 * 17
    expect(boxOf(state, 'subtitle').width).toBeCloseTo(textWidth + 2 * (46 + 18), 5)
    const line = renderedLines(buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' }))
      .find((l) => l.content === 'ABCD')!
    expect(line.spacing).toBeCloseTo(17, 5)
    expect(line.width).toBeCloseTo(textWidth, 5)
  })

  it('自定义文字的换行路径同样带字距(断行按实际占位)', () => {
    const state = makeState({
      customElements: [customText('A'.repeat(20), 'horizontal', { tracking: 1.5 })],
    })
    // 字号 40、字距 60:11 字一行(11×22 + 10×60 = 842 ≤ 900),第 12 字到 924 就超了
    expect(boxOf(state, 'custom:t1').width).toBeCloseTo(842, 5)
    const lines = renderedLines(buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' }))
      .filter((l) => /^A+$/.test(l.content))
    expect(lines.map((l) => l.content)).toEqual(['AAAAAAAAAAA', 'AAAAAAAAA'])
  })
})
