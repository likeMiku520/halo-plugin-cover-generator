import { afterEach, describe, expect, it, vi } from 'vitest'
import { axiosInstance } from '@halo-dev/api-client'
import { listImageAttachments, searchPosts, updatePostCover, uploadCoverPng } from './haloClient'
import type { PluginSettings } from '../composables/usePluginSettings'

/** 设置仅提供策略/分组两个上传参数,其余字段与本测试无关 */
const SETTINGS: PluginSettings = {
  watermark: '',
  logoUrl: '',
  fontUrl: '',
  attachmentPolicy: 'default-policy',
  attachmentGroup: 'cover-generator',
}

// 与代码保持同一访问方式:复用 Halo 的 axiosInstance(Console HTTP 客户端)
vi.mock('@halo-dev/api-client', () => ({
  axiosInstance: {
    get: vi.fn<(url: string) => Promise<unknown>>(),
    post: vi.fn<(url: string, data: unknown) => Promise<unknown>>(),
    put: vi.fn<(url: string, data: unknown) => Promise<unknown>>(),
  },
}))

const mockedPost = vi.mocked(axiosInstance.post)
const mockedGet = vi.mocked(axiosInstance.get)
const mockedPut = vi.mocked(axiosInstance.put)

/**
 * 完整还原 2026-09-06 对真实 haloServer 的 spike 响应
 * (POST /apis/api.console.halo.run/v1alpha1/attachments/upload,HTTP 200):
 * permalink 位于 status.permalink,本地存储为相对路径;
 * 备用访问路径在 metadata.annotations['storage.halo.run/uri']。
 */
const MEASURED_ATTACHMENT = {
  apiVersion: 'storage.halo.run/v1alpha1',
  kind: 'Attachment',
  metadata: {
    annotations: {
      'storage.halo.run/local-relative-path': 'upload/我的标题-cover.png',
      'storage.halo.run/uri': '/upload/我的标题-cover.png',
    },
    creationTimestamp: '2026-09-06T12:01:08.791836866Z',
    name: 'c06e23f6-74ad-454a-aab6-fd2e375af653',
    version: 0,
  },
  spec: {
    displayName: '我的标题-cover.png',
    groupName: 'cover-generator',
    mediaType: 'image/png',
    ownerName: 'admin',
    policyName: 'default-policy',
    size: 70,
  },
  status: {
    permalink: '/upload/我的标题-cover.png',
    thumbnails: {
      S: '/upload/我的标题-cover.png?width=400',
      XL: '/upload/我的标题-cover.png?width=1600',
      L: '/upload/我的标题-cover.png?width=1200',
      M: '/upload/我的标题-cover.png?width=800',
    },
  },
}

/** spike 实测失败响应:HTTP 404 + RFC-7807 ProblemDetail(策略/分组不存在时同型) */
const MEASURED_PROBLEM_DETAIL = {
  detail: 'Extension storage.halo.run/v1alpha1/Policy/nonexistent-policy was not found.',
  instance: 'http://localhost:8090/apis/api.console.halo.run/v1alpha1/attachments/upload',
  status: 404,
  title: 'Not Found',
  type: 'https://www.halo.run/api/errors/extension-not-found',
  requestId: 'f1b6da09-10',
  timestamp: '2026-09-06T11:59:33.559896900Z',
}

function okResponse(attachment: unknown) {
  return { data: attachment } as unknown as Awaited<ReturnType<typeof axiosInstance.post>>
}

/** axios 抛错形态:Error 上挂 response(spike 的 404 即此形态) */
function axiosError(status: number, body: unknown) {
  const e = new Error(`Request failed with status code ${status}`) as Error & {
    response?: { status: number; data: unknown }
  }
  e.response = { status, data: body }
  return e
}

/** spike 实测:附件分组 GET 命中(200)返回的 Group 资源 */
const MEASURED_GROUP = {
  spec: { displayName: 'cover-generator' },
  apiVersion: 'storage.halo.run/v1alpha1',
  kind: 'Group',
  metadata: { name: 'cover-generator', creationTimestamp: '2026-09-06T12:31:27.684246371Z', version: 0 },
}

