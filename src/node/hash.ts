import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { RaaError } from '../format/errors.ts'

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    const buf = chunk as Uint8Array
    hash.update(buf)
    size += buf.length
  }
  return { sha256: hash.digest('hex'), size }
}

export function objectKey(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new RaaError('BAD_HASH', `'${sha256}' is not a sha256 hash`, 'pass a 64-character lowercase hex sha256')
  }
  return `objects/${sha256.slice(0, 2)}/${sha256}`
}
