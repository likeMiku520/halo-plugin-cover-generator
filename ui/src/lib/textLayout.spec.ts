import { describe, expect, it } from 'vitest'
import {
  CURVE_MAX_SWEEP, STRAIGHT, estimateAdvance, layoutRun, measureTracked, runRenderedWidth,
  trackedMeasure, verticalColumns, verticalStep,
} from './textLayout'

/** 固定步进的假字体:每字宽 0.5em、每字一条 M 命令,便于精确断言排布结果 */
const FONT = {
  getAdvanceWidth: (_c: string, size: number) => size * 0.5,
  getPath: (c: string, x: number, y: number) => ({ commands: [{ type: 'M', x, y }] }),
}

const STRAIGHT_TEXT = { ...STRAIGHT }
const run = (s: string, opts: {
  size?: number; track?: number; color?: string; anchor?: 'start' | 'middle' | 'end'
  maxW?: number; maxH?: number; layout?: typeof STRAIGHT
  extraScale?: number; font?: typeof FONT | null
} = {}) => layoutRun(
  opts.font === undefined ? FONT : opts.font,
  s, 100, 200, opts.size ?? 40, opts.track ?? 0, opts.color ?? '#ffffff',
  opts.anchor ?? 'middle', true, opts.maxW ?? 0, opts.maxH ?? 0,
  opts.layout ?? STRAIGHT_TEXT, opts.extraScale ?? 1,
)

/**
 * 取每个字在弧上的基线 y。
 * 变换链里有两个 translate(外层定位 + 内层把字心对齐到弧点),
 * 必须用「后随 rotate」来锁定外层那个,否则数组会与逐字位置交错。
 */
const glyphYs = (out: string) =>
  [...out.matchAll(/translate\(([-\d.]+) ([-\d.]+)\) rotate\(/g)].map((m) => Number(m[2]))

describe('layoutRun 直线(默认)', () => {
  it('整段合成一条 path,带平移变换、无逐字旋转', () => {
    const out = run('ab')
    expect(out.match(/<path /g)).toHaveLength(1)
    expect(out).toContain('<path transform="translate(')
    expect(out).not.toContain('rotate(')
    expect(out).toContain('fill="#ffffff"')
  })

  it('字距写进逐字推进:字距越大,整段越宽', () => {
    const width = (track: number) => runRenderedWidth((t, s) => t.length * s * 0.5, 'abc', 40, track, 0)
    expect(width(10)).toBeGreaterThan(width(0))
  })

  it('超过可用宽度时整段水平压缩', () => {
    const out = run('abcdef', { maxW: 60 })
    expect(out).toMatch(/scale\((0\.\d+|1) 1\)/)
  })

  it('无字体时降级为单个 <text> 并保留 letter-spacing', () => {
    const out = run('ab', { font: null, track: 4 })
    expect(out.match(/<text /g)).toHaveLength(1)
    expect(out).toContain('letter-spacing="4"')
  })
})

describe('layoutRun 竖排', () => {
  const VERTICAL = { curve: 0, direction: 'vertical' as const }

  it('逐字沿 y 堆叠成一条 path,不再需要外层平移', () => {
    const out = run('abc', { layout: VERTICAL })
    expect(out.match(/<path /g)).toHaveLength(1)
    expect(out).not.toContain('transform=')
    // 三个字的基线依次下移
    const ys = [...out.matchAll(/M[\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]))
    expect(ys).toHaveLength(3)
    expect(ys[1]).toBeGreaterThan(ys[0])
    expect(ys[2]).toBeGreaterThan(ys[1])
  })

  it('整列以锚点为竖直中心:首末字关于锚点对称', () => {
    const out = run('abc', { layout: VERTICAL })
    const ys = [...out.matchAll(/M[\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]))
    expect((ys[0] + ys[2]) / 2).toBeCloseTo(200, 5)
  })

  it('无字体时逐字一个 <text>,水平居中', () => {
    const out = run('abc', { font: null, layout: VERTICAL })
    expect(out.match(/<text /g)).toHaveLength(3)
    expect(out.match(/text-anchor="middle"/g)).toHaveLength(3)
  })
})

/**
 * 竖排的逐字位置。
 *
 * 走降级路径(无字体)时每个字就是一个 <text>,x 正是列心、y 是基线——
 * 要精确断言换列位置就得从它读;有字体时整段合成一条 path,位置都编码进了 d,
 * 那条路径的形状另有「逐字节一致」用例守着。
 */
const glyphsOf = (out: string) =>
  [...out.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))