/** spike 实测:分组缺失时 GET 的 404 ProblemDetail */
const MEASURED_GROUP_MISSING = {
  detail: 'Extension storage.halo.run/v1alpha1/Group/cover-generator was not found.',
  instance: 'http://localhost:8090/apis/storage.halo.run/v1alpha1/groups/cover-generator',
  status: 404,
  title: 'Not Found',
  type: 'https://www.halo.run/api/errors/extension-not-found',
  requestId: 'c738bec3-7',
  timestamp: '2026-09-06T12:31:14.941930587Z',
}

/** spike 实测:重复创建分组的 400 ProblemDetail(注意是 400 而非 409) */
const MEASURED_GROUP_DUPLICATE = {
  detail: 'Duplicate name detected, please rename it and retry.',
  instance: 'http://localhost:8090/apis/storage.halo.run/v1alpha1/groups',
  status: 400,
  title: 'Duplicate Name Error',
  type: 'https://www.halo.run/api/errors/duplicate-name',
  requestId: '2869d480-11',
  timestamp: '2026-09-06T12:31:27.787236592Z',
}

/** spike 实测:创建分组成功(201)返回的 Group 资源 */
function createdGroup() {
  return { data: MEASURED_GROUP } as unknown as Awaited<ReturnType<typeof axiosInstance.post>>
}

afterEach(() => {
  mockedPost.mockReset()
  mockedGet.mockReset()
  mockedPut.mockReset()
})

describe('uploadCoverPng', () => {
  it('POST Console 附件上传端点,multipart 携带 file/policyName/groupName(spike 实测形态)', async () => {
    mockedPost.mockResolvedValue(okResponse(MEASURED_ATTACHMENT))
    const blob = new Blob(['png-bytes'], { type: 'image/png' })
    await uploadCoverPng(blob, '我的标题-cover.png', SETTINGS)

    expect(mockedPost).toHaveBeenCalledOnce()
    const [url, data] = mockedPost.mock.calls[0]
    expect(url).toBe('/apis/api.console.halo.run/v1alpha1/attachments/upload')
    expect(data).toBeInstanceOf(FormData)
    const form = data as FormData
    // 端点与参数名以 api-client uploadAttachment 生成代码为准(spike 逐字段验证)
    expect(form.get('policyName')).toBe('default-policy')
    expect(form.get('groupName')).toBe('cover-generator')
    const file = form.get('file')
    expect(file).toBeInstanceOf(File)
    expect((file as File).type).toBe('image/png')
  })

  it('文件名透传到 multipart 的 file 部分(附件 displayName 由此而来)', async () => {
    mockedPost.mockResolvedValue(okResponse(MEASURED_ATTACHMENT))
    await uploadCoverPng(new Blob(['x'], { type: 'image/png' }), '测试-cover.png', SETTINGS)

    const form = mockedPost.mock.calls[0][1] as FormData
    expect((form.get('file') as File).name).toBe('测试-cover.png')
  })

  it('从实测字段 status.permalink 提取链接返回', async () => {
    mockedPost.mockResolvedValue(okResponse(MEASURED_ATTACHMENT))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).resolves.toEqual({ permalink: '/upload/我的标题-cover.png' })
  })

  it('status 缺失时回退实测备用路径 metadata.annotations[storage.halo.run/uri]', async () => {
    const { status, ...noStatus } = MEASURED_ATTACHMENT
    void status
    mockedPost.mockResolvedValue(okResponse(noStatus))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).resolves.toEqual({ permalink: '/upload/我的标题-cover.png' })
  })

  it('上传失败(spike 实测 404 ProblemDetail)时抛出含服务端 detail 的中文错误', async () => {
    mockedPost.mockRejectedValue(axiosError(404, MEASURED_PROBLEM_DETAIL))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).rejects.toThrow('上传附件失败')
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).rejects.toThrow('nonexistent-policy was not found')
  })

  it('无响应体(网络断开等)时抛出纯中文兜底错误而非裸 axios 错误', async () => {
    mockedPost.mockRejectedValue(new Error('Network Error'))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).rejects.toThrow('上传附件失败')
  })

  it('上传成功但响应中无任何链接字段时给出中文错误(不返回空链接)', async () => {
    mockedPost.mockResolvedValue(
      okResponse({ apiVersion: 'storage.halo.run/v1alpha1', kind: 'Attachment', metadata: {}, spec: {} }),
    )
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).rejects.toThrow('附件链接')
  })
})

