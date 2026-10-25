import { describe, expect, it } from 'vitest'
import {
  CURVE_MAX_SWEEP, STRAIGHT, estimateAdvance, layoutRun, measureTracked, runRenderedWidth,
} from './textLayout'

/** 固定步进的假字体:每字宽 0.5em、每字一条 M 命令,便于精确断言排布结果 */
const FONT = {
  getAdvanceWidth: (_c: string, size: number) => size * 0.5,
  getPath: (c: string, x: number, y: number) => ({ commands: [{ type: 'M', x, y }] }),
}

const STRAIGHT_TEXT = { ...STRAIGHT }
const run = (s: string, opts: {
  size?: number; track?: number; color?: string; anchor?: 'start' | 'middle' | 'end'
  maxW?: number; layout?: typeof STRAIGHT; extraScale?: number; font?: typeof FONT | null
} = {}) => layoutRun(
  opts.font === undefined ? FONT : opts.font,
  s, 100, 200, opts.size ?? 40, opts.track ?? 0, opts.color ?? '#ffffff',
  opts.anchor ?? 'middle', true, opts.maxW ?? 0, opts.layout ?? STRAIGHT_TEXT, opts.extraScale ?? 1,
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