import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { buildCoverSvg, LAYOUT } from './svgBuilder'
import { REF_H, REF_W, defaultCoverState, defaultTextStyles } from './layout'
import { parseFont, type OpentypeFont } from './fontLoader'
import { makeCoverState } from './coverState'

// 字体已出包至插件 JAR 静态资源(M7),测试直接从仓库内该位置读取
const FONT_PATH = '../src/main/resources/static/fonts/DouyinSansBold.otf'
const hasFont = existsSync(FONT_PATH)
const getFont = (): OpentypeFont => {
  const buf = readFileSync(FONT_PATH)
  return parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

const state = makeCoverState({
  // 出厂默认已是整块排版(flow)，本文件的基准夹具承载的是分缝文本，
  // 因此显式声明模式，避免默认值一改就悄悄换掉被测行为
  titleMode: 'split',
  // 分辨率同样钉在参考画布上：本文件的数值断言都是在参考比例下校准的，
  // 画布尺寸本身另有测试覆盖，不该让「换默认分辨率」把所有数字断言冲掉
  canvas: { width: 1200, height: 630 },
  titleLeft: '工具', titleRight: '推荐', titleFontSize: 210, subtitle: '',
  gradient: { angle: 120, stops: [{ offset: 0, color: '#f6d365' }, { offset: 100, color: '#fda085' }] },
  presetId: null, logoDataUrl: null, logoHidden: false,
  watermark: '',
})

describe.skipIf(!hasFont)('buildCoverSvg 标题层', () => {
  it('产出与参考图同构的骨架', () => {
    const font = getFont()
    const svg = buildCoverSvg({ state, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(svg).toContain('viewBox="0 0 1200 630"')
    expect(svg).toContain('<linearGradient id="bg"')
    expect(svg).toContain('#f6d365')
    expect(svg).toContain('<path')            // 文字是路径
    expect(svg).not.toContain('<text')        // 正常态无 text 回退
  })
  it('分缝模式输出左右两段路径', () => {
    // 分缝由「Logo 显示中」决定；Logo 图元本身 Task 7 才渲染，此处只看标题路径
    const font = getFont()
    const svg = buildCoverSvg({ state, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(svg.match(/<path/g)!.length).toBeGreaterThanOrEqual(2)  // 左右两段
    expect(svg).not.toContain('<text')                             // 已全部转路径
    expect(svg).not.toContain('工具推荐')                           // 原文不出现在文件里
  })
  it('隐藏 Logo 时无 Logo 元素且标题合并为一段', () => {
    const font = getFont()
    const svg = buildCoverSvg({ state: { ...state, logoHidden: true }, font, defaultLogoDataUrl: '' })
    expect(svg).not.toContain('clip-path')
    expect(svg.match(/<path/g)!.length).toBe(1)  // 整行一段
  })
  it('字体缺失时降级为 <text>', () => {
    const svg = buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' })
    expect(svg).toContain('<text')
    expect(svg).toContain('sans-serif')
  })
  it('画布基准常量与文档一致', () => {
    // 画布像素改由 state.canvas 驱动(可选分辨率),LAYOUT 只保留排版基准;
    // 左右段位置由 layout.title 锚点 + SEAM_GAP 推导,故不断言固定像素坐标
    expect(LAYOUT).toMatchObject({
      TITLE_BASE: 210,
      TITLE_MIN: 64,
      SUB_BASE: 34,
      LOGO_SIZE: 200,
      SEAM_GAP: 80,
    })
    expect(REF_W).toBe(1200)
    expect(REF_H).toBe(630)
  })
  it('左右段独立渲染：仅填一侧时另一侧为空', () => {
    const font = getFont()
    const onlyLeft = buildCoverSvg({ state: { ...state, titleRight: '' }, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    const onlyRight = buildCoverSvg({ state: { ...state, titleLeft: '' }, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(onlyLeft.match(/<path/g)!.length).toBe(1)
    expect(onlyRight.match(/<path/g)!.length).toBe(1)
  })
  it('titleFontSize 影响生成路径（字号可调生效）', () => {
    const font = getFont()
    const big = buildCoverSvg({ state: { ...state, logoHidden: true }, font, defaultLogoDataUrl: '' })
    const small = buildCoverSvg({ state: { ...state, logoHidden: true, titleFontSize: 120 }, font, defaultLogoDataUrl: '' })
    // 不同基准字号必须产生不同的路径数据
    const dBig = big.match(/ d="[^"]{0,40}/)![0]
    const dSmall = small.match(/ d="[^"]{0,40}/)![0]
    expect(dBig).not.toBe(dSmall)
  })
  it('两段均为空时降级态显示占位文字', () => {
    const svg = buildCoverSvg({
      state: { ...state, titleLeft: '', titleRight: '' }, font: null, defaultLogoDataUrl: '' })
    expect(svg).toContain('标题')
  })
  it('占位文字降透明度以区别于真实封面(A5);有标题时无占位透明组', () => {
    const placeholder = buildCoverSvg({
      state: { ...state, titleLeft: '', titleRight: '' }, font: null, defaultLogoDataUrl: '' })
    expect(placeholder).toContain('<g opacity="0.4">')

    const real = buildCoverSvg({ state, font: null, defaultLogoDataUrl: '' })
    expect(real).not.toContain('<g opacity="0.4">')
  })
})

/** 取路径自身坐标的横向跨度（含 transform 的 scale 影响），用于比较两段实际绘制宽度 */
function pathWidth(transform: string, d: string): number {
  // 分缝模式可能同时带 fit 与共用压缩两个系数，全部相乘才是实际宽度
  const scales = [...transform.matchAll(/scale\(([\d.]+)\s+1\)/g)].map((m) => Number(m[1]))
  const sx = scales.length ? scales.reduce((a, b) => a * b, 1) : 1
  const xs = [...d.matchAll(/[MLCQ]\s*(-?[\d.]+)[ ,]/g)].map((m) => Number(m[1]))
  if (xs.length === 0) return 0
  return (Math.max(...xs) - Math.min(...xs)) * sx
}

function firstTwoPaths(svg: string): { w1: number; w2: number } {
  const paths = [...svg.matchAll(/<path transform="([^"]*)" d="([^"]*)"/g)]
  expect(paths.length).toBeGreaterThanOrEqual(2)
  return {
    w1: pathWidth(paths[0][1], paths[0][2]),
    w2: pathWidth(paths[1][1], paths[1][2]),
  }
}

/** 从 path 的 transform 里取累积水平缩放 */
function transformScaleX(transform: string): number {
  const scales = [...transform.matchAll(/scale\(([\d.]+)\s+1\)/g)].map((m) => Number(m[1]))
  return scales.length ? scales.reduce((a, b) => a * b, 1) : 1
}

function transformTranslateX(transform: string): number {
  const m = /translate\((-?[\d.]+)/.exec(transform)
  return m ? Number(m[1]) : 0
}

describe.skipIf(!hasFont)('buildCoverSvg 分缝模式的字号一致性', () => {
  it('两段长度悬殊时仍用同一字号：短段绘制宽度不超过长段', () => {
    const font = getFont()
    // 旧实现两段各自 fit，短段会被放大到与长段同宽；现应共用同一缩放系数
    const svg = buildCoverSvg({
      state: { ...state, titleLeft: '短', titleRight: '这是一个明显更长的标题' },
      font,
      defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    const { w1, w2 } = firstTwoPaths(svg)
    expect(w1).toBeLessThan(w2)
    // 短段不应被拉到接近长段宽度（同字号下应约为其字号宽度量级）
    expect(w1).toBeLessThan(w2 * 0.5)
  })

  it('两段等长时绘制宽度接近一致', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, titleLeft: '工具推荐', titleRight: '每周分享' },
      font,
      defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    const { w1, w2 } = firstTwoPaths(svg)
    expect(Math.abs(w1 - w2)).toBeLessThan(Math.max(w1, w2) * 0.15)
  })

  it('单侧过宽时两段一起缩小，保持字号一致', () => {
    const font = getFont()
    const long = '一二三四五六七八九十一二三四五六七八九十'
    const svg = buildCoverSvg({
      state: { ...state, titleLeft: '短', titleRight: long },
      font,
      defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    const { w1, w2 } = firstTwoPaths(svg)
    // 长段被压进单侧可用宽度（520 上下的量级），短段随之同样缩小而非保持原字号
    expect(w2).toBeLessThanOrEqual(560)
    expect(w1).toBeLessThan(w2)
  })

  it('字号触底后仍以水平压缩兜住宽度，长段不会冲出画布', () => {
    const font = getFont()
    // 极长标题会撞到 64px 字号下限；旧实现在此处丢掉压缩，长段直接画到画布外
    const svg = buildCoverSvg({
      state: { ...state, titleLeft: '短', titleRight: '极长标题'.repeat(12) },
      font,
      defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    const paths = [...svg.matchAll(/<path transform="([^"]*)" d="([^"]*)"/g)]
    const left = paths[0]
    const right = paths[1]
    // 中缝两侧各留 SEAM_GAP/2，压缩后不得越过单侧可用宽度
    const rightEnd = transformTranslateX(right[1]) + pathWidth(right[1], right[2])
    expect(rightEnd).toBeLessThanOrEqual(600 + 40 + 520 + 1)
    const leftEnd = transformTranslateX(left[1]) + pathWidth(left[1], left[2])
    expect(leftEnd).toBeLessThanOrEqual(600 - 40 + 1)
    expect(transformScaleX(right[1])).toBeLessThan(1)
  })
})

describe.skipIf(!hasFont)('buildCoverSvg 整块排版模式', () => {
  it('flow 模式只用自身文本并自动换行', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: {
        ...state,
        titleMode: 'flow',
        titleFlow: '一个足够长的标题用来触发自动换行再加一段同样很长的内容',
        // 分缝文本同时存在也不得混入：两种排版各自独立
        titleLeft: '不应出现',
        titleRight: '也不应出现',
      },
      font,
      defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    // 换行后行数 > 1，路径数量随之增加（分缝模式无论多长都只有 2 段）
    expect(svg.match(/<path/g)!.length).toBeGreaterThan(2)
    // 整块模式不再按中缝分栏：Logo 存在也不产生左右两段
    expect(svg).toContain('<image')
  })

  it('flow 模式下短标题只有一行', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, titleMode: 'flow', titleFlow: '短标题', titleLeft: '', titleRight: '' },
      font,
      defaultLogoDataUrl: '',
    })
    expect(svg.match(/<path/g)!.length).toBe(1)
  })

  it('flow 模式文本为空时显示占位，不复用分缝文本', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, titleMode: 'flow', titleFlow: '', titleLeft: '左', titleRight: '右' },
      font,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('<g opacity="0.4">')
  })
})

describe.skipIf(!hasFont)('buildCoverSvg 中缝间距与图层顺序', () => {
  it('中缝间距可调：加大间距后两段向外分开', () => {
    const font = getFont()
    const measure = (gap: number) => {
      const svg = buildCoverSvg({
        state: { ...state, titleLeft: '工具', titleRight: '推荐', seamGap: gap },
        font,
        defaultLogoDataUrl: 'data:image/png;base64,AAA',
      })
      const paths = [...svg.matchAll(/<path transform="([^"]*)" d="([^"]*)"/g)]
      return paths.map((p) => transformTranslateX(p[1]))
    }
    const small = measure(40)
    const large = measure(200)
    // 左段左移、右段右移，两者间距随 seamGap 增大
    expect(large[0]).toBeLessThan(small[0])
    expect(large[1]).toBeGreaterThan(small[1])
  })

  it('图层顺序决定绘制先后：靠后者出现在标记更后面', () => {
    const font = getFont()
    const withOrder = (layers: string[]) => buildCoverSvg({
      state: {
        ...state,
        subtitle: '副标题',
        watermark: 'example.com',
        layers: layers as never,
      },
      font,
      defaultLogoDataUrl: 'data:image/png;base64,AAA',
    })
    const titleFirst = withOrder(['title', 'subtitle', 'logo', 'watermark'])
    const titleLast = withOrder(['subtitle', 'logo', 'watermark', 'title'])
    const indexOfTitle = (svg: string) => svg.indexOf('<g filter="url(#shadow)">')
    expect(indexOfTitle(titleFirst)).toBeLessThan(indexOfTitle(titleLast))
    // 两次都只画一次标题，元素不会因重排而重复或丢失
    expect(titleFirst.match(/<g filter="url\(#shadow\)">/g)!.length).toBe(1)
    expect(titleLast.match(/<g filter="url\(#shadow\)">/g)!.length).toBe(1)
  })

  it('图层表缺失的元素补画在末尾，不会消失', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, subtitle: '副标题', layers: ['title'] as never },
      font,
      defaultLogoDataUrl: '',
    })
    // 图层表只声明了 title，副标题仍须被画出
    expect(svg.match(/<path/g)!.length).toBeGreaterThanOrEqual(2)
  })
})

describe.skipIf(!hasFont)('buildCoverSvg 自定义元素', () => {
  it('文字元素以路径渲染并带自定义颜色', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: {
        ...state,
        customElements: [{
          id: 't1', kind: 'text', content: '', text: '自定义',
          size: 48, anchor: { x: 0.2, y: 0.15, scale: 1, opacity: 1, rotation: 0 },
          color: '#39c5bb', bold: true, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
        }],
      },
      font,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('fill="#39c5bb"')
  })

  it('图片元素内嵌 dataURL，导出不依赖外链', () => {
    const svg = buildCoverSvg({
      state: {
        ...state,
        customElements: [{
          id: 'i1', kind: 'image', content: 'data:image/png;base64,ZZZ', text: '',
          size: 120, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
          color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
        }],
      },
      font: null,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('data:image/png;base64,ZZZ')
    // 圆形裁剪已移除：不再产出 clipPath
    expect(svg).not.toContain('ce-clip')
  })

  it('SVG 图标按 viewBox 缩放，非方形图标不被拉伸', () => {
    const svg = buildCoverSvg({
      state: {
        ...state,
        customElements: [{
          id: 's1', kind: 'svg',
          content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><rect width="48" height="24" fill="#fff"/></svg>',
          text: '', size: 240, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
          color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
        }],
      },
      font: null,
      defaultLogoDataUrl: '',
    })
    // 缩放系数取 size / max(viewBox 边) = 240 / 48 = 5
    expect(svg).toContain('scale(5)')
  })

  it('锚点缩放同时作用于位置与尺寸', () => {
    const make = (scale: number) => buildCoverSvg({
      state: {
        ...state,
        customElements: [{
          id: 'i2', kind: 'image', content: 'data:image/png;base64,ZZZ', text: '',
          size: 100, anchor: { x: 0.5, y: 0.5, scale, opacity: 1, rotation: 0 },
          color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
        }],
      },
      font: null,
      defaultLogoDataUrl: '',
    })
    const small = make(0.5)
    const large = make(2)
    expect(small).not.toBe(large)
    expect(small).toContain('width="50"')
    expect(large).toContain('width="200"')
  })
})

describe.skipIf(!hasFont)('buildCoverSvg 副标题与 Logo', () => {
  it('有副标题时出现居中路径文字', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, subtitle: '每周分享' }, font, defaultLogoDataUrl: '' })
    // 无 Logo → 标题合并 1 段 + 副标题 1 段 = 2 段路径
    expect(svg.match(/<path/g)!.length).toBe(2)
  })
  it('默认 Logo 内嵌为 image 且圆形裁剪', () => {
    const font = getFont()
    const logo = 'data:image/png;base64,AAA'
    const svg = buildCoverSvg({ state, font, defaultLogoDataUrl: logo })
    expect(svg).toContain('<clipPath id="logo-clip">')
    expect(svg).toContain('clip-path="url(#logo-clip)"')
    expect(svg).toContain(logo)
  })
  it('投影作用于裁圆结果（外层 g filter 包裹内层 clip image，无方形阴影）', () => {
    const font = getFont()
    const logo = 'data:image/png;base64,AAA'
    const svg = buildCoverSvg({ state, font, defaultLogoDataUrl: logo })
    expect(svg).toContain('<g filter="url(#logo-shadow)"><image')
    // image 自身不再挂 filter（避免规范中 filter 先于 clip 产生方形阴影）
    expect(svg).not.toMatch(/<image[^>]*filter=/)
    // 不加白圈描边（用户裁定）：Logo 元素仅 image，无 stroke 圆
    expect(svg).not.toContain('stroke-width')
  })
  it('自定义 Logo 覆盖默认 Logo', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, logoDataUrl: 'data:image/png;base64,BBB' },
      font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(svg).toContain('BBB')
    expect(svg).not.toContain('AAA')
  })
  it('logoHidden 时无 Logo 元素', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, logoHidden: true }, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(svg).not.toContain('logo-clip')
  })
  it('副标题为空时无副标题路径段', () => {
    const font = getFont()
    const svg = buildCoverSvg({ state, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    // 分缝标题 2 段，无副标题
    expect(svg.match(/<path/g)!.length).toBe(2)
  })
})