/** 一列里出现过的列心(升序):竖排换列后同一列的字共享一个 x */
const columnXs = (out: string) =>
  [...new Set(glyphsOf(out).map((g) => g.x))].sort((a, b) => a - b)

describe('layoutRun 竖排换列', () => {
  const VERTICAL = { curve: 0, direction: 'vertical' as const }

  it('一列放得下时输出与改动前逐字节一致', () => {
    // 这条断言锁住的是历史输出:单列的坐标表达式没有变,换列只在「排不下」时才介入。
    // 步进 = 40,三个字的基线为 160/200/240,字心水平居中在 x=100(字宽 20)
    expect(run('abc', { layout: VERTICAL })).toBe(
      '<path d="M90 160M90 200M90 240" fill="#ffffff" stroke="#ffffff" ' +
      'stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>',
    )
  })

  it('给了富余的高度预算也不改动单列结果(放得下就不换列)', () => {
    expect(run('abc', { layout: VERTICAL, maxH: 1000 })).toBe(run('abc', { layout: VERTICAL }))
    expect(run('abc', { layout: VERTICAL, maxH: 1000 })).toBe(
      '<path d="M90 160M90 200M90 240" fill="#ffffff" stroke="#ffffff" ' +
      'stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>',
    )
  })

  it('一列排满可用高度后换列:列数增加、每列变短', () => {
    // 步进 = 字号 40:预算 80 ⇒ 每列 2 字,六个字排成 3 列
    const out = run('abcdef', { font: null, layout: VERTICAL, maxH: 80 })
    const glyphs = glyphsOf(out)
    expect(glyphs).toHaveLength(6)
    expect(columnXs(out)).toHaveLength(3)
    expect(glyphs.filter((g) => g.x === glyphs[0].x)).toHaveLength(2)
  })

  it('换列方向自左向右:整段开头的一列落在最左', () => {
    const glyphs = glyphsOf(run('abcdef', { font: null, layout: VERTICAL, maxH: 80 }))
    // 输出按列序(即阅读序)生成:第 1 列最左,越往后的列越靠右
    expect(glyphs[0].x).toBeLessThan(glyphs[2].x)
    expect(glyphs[2].x).toBeLessThan(glyphs[4].x)
  })

  it('整块以锚点为心:列阵左右对称、各列齐头', () => {
    const out = run('abcdef', { font: null, layout: VERTICAL, maxH: 80 })
    const glyphs = glyphsOf(out)
    // 列距 = 字号 40 ⇒ 三列列心为 60 / 100 / 140,关于锚点 x=100 对称
    expect(columnXs(out)).toEqual([60, 100, 140])
    // 齐头(顶端对齐):每列的首字落在同一个 y 上,整块再以 y=200 竖直居中
    const firstYs = columnXs(out).map((x) => glyphs.find((g) => g.x === x)!.y)
    expect(new Set(firstYs).size).toBe(1)
    expect(firstYs[0]).toBe(180)
  })

  it('列高不超过可用高度:容量按逐字步进取整', () => {
    // 预算 100 / 步进 40 ⇒ 每列 2 字(3 字要 120,超预算)
    const out = run('abcdefg', { font: null, layout: VERTICAL, maxH: 100 })
    const glyphs = glyphsOf(out)
    for (const x of columnXs(out)) {
      expect(glyphs.filter((g) => g.x === x).length).toBeLessThanOrEqual(2)
    }
  })

  it('文本里的换行按强制换列处理(竖排里换行与换列是同一件事)', () => {
    const glyphs = glyphsOf(run('ab\ncd', { font: null, layout: VERTICAL }))
    // 不限高也是两列:ab 在右、cd 在左,各自从同一个顶端起排
    expect(glyphs.map((g) => g.x)).toEqual([80, 80, 120, 120])
    expect(new Set(glyphs.map((g) => g.y)).size).toBe(2)
  })

  it('负字距只收紧列内步进,不把两列挤到重叠', () => {
    // 步进 = 40 - 10 = 30 ⇒ 预算 90 每列 3 字;列距仍取字号 40,相邻两列不会叠在一起
    const out = run('abcdef', { font: null, layout: VERTICAL, maxH: 90, track: -10 })
    expect(columnXs(out)).toEqual([80, 120])
    expect(columnXs(out)[1] - columnXs(out)[0]).toBe(40)
  })

  it('换列后颜色、加粗等既有能力不变', () => {
    const out = run('abcdef', { layout: VERTICAL, maxH: 80, color: '#123456' })
    expect(out.match(/fill="#123456"/g)).toHaveLength(1)
    expect(out).toContain('stroke-width="1.4"')
  })

  it('无字体降级路径同样换列,仍是逐字一条 <text>', () => {
    const out = run('abcdef', { font: null, layout: VERTICAL, maxH: 80 })
    expect(out.match(/<text /g)).toHaveLength(6)
    expect(out.match(/text-anchor="middle"/g)).toHaveLength(6)
    expect(columnXs(out)).toHaveLength(3)
  })
})

