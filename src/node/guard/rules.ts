export const GUARD_BLOCKED_EXTENSIONS: readonly string[] = ['.glb', '.gltf', '.png', '.jpg', '.jpeg', '.avif', '.ktx2', '.bin']
export const GUARD_MAX_BYTES = 1048576
export const GUARD_MARKER = 'raa-assets-guard v1'

// Bytes of the head scanned for a NUL (git's own binary heuristic uses the same window).
export const GUARD_HEAD_BYTES = 8000

export interface GuardViolation {
  path: string
  reason: 'asset-extension' | 'binary' | 'too-large'
  size: number
}

// The last extension of the basename, lowercased; '' when there is none ('.bin' is a dotfile).
export function lastExtension(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

export function isBlockedExtension(path: string): boolean {
  return GUARD_BLOCKED_EXTENSIONS.includes(lastExtension(path))
}

export function classifyBlob(path: string, size: number, head: Uint8Array): GuardViolation | null {
  if (isBlockedExtension(path)) return { path, reason: 'asset-extension', size }
  if (size > GUARD_MAX_BYTES) return { path, reason: 'too-large', size }
  const end = Math.min(head.length, GUARD_HEAD_BYTES)
  for (let i = 0; i < end; i++) {
    if (head[i] === 0) return { path, reason: 'binary', size }
  }
  return null
}
