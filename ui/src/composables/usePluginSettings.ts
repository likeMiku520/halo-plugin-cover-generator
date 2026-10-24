import { ref } from 'vue'
import { axiosInstance } from '@halo-dev/api-client'

/** 插件设置(Console ConfigMap)中工作台关心的字段 */
export interface PluginSettings {
  /** 封面默认水印;空串表示默认不显示 */
  watermark: string
  /** 默认 Logo 图片直链;空串表示无内置默认(Logo 默认隐藏) */
  logoUrl: string
  /** 默认字体资产直链;空串表示用内置字体 */
  fontUrl: string
  /** 导出封面保存为附件时的默认策略;空串 = 交由 Halo 使用默认策略 */
  attachmentPolicy: string
  /** 导出封面保存为附件时的默认分组;空串 = 不指定分组 */
  attachmentGroup: string
}

const DEFAULTS: PluginSettings = {
  watermark: '',
  logoUrl: '',
  fontUrl: '',
  // 旧版默认值 default-policy / cover-generator 是「假定存在」的资源名:
  // 实机既非默认策略名,分组也需自行创建。空串让上传只带一个明确的
  // policyName(仅当设置非空时),分组缺失则按需创建(见 api/haloClient.ts)
  attachmentPolicy: '',
  attachmentGroup: '',
}

/** plugin.yaml spec.configMapName 声明的 ConfigMap(Setting 首次启动时由 Halo 初始化) */
const CONFIG_MAP_PATH = '/api/v1alpha1/configmaps/cover-generator-configmap'

/** 设置表单组(setting.yaml 中的 group),表单值序列化后存于 ConfigMap data 该键下 */
const FORM_GROUP = 'base'

/**
 * 设置降级显式信号(评审 M6):true 表示「用户可能配置过,但本次读取失败被默认值顶替」。
 * 404(首次安装未初始化)与 ConfigMap 无表单组(从未配置)不置信号——此时默认值即真相,
 * 提示反而是噪音。模块级:ConfigMap 全局唯一,信号对所有调用点一致。
 */
export const pluginSettingsDegraded = ref(false)

/**
 * 提取单个字段:表单值均为字符串,
 * 缺失/空串/非字符串(脏数据)一律回退该字段默认值
 */
function pick(form: Record<string, unknown> | undefined, key: keyof PluginSettings): string {
  const v = form?.[key]
  return typeof v === 'string' && v !== '' ? v : DEFAULTS[key]
}

/** 从 ConfigMap 响应解析设置;返回 corrupt=表单组存在但损坏(已配置却读不出) */
function toSettings(configMap: unknown): { settings: PluginSettings; corrupt: boolean } {
  const data = (configMap as { data?: Record<string, unknown> } | undefined)?.data
  const raw = data?.[FORM_GROUP]
  if (typeof raw !== 'string') return { settings: { ...DEFAULTS }, corrupt: false }
  try {
    const form = JSON.parse(raw) as Record<string, unknown>
    return {
      settings: {
        watermark: pick(form, 'watermark'),
        logoUrl: pick(form, 'logoUrl'),
        fontUrl: pick(form, 'fontUrl'),
        attachmentPolicy: pick(form, 'attachmentPolicy'),
        attachmentGroup: pick(form, 'attachmentGroup'),
      },
      corrupt: false,
    }
  } catch (e) {
    console.warn('[cover-generator] 插件设置表单值损坏,已回退默认值', e)
    return { settings: { ...DEFAULTS }, corrupt: true }
  }
}

/**
 * 读取插件 ConfigMap 并映射为工作台设置。
 * 响应中表单值位于 data.base(JSON 串,见 setting.yaml 的 base 组)。
 * 任何请求失败(404/403/网络)都不向调用方抛错,回退全默认值;
 * 是否属于「用户配置被顶替」由 pluginSettingsDegraded 显式暴露(评审 M6)。
 */
export async function fetchPluginSettings(): Promise<PluginSettings> {
  try {
    const { data: configMap } = await axiosInstance.get(CONFIG_MAP_PATH)
    const { settings, corrupt } = toSettings(configMap)
    pluginSettingsDegraded.value = corrupt
    return settings
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    pluginSettingsDegraded.value = status !== 404
    console.warn('[cover-generator] 读取插件设置失败,已回退默认值', e)
    return { ...DEFAULTS }
  }
}

/** 工作台入口:沿用 Task 4 桩的导入路径,语义改为异步读取 Console 设置 */
export function usePluginSettings(): Promise<PluginSettings> {
  return fetchPluginSettings()
}
