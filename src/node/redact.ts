import { basename } from 'node:path'

export function redactSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  const pairs: Array<[string, string]> = []
  const ssh = env.ASSET_STORE_SSH
  if (ssh) {
    pairs.push([ssh, '<ASSET_STORE_SSH>'])
    let host = ssh.startsWith('ssh://') ? ssh.slice(6) : ssh
    host = host.slice(host.lastIndexOf('@') + 1)
    const colon = host.lastIndexOf(':')
    if (colon >= 0 && /^\d*$/.test(host.slice(colon + 1))) host = host.slice(0, colon)
    pairs.push([host, '<ASSET_STORE_SSH>'])
  }
  const key = env.ASSET_STORE_KEY
  if (key) {
    pairs.push([key, '<ASSET_STORE_KEY>'])
    pairs.push([basename(key), '<ASSET_STORE_KEY>'])
  }
  pairs.sort((a, b) => b[0].length - a[0].length)
  let out = text
  for (const [value, placeholder] of pairs) {
    if (value.length < 3) continue
    out = out.split(value).join(placeholder)
  }
  return out
}
