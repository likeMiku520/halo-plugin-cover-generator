import type { Gradient, GradientStop } from './types'

export interface GradientPreset extends Gradient {
  id: string
  name: string
  group: string
}

const p = (id: string, name: string, group: string, angle: number,
  stops: [number, string][]): GradientPreset => ({
  id, name, group, angle,
  stops: stops.map(([offset, color]): GradientStop => ({ offset, color })),
})

/** 精选自 pxlab.cn 的 24 套渐变，sunset 为参考封面同款 */
export const PRESETS: GradientPreset[] = [
  // 暖阳
  p('sunset', '日落橙', '暖阳', 120, [[0, '#f6d365'], [100, '#fda085']]),
  p('dusk', '黄昏', '暖阳', 300, [[0, '#ff5858'], [100, '#f09819']]),
  p('coral', '珊瑚', '暖阳', 340, [[0, '#fc6076'], [100, '#ff9a44']]),
  p('peach', '蜜桃', '暖阳', 340, [[0, '#f794a4'], [100, '#fdd6bd']]),
  p('rouge', '粉黛', '暖阳', 120, [[0, '#f093fb'], [100, '#f5576c']]),
  p('cream', '奶油', '暖阳', 315, [[0, '#FFE29F'], [48, '#FFA99F'], [100, '#FF719A']]),
  // 海洋
  p('sky', '晴空', '海洋', 120, [[0, '#89f7fe'], [100, '#66a6ff']]),
  p('sea', '海水', '海洋', 15, [[0, '#13547a'], [100, '#80d0c7']]),
  p('mint', '薄荷', '海洋', 340, [[0, '#00cdac'], [100, '#8ddad5']]),
  p('aurora', '极光', '海洋', 180, [[0, '#2af598'], [100, '#009efd']]),
  p('lake', '湖水', '海洋', 120, [[0, '#a1c4fd'], [100, '#c2e9fb']]),
  p('frost', '薄雾', '海洋', 135, [[0, '#f5f7fa'], [100, '#c3cfe2']]),
  // 紫粉
  p('nebula', '星云', '紫粉', 315, [[0, '#AC32E4'], [48, '#7918F2'], [100, '#4801FF']]),
  p('violet', '紫晶', '紫粉', 340, [[0, '#6e45e2'], [100, '#88d3ce']]),
  p('neon', '霓虹', '紫粉', 340, [[0, '#b721ff'], [100, '#21d4fd']]),
  p('rose', '蔷薇', '紫粉', 315, [[0, '#FF3CAC'], [52, '#562B7C'], [100, '#2B86C5']]),
  p('deepsea', '深空', '紫粉', 340, [[0, '#2b5876'], [100, '#4e4376']]),
  p('indigo', '靛蓝', '紫粉', 315, [[0, '#3D4E81'], [48, '#5753C9'], [100, '#6E7FF3']]),
  // 青绿
  p('lime', '青柠', '青绿', 120, [[0, '#d4fc79'], [100, '#96e6a1']]),
  p('spring', '春晓', '青绿', 315, [[0, '#20E2D7'], [100, '#F9FEA5']]),
  p('soda', '汽水', '青绿', 315, [[0, '#77FFD2'], [48, '#6297DB'], [100, '#1EECFF']]),
  p('olive', '橄榄', '青绿', 300, [[0, '#16a085'], [100, '#f4d03f']]),
  // 清新
  p('evening', '晚霞', '清新', 135, [[0, '#667eea'], [100, '#764ba2']]),
  p('candy', '糖果', '清新', 315, [[0, '#D4FFEC'], [48, '#57F2CC'], [100, '#4596FB']]),
]

/**
 * 默认背景：海洋组第三个（薄荷）。
 * defaultCoverState 与「存档里的渐变不合法」的修复路径共用这一份，
 * 两处各自写死 id 迟早会漂移。
 */
export const DEFAULT_PRESET: GradientPreset = PRESETS.find((p) => p.id === 'mint') ?? PRESETS[0]