describe('uploadCoverPng 的附件分组按需创建', () => {
  it('直接上传成功时不发起任何分组请求(不再预检查,消除 5xx 误判)', async () => {
    mockedPost.mockResolvedValue(okResponse(MEASURED_ATTACHMENT))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).resolves.toEqual({ permalink: '/upload/我的标题-cover.png' })

    expect(mockedGet).not.toHaveBeenCalled()
    expect(mockedPost).toHaveBeenCalledOnce()
    expect(mockedPost.mock.calls[0][0]).toBe('/apis/api.console.halo.run/v1alpha1/attachments/upload')
  })

  it('上传因分组缺失失败时按实测契约创建分组,再重试上传一次', async () => {
    mockedPost
      .mockRejectedValueOnce(axiosError(404, MEASURED_GROUP_MISSING)) // 上传:分组不存在
      .mockResolvedValueOnce(createdGroup()) // 创建分组 201
      .mockResolvedValueOnce(okResponse(MEASURED_ATTACHMENT)) // 重试上传 200
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).resolves.toEqual({ permalink: '/upload/我的标题-cover.png' })

    expect(mockedPost).toHaveBeenCalledTimes(3)
    const [createPath, createBody] = mockedPost.mock.calls[1]
    expect(createPath).toBe('/apis/storage.halo.run/v1alpha1/groups')
    // 实测请求体形状(JSON,api-client createGroup 同型)
    expect(createBody).toEqual({
      apiVersion: 'storage.halo.run/v1alpha1',
      kind: 'Group',
      metadata: { name: 'cover-generator' },
      spec: { displayName: 'cover-generator' },
    })
    expect(mockedPost.mock.calls[2][0]).toBe('/apis/api.console.halo.run/v1alpha1/attachments/upload')
  })

  it('创建分组撞上重复名竞态(实测 400 Duplicate Name Error)时静默容忍并继续重试上传', async () => {
    mockedPost
      .mockRejectedValueOnce(axiosError(404, MEASURED_GROUP_MISSING))
      .mockRejectedValueOnce(axiosError(400, MEASURED_GROUP_DUPLICATE)) // 并发下已被创建
      .mockResolvedValueOnce(okResponse(MEASURED_ATTACHMENT))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).resolves.toEqual({ permalink: '/upload/我的标题-cover.png' })
    expect(mockedPost).toHaveBeenCalledTimes(3)
  })

  it('创建分组被服务端拒绝(非重复)时中止,抛出含分组名与 detail 的中文错误', async () => {
    mockedPost
      .mockRejectedValueOnce(axiosError(404, MEASURED_GROUP_MISSING))
      .mockRejectedValueOnce(
        axiosError(403, {
          detail: 'You do not have permission to create Group resources.',
          status: 403,
          title: 'Forbidden',
        }),
      )
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', SETTINGS),
    ).rejects.toThrow('创建附件分组「cover-generator」失败')
  })

  it('未配置分组时不尝试创建,原样抛出上传错误', async () => {
    mockedPost.mockRejectedValue(axiosError(500, { detail: '服务器内部发生错误', status: 500 }))
    await expect(
      uploadCoverPng(new Blob(['x'], { type: 'image/png' }), 'a.png', { ...SETTINGS, attachmentGroup: '' }),
    ).rejects.toThrow('上传附件失败:服务器内部发生错误')
    expect(mockedPost).toHaveBeenCalledOnce()
  })
})