describe.skipIf(!hasFont)('buildCoverSvg 光影 / 噪点 / 水印', () => {
  it('defs 含高光、暗角、噪点层，body 按序叠加', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(svg).toContain('<radialGradient id="hl"')
    expect(svg).toContain('<radialGradient id="vig"')
    expect(svg).toContain('feTurbulence')
    expect(svg).toContain('fill="url(#hl)"')
    expect(svg).toContain('fill="url(#vig)"')
    expect(svg).toContain('fill="url(#grain)"')
    // 高光/暗角在背景之上、文字之下；噪点最上层（在 Logo 之后）
    expect(svg.indexOf('fill="url(#vig)"')).toBeLessThan(svg.indexOf('<g filter="url(#shadow)"'))
    expect(svg.lastIndexOf('fill="url(#grain)"')).toBeGreaterThan(svg.indexOf('logo-clip'))
  })
  it('水印渲染为右下角路径且不出现原文', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, watermark: 'example.com' }, font, defaultLogoDataUrl: 'data:image/png;base64,AAA' })
    expect(svg).toContain('<g opacity="0.65">')
    // Logo 显示中 → 分缝标题 2 段 + 水印 1 段
    expect(svg.match(/<path/g)!.length).toBe(3)
    expect(svg).not.toContain('example.com')
  })
  it('水印为空串时不渲染', () => {
    const font = getFont()
    const svg = buildCoverSvg({ state: { ...state, watermark: '   ' }, font, defaultLogoDataUrl: '' })
    expect(svg).not.toContain('<g opacity="0.65">')
  })
  it('文本回退路径转义单引号(esc 加固,属性/文本双保险)', () => {
    const svg = buildCoverSvg({
      state: { ...state, watermark: "it's" }, font: null, defaultLogoDataUrl: '' })
    expect(svg).toContain('&#39;')
  })
  it('副标题带字距并出现两侧装饰线', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, subtitle: '每周分享' }, font, defaultLogoDataUrl: '' })
    expect(svg).toContain('width="46"')            // 装饰线
    expect(svg.match(/<path/g)!.length).toBe(2)    // 合并标题 + 副标题
    // 小字号副标题用轻投影（sub-shadow），装饰线独立于投影组之外不被糊边
    expect(svg).toContain('<g filter="url(#sub-shadow)" opacity="0.9">')
    expect(svg).toContain('</g><g opacity="0.55">')
  })
  it('字体缺失时副标题降级使用 letter-spacing 属性', () => {
    const svg = buildCoverSvg({
      state: { ...state, subtitle: '每周分享' }, font: null, defaultLogoDataUrl: '' })
    // 副标题默认大小 50%：字号 34、字距都随 ax.scale 减半 → r2(34 × 0.3 × 0.5)
    expect(svg).toContain('letter-spacing="5.1"')
  })
  it('超宽水印整体水平压缩且不越出画布左缘', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, watermark: '超'.repeat(60) }, font, defaultLogoDataUrl: '' })
    const wm = svg.slice(svg.indexOf('<g opacity="0.65">'))
    expect(wm).toContain('scale(') // 超宽时压缩，与标题/副标题策略一致
    const tx = Number(wm.match(/translate\(([-\d.]+)/)![1])
    expect(tx).toBeGreaterThanOrEqual(0) // end 锚点起点不得为负（否则左侧被裁）
  })
  it('副标题超宽压缩后装饰线贴压缩宽并留在画布内', () => {
    const font = getFont()
    const svg = buildCoverSvg({
      state: { ...state, logoHidden: true, subtitle: '超'.repeat(40) },
      font, defaultLogoDataUrl: '' })
    const xs = [...svg.matchAll(/<rect x="([-\d.]+)"[^>]*width="46"/g)].map(m => Number(m[1]))
    expect(xs.length).toBe(2)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x + LAYOUT.SUB_LINE_W).toBeLessThanOrEqual(state.canvas.width)
    }
  })
})

