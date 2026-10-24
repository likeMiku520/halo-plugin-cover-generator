export type MeasureText = (text: string, fontSize: number) => number

/**
 * 字号自适应：从基准字号开始，超宽时按宽度比例缩小；
 * 缩到下限仍超宽则取下限并标记 fits=false（由调用方水平压缩兜底）。
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  opts: { base: number; min: number },
  measure: MeasureText,
): { fontSize: number; fits: boolean } {
  const measured = measure(text, opts.base)
  if (measured <= maxWidth) return { fontSize: opts.base, fits: true }
  const scaled = Math.floor((opts.base * maxWidth) / measured)
  if (scaled >= opts.min) return { fontSize: scaled, fits: true }
  return { fontSize: opts.min, fits: false }
}