/**
 * 完整还原 2026-09-06 对真实 haloServer 的 spike 响应
 * (GET /apis/content.halo.run/v1alpha1/posts/{name},HTTP 200):
 * Post 资源全形,乐观锁位于 metadata.version,封面字段为 spec.cover。
 */
const MEASURED_POST = {
  apiVersion: 'content.halo.run/v1alpha1',
  kind: 'Post',
  metadata: {
    annotations: {
      'content.halo.run/permalink-pattern': '/archives/{slug}',
      'content.halo.run/last-released-snapshot': 'fb5cd6bd-998d-4ccc-984d-5cc23b0a09f9',
      'checksum/config': 'c26e2f3f67d135d1f09ece2a29046c5761a5bad219738bdf2d46e8fe8e922dd5',
      'content.halo.run/last-associated-categories': '["76514a40-6ef1-4ed9-b58a-e26945bde3ca"]',
      'content.halo.run/last-associated-tags': '["c33ceabb-d8f1-4711-8991-bb8f5c92ad7c"]',
    },
    creationTimestamp: '2026-09-06T09:32:48.619915134Z',
    finalizers: ['post-protection'],
    labels: {
      'content.halo.run/archive-year': '2026',
      'content.halo.run/archive-day': '06',
      'content.halo.run/archive-month': '09',
      'content.halo.run/published': 'true',
      'content.halo.run/deleted': 'false',
      'content.halo.run/owner': 'admin',
      'content.halo.run/visible': 'PUBLIC',
    },
    name: '5152aea5-c2e8-4717-8bba-2263d46e19d5',
    version: 4,
  },
  spec: {
    allowComment: true,
    baseSnapshot: 'fb5cd6bd-998d-4ccc-984d-5cc23b0a09f9',
    categories: ['76514a40-6ef1-4ed9-b58a-e26945bde3ca'],
    cover: '',
    deleted: false,
    excerpt: {
      autoGenerate: false,
      raw: '如果你看到了这一篇文章,那么证明你已经安装成功了,感谢使用 Halo 进行创作,希望能够使用愉快。',
    },
    headSnapshot: 'fb5cd6bd-998d-4ccc-984d-5cc23b0a09f9',
    htmlMetas: [],
    owner: 'admin',
    pinned: false,
    priority: 0,
    publish: true,
    publishTime: '2026-09-06T09:32:48.297126700Z',
    releaseSnapshot: 'fb5cd6bd-998d-4ccc-984d-5cc23b0a09f9',
    slug: 'hello-halo',
    tags: ['c33ceabb-d8f1-4711-8991-bb8f5c92ad7c'],
    template: '',
    title: 'Hello halo',
    visible: 'PUBLIC',
  },
  status: {
    conditions: [
      {
        lastTransitionTime: '2026-09-06T09:32:48.688582489Z',
        message: 'Post published successfully.',
        reason: 'Published',
        status: 'TRUE',
        type: 'PUBLISHED',
      },
    ],
    contributors: ['admin'],
    excerpt: '如果你看到了这一篇文章,那么证明你已经安装成功了,感谢使用 Halo 进行创作,希望能够使用愉快。',
    hideFromList: false,
    inProgress: false,
    lastModifyTime: '2026-09-06T09:32:48.297126700Z',
    observedVersion: 4,
    permalink: '/archives/hello-halo',
    phase: 'PUBLISHED',
  },
}

/** spike 实测:携带过期 metadata.version 的 PUT 返回 HTTP 409 + 此 ProblemDetail */
const MEASURED_POST_CONFLICT = {
  detail: 'Conflict detected, please check the data and retry.',
  instance: 'http://localhost:8090/apis/content.halo.run/v1alpha1/posts/5152aea5-c2e8-4717-8bba-2263d46e19d5',
  status: 409,
  title: 'Conflict',
  type: 'https://halo.run/probs/conflict',
  requestId: '26494087-13',
  timestamp: '2026-09-06T12:50:07.682799781Z',
}