describe('自定义 svg 图标的颜色解析', () => {
  /** 图标选择器取回的标记按 currentColor 入库,颜色只存在于元素状态里 */
  const ICON_ELEMENT = {
    id: 'ce1',
    kind: 'svg' as const,
    content: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>',
    text: '',
    size: 120,
    anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
    color: '#39C5BB',
    bold: false,
    tracking: 0,
    curve: 0,
    direction: 'horizontal' as const,
    aspect: 1,
  }

  it('把元素颜色写成 g 的 color 属性,标记里的 currentColor 才能解析出颜色', () => {
    const svg = buildCoverSvg({
      state: { ...state, customElements: [ICON_ELEMENT] },
      font: null,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('color="#39C5BB"')
    expect(svg).toContain('fill="currentColor"')
  })

  it('颜色取自元素状态,改色只改这一处属性', () => {
    const svg = buildCoverSvg({
      state: { ...state, customElements: [{ ...ICON_ELEMENT, color: '#f59e0b' }] },
      font: null,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('color="#f59e0b"')
    expect(svg).not.toContain('color="#39C5BB"')
  })
})

describe('背景模式', () => {
  const IMAGE = 'data:image/png;base64,AAAA'

  it('渐变模式铺线性渐变,不出现背景图元素', () => {
    const svg = buildCoverSvg({
      state: { ...state, backgroundMode: 'gradient' }, font: null, defaultLogoDataUrl: '',
    })
    expect(svg).toContain('fill="url(#bg)"')
    expect(svg).not.toContain('<image')
  })

  it('图片模式铺背景图,遮罩压在图片之上(否则起不到压暗作用)', () => {
    const svg = buildCoverSvg({
      state: { ...state, backgroundMode: 'image', backgroundImage: IMAGE, backgroundScrim: 30 },
      font: null,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain(`href="${IMAGE}"`)
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(svg).not.toContain('fill="url(#bg)"')
    expect(svg.indexOf('fill="#000" opacity="0.3"')).toBeGreaterThan(svg.indexOf('<image'))
  })

  it('压暗为 0 时不产出遮罩层', () => {
    const svg = buildCoverSvg({
      state: { ...state, backgroundMode: 'image', backgroundImage: IMAGE, backgroundScrim: 0 },
      font: null,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('<image')
    expect(svg).not.toContain('fill="#000" opacity="0"')
  })

  it('图片模式缺图时回退渐变,不产出空背景', () => {
    const svg = buildCoverSvg({
      state: { ...state, backgroundMode: 'image', backgroundImage: null },
      font: null,
      defaultLogoDataUrl: '',
    })
    expect(svg).toContain('fill="url(#bg)"')
    expect(svg).not.toContain('<image')
  })
})

/**
 * 竖排换列。
 *
 * 全部走无字体路径:那时竖排是逐字一个 <text>,列心就是它的 x,
 * 换列后的列数、列序、列距都能直接读出来(有字体时整段合成一条 path,位置全在 d 里)。
 * 画布钉在参考尺寸 1200×630,数值断言都按它校准。
 */
describe('buildCoverSvg 竖排换列', () => {
  const CANVAS = { width: 1200, height: 630 }
  /** 竖排样式:字距取 0,列距因此正好等于字号,列心好推算 */
  const VERTICAL = { tracking: 0, curve: 0, direction: 'vertical' as const, color: '#ffffff', bold: false }

  const xsIn = (svg: string) => [...svg.matchAll(/<text x="([-\d.]+)"/g)].map((m) => Number(m[1]))
  /** 截取某段包裹标记内部的片段:同一份 SVG 里多类文字都会产出 <text>,不截取会串台 */
  const innerOf = (svg: string, open: string) => {
    const from = svg.indexOf(open)
    expect(from).toBeGreaterThanOrEqual(0)
    const start = from + open.length
    return svg.slice(start, svg.indexOf('</g>', start))
  }

  it('竖排标题超出可用高度后换列:列数变多,首列在最右', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        titleMode: 'flow', titleFlow: '一二三四五六', titleFontSize: 210, canvas: CANVAS,
        textStyles: { ...defaultTextStyles(), title: VERTICAL },
      }),
      font: null, defaultLogoDataUrl: '',
    })
    // 可用高度 = 630 × 0.9333 ≈ 588、步进 = 字号 210 ⇒ 每列 2 字,六个字排 3 列;
    // 列距 = 210、整块以锚点 x = 600 为心 ⇒ 列心 810 / 600 / 390(自右向左)
    expect(xsIn(svg)).toEqual([810, 810, 600, 600, 390, 390])
  })

  it('竖排标题一列放得下时不换列:列心仍是锚点', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        titleMode: 'flow', titleFlow: '标题', titleFontSize: 210, canvas: CANVAS,
        textStyles: { ...defaultTextStyles(), title: VERTICAL },
      }),
      font: null, defaultLogoDataUrl: '',
    })
    // 两个字 = 420 ≤ 588:保持单列,位置与换列功能加入前完全一致
    expect(xsIn(svg)).toEqual([600, 600])
  })

  it('竖排标题里的换行按强制换列处理,不再在同一列里往下续排', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        titleMode: 'flow', titleFlow: '一二\n三四', titleFontSize: 210, canvas: CANVAS,
        textStyles: { ...defaultTextStyles(), title: VERTICAL },
      }),
      font: null, defaultLogoDataUrl: '',
    })
    // 两列各两个字:首列在右(705)、次列在左(495)
    expect(xsIn(svg)).toEqual([705, 705, 495, 495])
  })

  it('竖排副标题超出可用高度后换列', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        subtitle: '副'.repeat(30), canvas: CANVAS,
        textStyles: {
          ...defaultTextStyles(),
          subtitle: { ...defaultTextStyles().subtitle, direction: 'vertical' },
        },
      }),
      font: null, defaultLogoDataUrl: '',
    })
    const xs = xsIn(innerOf(svg, '<g filter="url(#sub-shadow)" opacity="0.9">'))
    // 字号 = 34 × 0.5 = 17、字距 0.3 ⇒ 步进 22.1;预算 = 630 × 0.9333 × 0.5 ≈ 294 ⇒ 每列 13 字
    expect(xs).toHaveLength(30)
    expect(new Set(xs).size).toBe(3)
    expect(xs[0]).toBeCloseTo(622.1, 2)
    expect(xs[xs.length - 1]).toBeCloseTo(577.9, 2)
  })

  it('竖排水印超出可用高度后换列,且朝画布内侧展开', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        watermark: '水'.repeat(20), canvas: CANVAS,
        textStyles: {
          ...defaultTextStyles(),
          watermark: { ...defaultTextStyles().watermark, direction: 'vertical' },
        },
      }),
      font: null, defaultLogoDataUrl: '',
    })
    const xs = xsIn(innerOf(svg, '<g opacity="0.65">'))
    // 字号 26、字距 0.08 ⇒ 步进 28.08;预算 = 630 × 0.35 ≈ 220 ⇒ 每列 7 字,20 字排 3 列
    expect(new Set(xs).size).toBe(3)
    expect(xs[0]).toBeCloseTo(1168.08, 2)
    // 自右向左展开:后续列朝画布内侧走,不会因为换列而探出右缘
    for (const x of xs) expect(x).toBeLessThanOrEqual(CANVAS.width)
  })

  it('竖排自定义文字元素超出可用高度后换列', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        canvas: CANVAS,
        customElements: [{
          id: 't1', kind: 'text', content: '', text: '字'.repeat(30),
          size: 40, anchor: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 },
          color: '#39c5bb', bold: false, tracking: 0, curve: 0,
          direction: 'vertical' as const, aspect: 1,
        }],
      }),
      font: null, defaultLogoDataUrl: '',
    })
    // 字号 40、步进 40;预算 = 630 × 0.75 ≈ 472 ⇒ 每列 11 字,30 字排 3 列,列心 640 / 600 / 560
    expect(xsIn(innerOf(svg, '<g>'))).toEqual([
      640, 640, 640, 640, 640, 640, 640, 640, 640, 640, 640,
      600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600,
      560, 560, 560, 560, 560, 560, 560, 560,
    ])
  })

  it('竖排换列后投影、旋转与透明度照旧生效', () => {
    const svg = buildCoverSvg({
      state: makeCoverState({
        titleMode: 'flow', titleFlow: '一二三四五六', titleFontSize: 210, canvas: CANVAS,
        layout: {
          ...defaultCoverState().layout,
          title: { x: 0.5, y: 0.5, scale: 1, opacity: 0.5, rotation: 30 },
        },
        textStyles: { ...defaultTextStyles(), title: VERTICAL },
      }),
      font: null, defaultLogoDataUrl: '',
    })
    expect(svg).toContain('<g filter="url(#shadow)">')
    expect(svg).toContain('rotate(30 600 315)')
    expect(svg).toContain('<g opacity="0.5">')
  })
})

