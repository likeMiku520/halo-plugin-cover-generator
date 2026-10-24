import { describe, it, expect } from 'vitest'
import { splitTitle } from './splitTitle'

describe('splitTitle', () => {
  it('偶数中文按宽度中点拆', () =>
    expect(splitTitle('工具推荐')).toEqual({ left: '工具', right: '推荐' }))
  it('奇数中文中点偏左下刀', () =>
    expect(splitTitle('我的工具推荐')).toEqual({ left: '我的工', right: '具推荐' }))
  it('手动分隔符 | 优先且不出现于结果', () =>
    expect(splitTitle('用 Vue|写封面')).toEqual({ left: '用 Vue', right: '写封面' }))
  it('英文在空格处回退切分', () =>
    expect(splitTitle('Cover Maker')).toEqual({ left: 'Cover', right: 'Maker' }))
  it('无断点的纯英文硬切', () =>
    expect(splitTitle('Highlighted').left.length).toBeGreaterThan(0))
  it('单字标题右段为空', () =>
    expect(splitTitle('好')).toEqual({ left: '好', right: '' }))
  it('空串返回空段', () =>
    expect(splitTitle('  ')).toEqual({ left: '', right: '' }))
  it('| 恰在句首/句尾也可用', () =>
    expect(splitTitle('中文|')).toEqual({ left: '中文', right: '' }))
})
