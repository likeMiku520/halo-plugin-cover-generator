import { axiosInstance } from '@halo-dev/api-client'
import type { PluginSettings } from '../composables/usePluginSettings'

/**
 * Console 附件上传端点(spike 实测 2026-09-06,haloServer 2.26):
 * POST multipart/form-data,字段 file / policyName / groupName,
 * 与 @halo-dev/api-client 的 uploadAttachment 生成代码一致。
 */
const ATTACHMENT_UPLOAD_PATH = '/apis/api.console.halo.run/v1alpha1/attachments/upload'

/**
 * 附件分组(Group 扩展)端点(spike 实测):
 * GET /{name} 存在性检查(200/404),POST 创建(201);
 * 重复创建实测返回 HTTP 400 + title「Duplicate Name Error」(并非 409)。
 * Console 风格的 /attachments/-/group 路径实测 404 不存在。 */
const GROUP_BASE_PATH = '/apis/storage.halo.run/v1alpha1/groups'

/** 附件响应中承载访问链接的两个实测位置(按优先级):
 * 1) status.permalink —— Console 写入文章 cover 字段的同款值(本地存储为相对路径);
 * 2) metadata.annotations['storage.halo.run/uri'] —— 本地存储备用访问路径 */
interface AttachmentLike {
  status?: { permalink?: string }
  metadata?: { annotations?: Record<string, string> }
}

/** RFC-7807 ProblemDetail(实测 404/400 形态:detail/title/status/type) */
interface ProblemLike {
  response?: { status?: number; data?: { detail?: string; title?: string } }
}

function statusOf(e: unknown): number | undefined {
  return (e as ProblemLike | null)?.response?.status
}

/** 服务端可读原因:优先 detail,退而 title,均无则空串 */
function detailOf(e: unknown): string {
  const data = (e as ProblemLike | null)?.response?.data
  return data?.detail || data?.title || ''
}

/** 错误信息中文化:优先透传服务端 detail,无响应体时给兜底文案 */
function toUploadErrorMessage(e: unknown): string {
  const reason = detailOf(e)
  return reason ? `上传附件失败:${reason}` : '上传附件失败,请检查附件策略与分组设置或稍后重试'
}

/** 实测的重复名竞态:409(通用约定)或 400 +「Duplicate Name Error」(haloServer 实测) */
function isDuplicateGroupError(e: unknown): boolean {
  if (statusOf(e) === 409) return true
  return /duplicate/i.test(detailOf(e))
}

/** 实测形态:上传携带的 groupName 在库中不存在时,服务端的失败原因含 group/分组字样 */
function isMissingGroupError(e: unknown): boolean {
  return /group/i.test(detailOf(e))
}

/** 按资源名创建附件分组;并发撞名视为已存在 */
async function createAttachmentGroup(name: string): Promise<void> {
  try {
    await axiosInstance.post(GROUP_BASE_PATH, {
      apiVersion: 'storage.halo.run/v1alpha1',
      kind: 'Group',
      metadata: { name },
      spec: { displayName: name },
    })
  } catch (e) {
    if (isDuplicateGroupError(e)) return // 并发竞态:已被(其他请求)创建,视为成功
    throw new Error(`创建附件分组「${name}」失败:${detailOf(e) || '请稍后重试'}`)
  }
}

/**
 * 上传封面 PNG 到 Halo 附件库,返回 Console 会写入文章 cover 的附件链接
 * (status.permalink)。
 *
 * 分组处理策略(实机反馈后重写):此前无论分组是否存在都先发一次
 * GET /groups/{name} 预检查,该预检查在分组名合法时也可能返回 5xx/403,
 * 于是把一次本可成功的上传判成失败,并给出与真相错位的「检查附件分组失败」。
 * 现在改为「先直接上传」:只有上传因分组缺失而失败时才创建分组并重试一次,
 * 语义与「分组按需创建」的承诺一致,且少一次请求。
 */