/** 真实字体下的竖排:整段合成一条 path,字形坐标全在 d 里,换列效果只能从跨度上看 */
describe.skipIf(!hasFont)('buildCoverSvg 竖排换列(真实字体)', () => {
  const CANVAS = { width: 1200, height: 630 }
  /** pathToD 只写坐标数字,因此 d 里的数字是成对的 x / y */
  const coordsOf = (svg: string) => {
    const nums = [.../<path d="([^"]*)"/.exec(svg)![1].matchAll(/-?\d+(?:\.\d+)?/g)]
      .map((m) => Number(m[0]))
    return {
      xs: nums.filter((_, i) => i % 2 === 0),
      ys: nums.filter((_, i) => i % 2 === 1),
    }
  }
  const verticalTitleState = (text: string) => makeCoverState({
    titleMode: 'flow', titleFlow: text, titleFontSize: 210, canvas: CANVAS,
    textStyles: {
      ...defaultTextStyles(),
      title: { ...defaultTextStyles().title, direction: 'vertical' },
    },
  })

  it('六个字按每列 2 字换列:横向铺开成三列,纵向不再一路堆到画布外', () => {
    const svg = buildCoverSvg({
      state: verticalTitleState('一二三四五六'), font: getFont(), defaultLogoDataUrl: '',
    })
    const { xs, ys } = coordsOf(svg)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    // 列距 = 字号 210:三列铺开后横向跨度远超一个字宽
    expect(spanX).toBeGreaterThan(210 * 2)
    // 每列 2 字:纵向跨度收在两行上下(不换列时六个字要排到 1000px 开外)
    expect(spanY).toBeLessThan(210 * 3)
  })

  it('单列放得下时仍是一列,字形不外扩', () => {
    const svg = buildCoverSvg({
      state: verticalTitleState('标题'), font: getFont(), defaultLogoDataUrl: '',
    })
    const { xs } = coordsOf(svg)
    const spanX = Math.max(...xs) - Math.min(...xs)
    expect(spanX).toBeLessThan(210)
    // 单列居中在锚点 x = 600 上
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(600, 0)
  })
})
