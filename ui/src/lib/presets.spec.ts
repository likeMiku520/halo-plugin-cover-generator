import { describe, it, expect } from 'vitest'
import { PRESETS } from './presets'

describe('PRESETS', () => {
  it('共 24 套且 id 唯一', () => {
    expect(PRESETS).toHaveLength(24)
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(24)
  })
  it('含参考图同款日落橙', () => {
    const sunset = PRESETS.find(p => p.id === 'sunset')!
    expect(sunset.angle).toBe(120)
    expect(sunset.stops).toEqual([
      { offset: 0, color: '#f6d365' },
      { offset: 100, color: '#fda085' },
    ])
  })
  it('每套 2–4 个色标、offset 升序、角度 0–360', () => {
    for (const p of PRESETS) {
      expect(p.stops.length).toBeGreaterThanOrEqual(2)
      expect(p.stops.length).toBeLessThanOrEqual(4)
      expect(p.angle).toBeGreaterThanOrEqual(0)
      expect(p.angle).toBeLessThanOrEqual(360)
      for (let i = 1; i < p.stops.length; i++)
        expect(p.stops[i].offset).toBeGreaterThan(p.stops[i - 1].offset)
    }
  })
})
