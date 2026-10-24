import { afterEach, describe, expect, it, vi } from 'vitest'
import { axiosInstance } from '@halo-dev/api-client'
import {
  fetchPluginSettings,
  usePluginSettings,
  pluginSettingsDegraded,
  type PluginSettings,
} from './usePluginSettings'

// 与代码保持同一访问方式:复用 Halo 的 axiosInstance(Console HTTP 客户端)
vi.mock('@halo-dev/api-client', () => ({
  axiosInstance: { get: vi.fn<(url: string) => Promise<unknown>>() },
}))

const mockedGet = vi.mocked(axiosInstance.get)

const DEFAULTS: PluginSettings = {
  watermark: '',
  logoUrl: '',
  fontUrl: '',
  // 策略与分组默认空串:交由 Halo 决定默认策略、不指定分组
  attachmentPolicy: '',
  attachmentGroup: '',
}

/**
 * 构造 axiosInstance.get 的 ConfigMap 响应。
 * Halo 会把 Setting 表单组(base)的表单值序列化为 JSON 串存入 data.base。
 */
function configMapResponse(form?: unknown) {
  const data =
    form === undefined
      ? {}
      : { base: typeof form === 'string' ? form : JSON.stringify(form) }
  return {
    data: {
      apiVersion: 'v1alpha1',
      kind: 'ConfigMap',
      metadata: { name: 'cover-generator-configmap' },
      data,
    },
    // axios 其余响应字段(status/headers/config 等)与本测试无关,以类型断言收敛
  } as unknown as Awaited<ReturnType<typeof axiosInstance.get>>
}

const FULL_FORM = {
  watermark: 'example.com',
  logoUrl: 'https://cdn.example.com/logo.png',
  fontUrl: 'https://cdn.example.com/font.woff2',
  attachmentPolicy: 'my-policy',
  attachmentGroup: 'my-group',
}

afterEach(() => {
  mockedGet.mockReset()
  vi.restoreAllMocks()
})

describe('fetchPluginSettings', () => {
  it('请求插件 ConfigMap 专属路径(core 扩展位于 /api 前缀)', async () => {
    mockedGet.mockResolvedValue(configMapResponse({}))
    await fetchPluginSettings()
    expect(mockedGet).toHaveBeenCalledWith('/api/v1alpha1/configmaps/cover-generator-configmap')
  })

  it('data.base 表单值全字段存在且为非空字符串时原样映射', async () => {
    mockedGet.mockResolvedValue(configMapResponse(FULL_FORM))
    await expect(fetchPluginSettings()).resolves.toEqual(FULL_FORM)
  })

  it('字段缺失或为空串时逐字段回退默认值', async () => {
    mockedGet.mockResolvedValue(
      configMapResponse({
        watermark: 'kept.com',
        logoUrl: '',
        attachmentGroup: 'kept-group',
        // fontUrl / attachmentPolicy 整个缺失
      }),
    )
    await expect(fetchPluginSettings()).resolves.toEqual({
      watermark: 'kept.com',
      logoUrl: '',
      fontUrl: '',
      attachmentPolicy: '',
      attachmentGroup: 'kept-group',
    })
  })

  it('表单值为非字符串(脏数据)时视为缺失并取默认值', async () => {
    mockedGet.mockResolvedValue(
      configMapResponse({
        watermark: 42,
        attachmentPolicy: { name: 'p' },
        logoUrl: ['https://x/y.png'],
      }),
    )
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)
  })

  it('data.base 缺失或为非法 JSON 时静默回退全默认值', async () => {
    mockedGet.mockResolvedValue(configMapResponse())
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)

    mockedGet.mockResolvedValue(configMapResponse('{oops')) // 损坏的 JSON 串
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('data 整体缺失时回退全默认值', async () => {
    mockedGet.mockResolvedValue(configMapResponse())
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)
  })

  it('请求失败(403)时静默回退全默认值且不向调用方抛错', async () => {
    mockedGet.mockRejectedValue(new Error('Request failed with status code 403'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('usePluginSettings 与 fetchPluginSettings 行为一致(工作台沿用导入路径)', async () => {
    mockedGet.mockResolvedValue(configMapResponse({ watermark: 'alias.com' }))
    await expect(usePluginSettings()).resolves.toEqual({ ...DEFAULTS, watermark: 'alias.com' })
  })
})

describe('pluginSettingsDegraded(设置降级显式信号,评审 M6)', () => {
  /** 带 response.status 的 axios 错误形态 */
  function axiosErrorWithStatus(status: number) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status },
    })
  }

  afterEach(() => { pluginSettingsDegraded.value = false })

  it('403(配置存在但无权读)时置降级信号', async () => {
    mockedGet.mockRejectedValue(axiosErrorWithStatus(403))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)
    expect(pluginSettingsDegraded.value).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('网络层错误(无 response.status)时置降级信号', async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fetchPluginSettings()
    expect(pluginSettingsDegraded.value).toBe(true)
  })

  it('404(首次安装 ConfigMap 尚未初始化)不置信号:默认值即真相', async () => {
    mockedGet.mockRejectedValue(axiosErrorWithStatus(404))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchPluginSettings()).resolves.toEqual(DEFAULTS)
    expect(pluginSettingsDegraded.value).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('表单值为损坏 JSON(已配置但读不出)时置降级信号', async () => {
    mockedGet.mockResolvedValue(configMapResponse('{oops'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fetchPluginSettings()
    expect(pluginSettingsDegraded.value).toBe(true)
  })

  it('成功读取(含从未配置的空 ConfigMap)信号为 false', async () => {
    mockedGet.mockResolvedValue(configMapResponse())
    await fetchPluginSettings()
    expect(pluginSettingsDegraded.value).toBe(false)

    mockedGet.mockResolvedValue(configMapResponse(FULL_FORM))
    await fetchPluginSettings()
    expect(pluginSettingsDegraded.value).toBe(false)
  })

  it('此前降级、随后读取成功时信号复位为 false', async () => {
    pluginSettingsDegraded.value = true
    mockedGet.mockResolvedValue(configMapResponse(FULL_FORM))
    await expect(fetchPluginSettings()).resolves.toEqual(FULL_FORM)
    expect(pluginSettingsDegraded.value).toBe(false)
  })
})