describe('换行的边界量按方向分工', () => {
  it('横排只读 maxW:给了 maxH 也不会换行或分列', () => {
    const out = run('abcdefgh', { maxH: 40 })
    expect(out.match(/<path /g)).toHaveLength(1)
    expect(out).not.toContain('rotate(')
  })

  it('竖排只读 maxH:给了 maxW 也不会被压缩', () => {
    const out = run('abcdef', {
      font: null, layout: { curve: 0, direction: 'vertical' }, maxW: 10, maxH: 80,
    })
    expect(out).not.toContain('scale(')
    expect(columnXs(out)).toHaveLength(3)
  })

  it('弯曲度仍然只对横排生效:竖排设了弯曲也不逐字旋转', () => {
    const out = run('abcdef', {
      font: null, layout: { curve: 80, direction: 'vertical' }, maxH: 80,
    })
    expect(out).not.toContain('rotate(')
    expect(columnXs(out)).toHaveLength(3)
  })
})

describe('verticalColumns', () => {
  it('不限高(maxH = 0)时整段排成一列', () => {
    expect(verticalColumns('abc', 40, 0, 0)).toEqual([['a', 'b', 'c']])
  })

  it('按可用高度整除分列,末尾不足一列也算一列', () => {
    expect(verticalColumns('abcde', 40, 0, 80)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('换行强制断列,空行不产生空列', () => {
    expect(verticalColumns('ab\n\ncd', 40, 0, 0)).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('空文本没有列', () => {
    expect(verticalColumns('', 40, 0, 80)).toEqual([])
  })

  it('verticalStep 与字号、字距同基准', () => {
    expect(verticalStep(40, 10)).toBe(50)
    expect(verticalStep(40, 0)).toBe(40)
  })
})

describe('layoutRun 圆弧', () => {
  const arc = (curve: number) => ({ curve, direction: 'horizontal' as const })

  it('逐字一条 path,并各自按切线旋转', () => {
    const out = run('abcde', { layout: arc(60) })
    expect(out.match(/<path /g)).toHaveLength(5)
    expect(out.match(/rotate\(/g)).toHaveLength(5)
  })

  it('两端的旋转方向相反、中间近乎不转', () => {
    const out = run('abcde', { layout: arc(60) })
    const angles = [...out.matchAll(/rotate\(([-\d.]+)\)/g)].map((m) => Number(m[1]))
    expect(angles[0]).toBeLessThan(0)
    expect(angles[4]).toBeGreaterThan(0)
    expect(Math.abs(angles[2])).toBeLessThan(1)
    // 对称:首末角度互为相反数
    expect(angles[0]).toBeCloseTo(-angles[4], 1)
  })

  it('正弯曲向上拱:两端低于中缝基线', () => {
    const ys = glyphYs(run('abcde', { layout: arc(60) }))
    expect(ys).toHaveLength(5)
    expect(ys[0]).toBeGreaterThan(200)
    expect(ys[4]).toBeGreaterThan(200)
    expect(ys[2]).toBeCloseTo(200, 1)
  })

  it('负弯曲向下垂:两端高于基线', () => {
    const ys = glyphYs(run('abcde', { layout: arc(-60) }))
    expect(ys[0]).toBeLessThan(200)
    expect(ys[4]).toBeLessThan(200)
    expect(ys[2]).toBeCloseTo(200, 1)
  })

  it('最大弯曲度对应的圆心角就是 ±CURVE_MAX_SWEEP', () => {
    const out = run('abc', { layout: arc(100) })
    const angles = [...out.matchAll(/rotate\(([-\d.]+)\)/g)].map((m) => Number(m[1]))
    const sweep = angles[angles.length - 1] - angles[0]
    expect(sweep).toBeGreaterThan(CURVE_MAX_SWEEP * 0.5)
    expect(sweep).toBeLessThanOrEqual(CURVE_MAX_SWEEP)
  })

  it('弯曲度低于阈值时走直线路径(避免半径趋于无穷)', () => {
    const out = run('abc', { layout: arc(0.5) })
    expect(out.match(/<path /g)).toHaveLength(1)
    expect(out).not.toContain('rotate(')
  })
})

describe('度量', () => {
  it('measureTracked 计入字距', () => {
    const measure = (t: string, s: number) => t.length * s * 0.5
    expect(measureTracked(measure, 'abc', 40, 0)).toBe(60)
    expect(measureTracked(measure, 'abc', 40, 10)).toBe(80)
  })

  it('runRenderedWidth 超宽时收敛到可用宽度', () => {
    const measure = (t: string, s: number) => t.length * s * 0.5
    expect(runRenderedWidth(measure, 'abcdef', 40, 0, 60)).toBeCloseTo(60, 5)
    expect(runRenderedWidth(measure, 'ab', 40, 0, 60)).toBeCloseTo(40, 5)
  })

  it('无字体时的字宽估算:全角 1em、半角 0.55em', () => {
    expect(estimateAdvance('中', 40)).toBe(40)
    expect(estimateAdvance('a', 40)).toBeCloseTo(22, 5)
  })
})

describe('trackedMeasure', () => {
  const measure = (t: string, s: number) => t.length * s * 0.5

  it('固定字距:与 measureTracked 同一口径(首字前不加字距)', () => {
    const m = trackedMeasure(measure, 10)
    // 纯字宽 3 × 40 × 0.5 = 60,再加 2 个间隔 × 10
    expect(m('abc', 40)).toBe(80)
    expect(m('a', 40)).toBe(20)
    expect(m('', 40)).toBe(0)
  })

  it('按字号取字距:字距随字号一起缩放(em 比例的字距要这样传)', () => {
    const m = trackedMeasure(measure, (sz) => sz * 0.5)
    // 40 号:字宽 60 + 字距 20 × 2;20 号:字宽 30 + 字距 10 × 2
    expect(m('abc', 40)).toBe(100)
    expect(m('abc', 20)).toBe(50)
  })

  it('零字距时不改变纯字度的语义', () => {
    const m = trackedMeasure(measure, 0)
    expect(m('abcd', 40)).toBe(measure('abcd', 40))
  })
})