export async function uploadCoverPng(
  pngBlob: Blob,
  filename: string,
  s: PluginSettings,
): Promise<{ permalink: string }> {
  const file = new File([pngBlob], filename, { type: 'image/png' })
  const form = new FormData()
  form.append('file', file)
  // 空串表示交由 Halo 决定默认策略,不传空字段(空 policyName 会被服务端判为非法)
  if (s.attachmentPolicy) form.append('policyName', s.attachmentPolicy)
  form.append('groupName', s.attachmentGroup)

  const attempt = async (): Promise<AttachmentLike> => {
    const { data } = await axiosInstance.post(ATTACHMENT_UPLOAD_PATH, form)
    return data as AttachmentLike
  }

  let attachment: AttachmentLike
  try {
    attachment = await attempt()
  } catch (e) {
    if (!s.attachmentGroup || !isMissingGroupError(e)) throw new Error(toUploadErrorMessage(e))
    await createAttachmentGroup(s.attachmentGroup)
    try {
      attachment = await attempt()
    } catch (retryError) {
      throw new Error(toUploadErrorMessage(retryError))
    }
  }
  const permalink =
    attachment.status?.permalink ?? attachment.metadata?.annotations?.['storage.halo.run/uri']
  if (!permalink) throw new Error('上传成功但未获取到附件链接')
  return { permalink }
}

/** 文章选择器数据源:检索结果摘要(metadata.name 供绑定,spec.title 供展示) */
export interface PostSummary {
  name: string
  title: string
}

/**
 * Console 文章列表端点(spike 实测 2026-09-06,haloServer 2.26):
 * GET /apis/api.console.halo.run/v1alpha1/posts?keyword=&size=10,
 * keyword 匹配标题(服务端行为),响应为 ListedPostList(items[].post 为完整 Post)。
 */
const POST_LIST_PATH = '/apis/api.console.halo.run/v1alpha1/posts'

/** 文章读写走 core 扩展端点(spike 实测:GET/PUT /apis/content.halo.run/v1alpha1/posts/{name}) */
const POST_BASE_PATH = '/apis/content.halo.run/v1alpha1/posts'

/** 绑定封面写失败的中文化(优先透传服务端 detail,如实测 409 的「Conflict detected...」) */
function toBindCoverErrorMessage(e: unknown): string {
  const reason = detailOf(e)
  return reason ? `绑定文章封面失败:${reason}` : '绑定文章封面失败,请稍后重试'
}

/** 文章检索失败的中文化(与上传/绑定同一 detail → title → 兜底三级取值) */
function toSearchPostsErrorMessage(e: unknown): string {
  const reason = detailOf(e)
  return reason ? `搜索文章失败:${reason}` : '搜索文章失败,请稍后重试'
}

/** Post 资源中取完整 JSON 的最小形状(读取后仅改 spec.cover 回写) */
type PostLike = {
  metadata: { version: number }
  spec: { cover?: string }
}

/**
 * 按标题关键字检索文章,返回前 10 条 {name,title} 供选择器展示。
 * 失败以带中文 message 的 Error 向调用方抛出,由界面负责提示。
 */
export async function searchPosts(keyword: string): Promise<PostSummary[]> {
  let items: {
    post?: { metadata?: { name?: string }; spec?: { title?: string } }
  }[]
  try {
    const { data } = await axiosInstance.get(POST_LIST_PATH, {
      params: { keyword, size: 10 },
    })
    items = (data as { items?: typeof items })?.items ?? []
  } catch (e) {
    throw new Error(toSearchPostsErrorMessage(e))
  }
  return items
    .map((item) => ({
      name: item.post?.metadata?.name ?? '',
      title: item.post?.spec?.title ?? '',
    }))
    .filter((s) => s.name !== '')
    // Halo 的 keyword 会在标题之外的摘要/别名/标签/正文等字段命中(实机实测:
    // 搜「未」会带回标题不含「未」的文章)。选择器承诺的是按标题检索,此处按
    // 标题包含二次过滤,保证结果与占位符承诺一致;大小写不敏感(评审实机反馈)
    .filter((s) => s.title.toLowerCase().includes(keyword.toLowerCase()))
    .slice(0, 10)
}

