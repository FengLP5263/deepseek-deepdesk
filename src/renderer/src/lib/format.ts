export function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return Math.floor(diff / minute) + ' 分钟前'
  if (diff < day) return Math.floor(diff / hour) + ' 小时前'
  if (diff < 7 * day) return Math.floor(diff / day) + ' 天前'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function formatTokens(n: number | undefined): string {
  if (n === undefined || n === null) return ''
  const scaled = (v: number): string => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1000) return String(n)
  if (n < 1000000) return scaled(n / 1000) + 'K'
  return scaled(n / 1000000) + 'M'
}

export function formatWorkdirName(workdir: string): string {
  const normalized = workdir.trim().replace(/[\\/]+$/, '')
  if (!normalized) return ''
  return normalized.split(/[\\/]+/).filter(Boolean).at(-1) ?? normalized
}
