import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { buildCoverSvg } from './svgBuilder'
import { parseFont } from './fontLoader'
import { makeCoverState } from './coverState'

/**
 * 非测试脚本：把若干代表性状态渲染成 SVG 落到 .visual-out/，供人工与
 * 外部栅格化工具（scripts/render_svg.py）目视核对版式。
 * 断言为空是刻意的——数值不变量由 svgBuilder.spec.ts 负责，
 * 这里只产出可看的产物，避免把「看一眼」变成脆弱的快照断言。
 */
const FONT_PATH = '../src/main/resources/static/fonts/DouyinSansBold.otf'
const OUT = '../.visual-out'
// 一枚真实可解码的 120×120 PNG（青色圆环），占位图字节不完整会让栅格化脚本无法渲染
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAADUklEQVR4nO2dS3IiMRBEmwlfajTbmVN7tpaOZW9MBEG4G31KqqxUvrUNRT6yuoE2Pg4hhBBCeHA7CPn98f7Z+7vlzz+qTG47y9xBerjBVwhlEh5iUASpUWVDD4csNopouKEiSY0gG2YQBrGIon8dADDKRXlct90DYG+zy53uJNZb9PIVvbNcj8e/VPDucj1yWLIuJNZvZU9vsOT65jNVsOT65zRNsORi5DVFsOTi5GYuWHKx8jMVLLl4OZoJllxbrPI0ESy5c7DIdViw5M5lNF+IjwvFPIYEq71rGMm5W7DkrqU37y7BkutDT+46BpPTLFjt9aU1fzWYnCbBai8GLR6qBUsuFrU+tKLJqRKs9mJS40UNJuftICenvy9/JuX/Bys3xvVcI5VJ9tWltzQNHpF6djsRZTcdg6O010ruqtu15spT6AavEJC/7yNqm8OeRa9uVw7S5mrByOvZK+wMLPnMV7gGe4ecgSWHF4wSbgaZg0owWqgZbJ4mwcjHX3HOT95CNBi1LRl0rlCC0UPM4PPBCxZjSPBugpFOsNDXH+Kcz/7UYHIkmBxYwUhrL/K8sIKFDRJMjgSTI8HkSDA5EkyOBJMjweTACo52mWoCnRdWsLBBgncTjPDfutDXHvKcz/7UYHIkmBx4wUjrL+J88IKRQ0ygc70UjHSiJer5yVuIBiO2JYHNc0YYwUihJpA56AQjhJsCyb0UjHwc9go5Acs98xWuwV5hJ2C5V4T+EpZ76DMvWU1BxVY1GHlNr5CQgsjd4ovQHmXs9k13V1Q1FOkP0lrJ5N9V+WrL0jSYUZ4FYc+ihaHgKCdbu1EqvKjB5FQLVouxqPXR1GBJxqDFg1Y0Oc2C1WJfWvNXg8npEqwW+9CTe3eDJXktvXkPrWhJXsNIzjoGkzMsWC2ey2i+Jg2W5DlY5Gq2oiXZFqs8TY/BkoyXo/lJliRj5TflLFqScXKb9jJJkjHymvo6WJL9c5r+Rock++az9FqryJffRn3iL32rUm1en8Py96J3l1wWP37XsHda2cXpiQ3RJmbRxXljQXxc6B0C8+NyH4CxzQVA7B2YQaLLLkBSH4EcKpLoAir2DvRwqLILuNRHwgzqKbwEEvpM2MFnSS+BZQohhDgi8QWZqGWlCwKjmAAAAABJRU5ErkJggg=='