/**
 * 把某篇文章的 Post.spec.cover 更新为 coverUrl(即刚上传附件的 permalink):
 * 先 GET 最新资源取得乐观锁 metadata.version,再 PUT 完整资源;
 * 版本冲突(实测 HTTP 409)自动重取重试恰一次,仍冲突则抛中文错误。
 */
export async function updatePostCover(postName: string, coverUrl: string): Promise<void> {
  const path = `${POST_BASE_PATH}/${encodeURIComponent(postName)}`
  let post: PostLike
  try {
    const { data } = await axiosInstance.get(path)
    post = data as PostLike
  } catch (e) {
    throw new Error(toBindCoverErrorMessage(e))
  }
  const body = (p: PostLike) => ({
    ...(p as unknown as Record<string, unknown>),
    spec: { ...(p as { spec?: object }).spec, cover: coverUrl },
  })
  try {
    await axiosInstance.put(path, body(post))
    return
  } catch (e) {
    if (statusOf(e) !== 409) throw new Error(toBindCoverErrorMessage(e))
  }
  // 实测 409(乐观锁过期):重取最新版本后重试恰一次
  try {
    const { data } = await axiosInstance.get(path)
    post = data as PostLike
  } catch (e) {
    throw new Error(toBindCoverErrorMessage(e))
  }
  try {
    await axiosInstance.put(path, body(post))
  } catch (e) {
    throw new Error(toBindCoverErrorMessage(e))
  }
}

/** 附件选择器的一条候选:link 为可直接取图的地址 */
export interface AttachmentSummary {
  name: string
  displayName: string
  /** status.permalink:Console 写入文章 cover 的同款公开地址 */
  link: string
  /** 缩略图地址;无缩略图服务时为空串,由调用方退回 link */
  thumb: string
}

/** 附件列表的一页:hasNext 供「加载更多」,total 供空态与计数 */
export interface AttachmentPage {
  items: AttachmentSummary[]
  total: number
  hasNext: boolean
}

/**
 * Console 附件检索端点(GET /apis/api.console.halo.run/v1alpha1/attachments):
 * 与上传、文章检索同作用域同会话鉴权,accepts 按媒体类型过滤,只列图片。
 * permalink 沿用上传路径的取值链(status.permalink)。
 */
const ATTACHMENT_LIST_PATH = '/apis/api.console.halo.run/v1alpha1/attachments'

/** 附件检索失败的中文化(与上传/绑定/文章检索同一 detail → title → 兜底三级取值) */
function toListAttachmentsErrorMessage(e: unknown): string {
  const reason = detailOf(e)
  return reason ? `读取附件库失败:${reason}` : '读取附件库失败,请稍后重试'
}

/** 列表项中取展示与取图所需字段的最小形状 */
interface AttachmentItemLike {
  metadata?: { name?: string }
  spec?: { displayName?: string }
  status?: { permalink?: string; thumbnails?: Record<string, string> }
}

/**
 * 检索图片附件。accepts 用 image/* 交给服务端过滤,客户端再按 mediaType 无关字段
 * 兜底——permalink 缺失的条目(对象存储未回填等)无法取图,直接从候选里剔除,
 * 否则选择器会出现点不动的空格子。
 */
export async function listImageAttachments(
  keyword: string,
  page: number,
  size: number,
): Promise<AttachmentPage> {
  let data: { items?: AttachmentItemLike[]; total?: number; hasNext?: boolean }
  try {
    const res = await axiosInstance.get(ATTACHMENT_LIST_PATH, {
      params: { page, size, keyword, accepts: ['image/*'] },
    })
    data = (res.data ?? {}) as typeof data
  } catch (e) {
    throw new Error(toListAttachmentsErrorMessage(e))
  }
  const items = (data.items ?? [])
    .map((item) => {
      const thumbs = item.status?.thumbnails ?? {}
      return {
        name: item.metadata?.name ?? '',
        displayName: item.spec?.displayName || item.metadata?.name || '',
        link: item.status?.permalink ?? '',
        thumb: thumbs.S ?? thumbs.M ?? Object.values(thumbs)[0] ?? '',
      }
    })
    .filter((a) => a.link !== '')
  return { items, total: data.total ?? items.length, hasNext: Boolean(data.hasNext) }
}
