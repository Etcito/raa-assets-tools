import { RaaError } from '../../format/errors.ts'

export const OBJECT_MAX_BYTES = 52428800
export const STORE_DIR_DEFAULT = '/root/nmc/asset-store/royal-fiesta'

export interface StoreObject {
  sha256: string
  size: number
}

export interface PutResult extends StoreObject {
  created: boolean
  key: string
}

export interface StoreStat {
  kind: 'local'
  objects: number
  bytes: number
  freeBytes: number | null
}

export interface AssetStore {
  readonly kind: 'local'
  put(data: Uint8Array): Promise<PutResult>
  get(sha256: string): Promise<Uint8Array>
  has(sha256: string): Promise<boolean>
  list(): Promise<StoreObject[]>
  stat(): Promise<StoreStat>
  readRoot(name: string): Promise<string | null>
  writeRoot(name: string, sha256: string): Promise<void>
  listRoots(): Promise<Record<string, string>>
}

export function assertSize(size: number): void {
  if (size > OBJECT_MAX_BYTES) {
    throw new RaaError(
      'OBJECT_TOO_LARGE',
      `${size} bytes is over the ${OBJECT_MAX_BYTES}-byte limit`,
      'keep objects under 50 MiB; split or compress the file',
    )
  }
}