/** spike 实测的 Console 文章列表项形状(ListedPost:聚合了 owner/stats 与内嵌完整 Post) */
function measuredListedItem(name: string, title: string) {
  return {
    categories: [],
    contributors: [{ displayName: 'Administrator', name: 'admin' }],
    owner: { displayName: 'Administrator', name: 'admin' },
    post: {
      ...MEASURED_POST,
      metadata: { ...MEASURED_POST.metadata, name },
      spec: { ...MEASURED_POST.spec, title },
    },
    stats: { visit: 0, upvote: 0, totalComment: 0, approvedComment: 0 },
    tags: [],
  }
}

function getResponse(body: unknown) {
  return { data: body } as unknown as Awaited<ReturnType<typeof axiosInstance.get>>
}

function clonePost() {
  return JSON.parse(JSON.stringify(MEASURED_POST)) as typeof MEASURED_POST
}

describe('searchPosts', () => {
  it('GET Console 文章列表端点,以 keyword/size=10 查询(spike 实测参数名)', async () => {
    mockedGet.mockResolvedValue(getResponse({ items: [measuredListedItem('p1', '标题一')], total: 1 }))
    await searchPosts('Hello')

    expect(mockedGet).toHaveBeenCalledOnce()
    const [url, config] = mockedGet.mock.calls[0]
    expect(url).toBe('/apis/api.console.halo.run/v1alpha1/posts')
    expect(config).toEqual({ params: { keyword: 'Hello', size: 10 } })
  })

  it('按标题包含过滤:Halo keyword 会命中正文/摘要等字段,非标题命中的结果被剔除(实机反馈)', async () => {
    mockedGet.mockResolvedValue(
      getResponse({
        items: [
          measuredListedItem('post-a', '未命名文章'),
          measuredListedItem('post-b', '近日杂感'), // 标题不含「未」,仅正文/摘要命中
          measuredListedItem('post-c', '未竟之书'),
        ],
        total: 3,
      }),
    )
    await expect(searchPosts('未')).resolves.toEqual([
      { name: 'post-a', title: '未命名文章' },
      { name: 'post-c', title: '未竟之书' },
    ])
  })

  it('标题过滤不区分大小写(Halo 对英文标题的大小写命中不被客户端误杀)', async () => {
    mockedGet.mockResolvedValue(
      getResponse({ items: [measuredListedItem('post-h', 'Hello Halo')], total: 1 }),
    )
    await expect(searchPosts('hello')).resolves.toEqual([{ name: 'post-h', title: 'Hello Halo' }])
  })

  it('映射 items[].post 为 {name,title}(name 取 metadata.name,title 取 spec.title)', async () => {
    // 夹具标题均包含关键字:标题过滤生效后,仅正文命中的条目不会出现在结果里
    mockedGet.mockResolvedValue(
      getResponse({
        items: [
          measuredListedItem('post-a', '第一篇'),
          measuredListedItem('post-b', '第一篇(续)'),
        ],
        total: 2,
      }),
    )
    await expect(searchPosts('第一')).resolves.toEqual([
      { name: 'post-a', title: '第一篇' },
      { name: 'post-b', title: '第一篇(续)' },
    ])
  })

  it('结果截取前 10 条(列表返回 11 条时只取 10)', async () => {
    const items = Array.from({ length: 11 }, (_, i) => measuredListedItem(`post-${i}`, `标题${i}`))
    mockedGet.mockResolvedValue(getResponse({ items, total: 11 }))
    const result = await searchPosts('标题')
    expect(result).toHaveLength(10)
    expect(result[9]).toEqual({ name: 'post-9', title: '标题9' })
  })

  it('无匹配(实测 keyword 不命中返回空 items)时返回空数组', async () => {
    mockedGet.mockResolvedValue(getResponse({ items: [], total: 0 }))
    await expect(searchPosts('ZZZNOMATCH')).resolves.toEqual([])
  })

  it('检索失败(实测同型 ProblemDetail)时抛出含服务端 detail 的中文错误', async () => {
    mockedGet.mockRejectedValue(
      axiosError(403, { detail: 'You have no permission.', status: 403, title: 'Forbidden' }),
    )
    await expect(searchPosts('文章')).rejects.toThrow('搜索文章失败')
    await expect(searchPosts('文章')).rejects.toThrow('You have no permission.')
  })

  it('检索无响应体(网络断开等)时抛出纯中文兜底错误', async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'))
    await expect(searchPosts('文章')).rejects.toThrow('搜索文章失败')
  })
})

