import { RaaError } from '../../format/errors.ts'
import { parseManifest } from '../../manifest/manifest.ts'
import { objectKey } from '../hash.ts'
import type { AssetStore, StoreObject } from './types.ts'

export async function gcPlan(
  store: AssetStore,
  keep: string[],
): Promise<{ reachable: string[]; unreachable: StoreObject[]; unreachableBytes: number }> {
  const roots = await store.listRoots()
  const start = [...new Set([...Object.values(roots), ...keep])]
  for (const sha of start) objectKey(sha)

  const reachable = new Set<string>()
  const decoder = new TextDecoder()
  for (const sha of start) {
    if (!(await store.has(sha))) {
      throw new RaaError('GC_ROOT_MISSING', `root or kept object ${sha} is not in the store`, 'put the manifest again or remove the root')
    }
    const parsed = parseManifest(decoder.decode(await store.get(sha)))
    if (!parsed.ok || !parsed.manifest) {
      throw new RaaError(
        'GC_ROOT_NOT_MANIFEST',
        `root or kept object ${sha} is not a valid raa.manifest`,
        'point roots and --keep at manifest objects only',
      )
    }
    reachable.add(sha)
    for (const entry of Object.values(parsed.manifest.entries)) reachable.add(entry.sha256)
  }

  const unreachable = (await store.list()).filter((o) => !reachable.has(o.sha256))
  const unreachableBytes = unreachable.reduce((sum, o) => sum + o.size, 0)
  return { reachable: [...reachable].sort(), unreachable, unreachableBytes }
}