describe.skipIf(!existsSync(FONT_PATH))('视觉快照产物', () => {
  it('输出代表性版式', () => {
    const buf = readFileSync(FONT_PATH)
    const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    mkdirSync(OUT, { recursive: true })

    const cases: Record<string, ReturnType<typeof makeCoverState>> = {
      // 1) 默认：分缝 + Logo + 副标题 + 水印
      '01-split-default': makeCoverState({
        titleLeft: '工具', titleRight: '推荐',
        subtitle: '每周分享', watermark: 'example.com',
      }),
      // 2) 长度不均：修复前短段会被放大，现应同字号
      '02-split-uneven': makeCoverState({
        titleLeft: '短', titleRight: '这是一个明显更长的标题',
        subtitle: '对比字号一致性', watermark: 'example.com',
      }),
      // 3) 整块排版：自动换行
      '03-flow': makeCoverState({
        titleMode: 'flow',
        titleLeft: '一个足够长的标题用来触发自动换行',
        titleRight: '再加一段同样很长的内容',
        subtitle: '整块居中', watermark: 'example.com',
      }),
      // 4) 元素自由定位：Logo 左上、标题偏下、水印居中
      '04-moved': makeCoverState({
        titleLeft: '移动', titleRight: '元素',
        subtitle: '副标题', watermark: 'example.com',
        layout: {
          logo: { x: 0.16, y: 0.24, scale: 0.6, opacity: 1, rotation: 0 },
          title: { x: 0.55, y: 0.72, scale: 0.8, opacity: 1, rotation: 0 },
          subtitle: { x: 0.5, y: 0.9, scale: 0.9, opacity: 1, rotation: 0 },
          watermark: { x: 0.5, y: 0.08, scale: 1, opacity: 1, rotation: 0 },
        },
      }),
      // 5) 自定义元素三种形态
      '05-custom': makeCoverState({
        titleLeft: '自定义', titleRight: '元素',
        subtitle: '图片 / 文字 / SVG', watermark: 'example.com',
        customElements: [
          {
            id: 't1', kind: 'text', content: '', text: '文字元素',
            size: 40, anchor: { x: 0.5, y: 0.16, scale: 1, opacity: 1, rotation: 0 },
            color: '#39c5bb', bold: true, tracking: 0.1, curve: 0, direction: 'horizontal' as const, aspect: 1,
          },
          {
            id: 'i1', kind: 'image', content: LOGO, text: '',
            size: 90, anchor: { x: 0.12, y: 0.84, scale: 1, opacity: 1, rotation: 0 },
            color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
          },
          {
            id: 's1', kind: 'svg',
            content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24">' +
              '<rect width="48" height="24" rx="4" fill="#ffffff"/></svg>',
            text: '', size: 120, anchor: { x: 0.88, y: 0.84, scale: 1, opacity: 1, rotation: 0 },
            color: '#ffffff', bold: false, tracking: 0, curve: 0, direction: 'horizontal' as const, aspect: 1,
          },
        ],
      }),
      // 6) 无 Logo：两段拼接为一行
      '06-no-logo': makeCoverState({
        titleLeft: '无', titleRight: 'Logo', logoHidden: true,
        subtitle: '两段拼接居中', watermark: 'example.com',
      }),
      // 7) 正方形画布：同一份锚点在 1:1 上重新构图
      '07-square': makeCoverState({
        canvas: { width: 1200, height: 1200 },
        titleLeft: '正方形', titleRight: '画布',
        subtitle: '1:1', watermark: 'example.com',
      }),
      // 8) 竖版画布：内容不越界
      '08-tall': makeCoverState({
        canvas: { width: 1200, height: 1600 },
        titleLeft: '竖版', titleRight: '3:4',
        subtitle: '适配长画布', watermark: 'example.com',
      }),
      // 9) 中缝间距拉大：两段明显分开
      '09-seam-wide': makeCoverState({
        titleLeft: '工具', titleRight: '推荐', seamGap: 260,
        subtitle: '中缝 260px', watermark: 'example.com',
      }),
      // 10) 图层顺序：标题压到最底层，水印提到最上层
      '10-layers': makeCoverState({
        titleLeft: '标题在下', titleRight: '水印在上',
        subtitle: '图层顺序', watermark: 'example.com',
        layers: ['title', 'logo', 'subtitle', 'watermark'],
      }),
    }

    for (const [name, state] of Object.entries(cases)) {
      const svg = buildCoverSvg({ state, font, defaultLogoDataUrl: LOGO })
      writeFileSync(`${OUT}/${name}.svg`, svg, 'utf8')
    }

    // 只断言「产物确实生成且是完整 SVG」：版式的数值不变量归 svgBuilder.spec.ts，
    // 这里若对具体坐标做快照，改版式时会大面积误报而失去目视核对的价值
    for (const name of Object.keys(cases)) {
      const written = readFileSync(`${OUT}/${name}.svg`, 'utf8')
      expect(written.startsWith('<svg')).toBe(true)
      expect(written.trimEnd().endsWith('</svg>')).toBe(true)
      // viewBox 必须跟随各自的分辨率，而不是固定的 1200×630
      const canvas = cases[name].canvas
      expect(written).toContain(`viewBox="0 0 ${canvas.width} ${canvas.height}"`)
    }
  })
})