describe('updatePostCover', () => {
  it('GET 文章资源后置 spec.cover 并 PUT 原端点,请求体携带原 metadata.version(spike 实测路径)', async () => {
    const post = clonePost()
    mockedGet.mockResolvedValue(getResponse(post))
    mockedPut.mockResolvedValue(getResponse({ ...post, metadata: { ...post.metadata, version: 5 } }))
    await updatePostCover('5152aea5-c2e8-4717-8bba-2263d46e19d5', '/upload/标题-cover.png')

    const getPath = mockedGet.mock.calls[0][0]
    expect(getPath).toBe('/apis/content.halo.run/v1alpha1/posts/5152aea5-c2e8-4717-8bba-2263d46e19d5')
    expect(mockedPut).toHaveBeenCalledOnce()
    const [putUrl, putBody] = mockedPut.mock.calls[0]
    expect(putUrl).toBe(getPath)
    // PUT 的是完整 Post 资源:仅 cover 变化,乐观锁版本原样保留
    expect(putBody).toEqual({ ...post, spec: { ...post.spec, cover: '/upload/标题-cover.png' } })
    expect((putBody as typeof post).metadata.version).toBe(4)
  })

  it('首次 PUT 409(spike 实测冲突形态)→ 重取最新版本重试恰一次并成功', async () => {
    const stale = clonePost() // version 4
    const fresh = { ...clonePost(), metadata: { ...clonePost().metadata, version: 7 } }
    mockedGet
      .mockResolvedValueOnce(getResponse(stale)) // 首次读取
      .mockResolvedValueOnce(getResponse(fresh)) // 冲突后重取
    mockedPut
      .mockRejectedValueOnce(axiosError(409, MEASURED_POST_CONFLICT)) // 首次 PUT:过期版本
      .mockResolvedValueOnce(getResponse({ ...fresh, spec: { ...fresh.spec, cover: '/upload/c.png' } }))

    await expect(updatePostCover('5152aea5-c2e8-4717-8bba-2263d46e19d5', '/upload/c.png')).resolves.toBeUndefined()

    // 时序:get → put → get → put(重试恰一次,各两次)
    expect(mockedGet).toHaveBeenCalledTimes(2)
    expect(mockedPut).toHaveBeenCalledTimes(2)
    // 重试的 PUT 携带重取到的最新 version(7),而非首次的 4
    expect((mockedPut.mock.calls[1][1] as { metadata: { version: number } }).metadata.version).toBe(7)
    expect(mockedPut.mock.calls[1][0]).toBe(mockedPut.mock.calls[0][0])
  })

  it('两次 PUT 均 409 时抛出中文错误,且重试恰一次不再继续(get 2 次/put 2 次)', async () => {
    const post = clonePost()
    mockedGet.mockResolvedValue(getResponse(post))
    mockedPut.mockRejectedValue(axiosError(409, MEASURED_POST_CONFLICT))
    await expect(updatePostCover('5152aea5-c2e8-4717-8bba-2263d46e19d5', '/upload/c.png')).rejects.toThrow(
      '绑定文章封面失败',
    )
    expect(mockedGet).toHaveBeenCalledTimes(2)
    expect(mockedPut).toHaveBeenCalledTimes(2)
  })

  it('非冲突失败(如 404 文章不存在)不重试,直接抛出含服务端 detail 的中文错误', async () => {
    mockedGet.mockResolvedValue(getResponse(clonePost()))
    mockedPut.mockRejectedValue(
      axiosError(404, {
        detail: 'Post not found.',
        status: 404,
        title: 'Not Found',
        type: 'https://halo.run/probs/extension-not-found',
      }),
    )
    await expect(updatePostCover('gone', '/upload/c.png')).rejects.toThrow('Post not found.')
    expect(mockedPut).toHaveBeenCalledTimes(1)
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('读取文章本身失败(无响应体)时抛出中文错误而非裸 axios 错误', async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'))
    await expect(updatePostCover('gone', '/upload/c.png')).rejects.toThrow('绑定文章封面失败')
    expect(mockedPut).not.toHaveBeenCalled()
  })

  it('409 后重取 GET 失败:抛中文错误并终止,不再重试 PUT(评审M8 测试缺口)', async () => {
    const post = clonePost()
    mockedGet
      .mockResolvedValueOnce(getResponse(post)) // 首次读取成功
      .mockRejectedValueOnce(
        axiosError(500, { detail: 'Internal server error.', status: 500, title: 'Internal Server Error' }),
      ) // 冲突后重取失败
    mockedPut.mockRejectedValueOnce(axiosError(409, MEASURED_POST_CONFLICT)) // 首次 PUT 冲突

    await expect(updatePostCover('gone', '/upload/c.png')).rejects.toThrow('绑定文章封面失败')
    expect(mockedGet).toHaveBeenCalledTimes(2) // 首次 + 冲突后重取
    expect(mockedPut).toHaveBeenCalledTimes(1) // 重取失败即终止
  })
})

describe('listImageAttachments(博客附件选图)', () => {
  it('走 Console 附件端点:accepts 只要图片,keyword/page/size 原样透传', async () => {
    mockedGet.mockResolvedValue({ data: { items: [MEASURED_ATTACHMENT], total: 1, hasNext: false } })

    const result = await listImageAttachments('封面', 2, 24)

    expect(mockedGet).toHaveBeenCalledWith('/apis/api.console.halo.run/v1alpha1/attachments', {
      params: { page: 2, size: 24, keyword: '封面', accepts: ['image/*'] },
    })
    expect(result.items).toEqual([
      {
        name: MEASURED_ATTACHMENT.metadata.name,
        displayName: '我的标题-cover.png',
        link: '/upload/我的标题-cover.png',
        thumb: '/upload/我的标题-cover.png?width=400',
      },
    ])
    expect(result.total).toBe(1)
    expect(result.hasNext).toBe(false)
  })

  it('permalink 缺失的条目被剔除:取不到图的格子不该出现在选择器里', async () => {
    mockedGet.mockResolvedValue({
      data: {
        items: [{ metadata: { name: 'no-link' }, spec: { displayName: '无链接.png' } }, MEASURED_ATTACHMENT],
        total: 2,
        hasNext: false,
      },
    })

    const result = await listImageAttachments('', 1, 24)

    expect(result.items.map((a) => a.name)).toEqual([MEASURED_ATTACHMENT.metadata.name])
  })

  it('没有缩略图服务时 thumb 为空,由调用方回退原图', async () => {
    const onlyPermalink = {
      ...MEASURED_ATTACHMENT,
      status: { permalink: MEASURED_ATTACHMENT.status.permalink },
    }
    mockedGet.mockResolvedValue({ data: { items: [onlyPermalink], total: 1, hasNext: false } })

    const result = await listImageAttachments('', 1, 24)

    expect(result.items[0].thumb).toBe('')
    expect(result.items[0].link).toBe('/upload/我的标题-cover.png')
  })

  it('失败时抛出含服务端 detail 的中文错误', async () => {
    mockedGet.mockRejectedValue(
      axiosError(500, { detail: 'Internal server error.', status: 500, title: 'Internal Server Error' }),
    )
    await expect(listImageAttachments('', 1, 24)).rejects.toThrow('读取附件库失败:Internal server error.')
  })

  it('无响应体时给兜底中文文案,而不是裸 axios 错误', async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'))
    await expect(listImageAttachments('', 1, 24)).rejects.toThrow('读取附件库失败,请稍后重试')
  })
})
