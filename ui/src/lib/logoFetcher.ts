const MAX_BYTES = 2 * 1024 * 1024
// 公共图片代理（wsrv.nl）：主源因 CORS 失败时兜底，返回带 CORS 头的图片字节，无需本地进程
const FALLBACK_PROXY = 'https://wsrv.nl/?url='

/** 校验链接；返回 null 表示合法，否则返回中文错误原因 */
export function validateLogoUrl(url: string): string | null {
  const s = url.trim()
  if (!s) return '链接为空'
  if (!/^https?:\/\//i.test(s)) return '链接需以 http(s):// 开头'
  return null
}

/**
 * 拉取图片并转为 dataURL（导出 SVG 保持自包含，不写外链）。
 * 主源因 CORS 网络失败时自动回退公共图片代理；HTTP 层错误（404 等）不回退。
 * 回退发生前同步触发 onProxyFallback(评审 M3):代理会把原始 URL(可能含
 * 签名参数/防盗链 token/内网主机名)发送给第三方公共服务,调用方须向用户显式披露。
 */
export async function fetchLogoAsDataUrl(
  url: string,
  onProxyFallback?: () => void,
): Promise<string> {
  try {
    return await viaFetch(url)
  } catch (e) {
    // 仅网络层失败（CORS/断网，TypeError）值得尝试公共代理
    if (!(e instanceof TypeError)) throw e
    onProxyFallback?.()
    try {
      return await viaFetch(FALLBACK_PROXY + encodeURIComponent(url))
    } catch (proxyErr) {
      // 代理失败不吞原因(评审M6):HTTP 层失败(代理 5xx/代理拒绝目标)与再网络失败分开提示,
      // 否则用户看到的永远是 CORS 指引,与真相错位
      const status = proxyErr instanceof Error ? /HTTP \d+/.exec(proxyErr.message)?.[0] : null
      throw new Error(
        status
          ? `无法获取图片：代理服务${status}。可下载后本地上传`
          : '无法获取图片：图床不允许跨域（CORS），代理也不可用。可下载后本地上传，或在图床配置 CORS',
      )
    }
  }
}

async function viaFetch(url: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors' })
  } catch (e) {
    throw e instanceof TypeError ? e : new TypeError(String(e)) // 网络层失败统一为 TypeError
  }
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('链接内容不是图片（content-type 非 image/*）')
  if (blob.size > MAX_BYTES) throw new Error('图片超过 2MB 限制')
  return await new Promise<string>((ok, err) => {
    const reader = new FileReader()
    reader.onload = () => ok(String(reader.result))
    reader.onerror = () => err(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 把站内附件取回为 dataURL(导出 SVG 自包含,附件也必须内嵌)。
 *
 * 与 fetchLogoAsDataUrl 的唯一区别是**不做公共代理回退**:附件与 Console 同源,
 * 不存在跨域问题;把站内地址(可能含内网主机名或签名参数)交给第三方图片代理
 * 既无必要,也把内部信息外发了。
 */
export async function fetchAttachmentAsDataUrl(url: string): Promise<string> {
  return await viaFetch(url)
}
