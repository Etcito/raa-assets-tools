import fs from 'node:fs'
import { RaaError } from '../../format/errors.ts'
import { localStore } from './local.ts'
import { STORE_DIR_DEFAULT } from './types.ts'
import type { AssetStore } from './types.ts'

export function storeFromEnv(env: Record<string, string | undefined>, opts: { local?: string } = {}): AssetStore {
  if (opts.local) return localStore(opts.local)
  if (env.RAA_ASSETS_STORE_DIR) return localStore(env.RAA_ASSETS_STORE_DIR)
  try {
    if (fs.statSync(STORE_DIR_DEFAULT).isDirectory()) return localStore(STORE_DIR_DEFAULT)
  } catch {
    // An unavailable default directory requires an explicit store location.
  }
  throw new RaaError(
    'NO_STORE',
    'no asset store is configured and the default store directory does not exist',
    'pass --store <dir> or set RAA_ASSETS_STORE_DIR',
  )
}
