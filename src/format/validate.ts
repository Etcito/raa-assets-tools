import type { RaaPrimsAsset, RaaValidation } from './types.ts'
import { checkCollision } from './validate-collision.ts'
import { validateNodes } from './validate-nodes.ts'
import type { NodeInfo } from './validate-nodes.ts'
import { checkBooleans, checkBudget, checkCaps } from './validate-rules.ts'
import { validateAnchors, validateBudget, validateMaterials, validateTopLevel } from './validate-top.ts'
import { createSink, isRecord, ptr, scanJsonValue } from './validate-util.ts'
import type { IssueSink } from './validate-util.ts'

/** Validates a parsed raa.prims value in S5 order; collects every issue and never throws. */
export function validateRaaPrims(value: unknown): RaaValidation {
  const sink = createSink()
  try {
    if (!scanJsonValue(sink, value, '')) return refused(sink.issues)

    const parts = validateTopLevel(value, sink) // step 1
    if (parts === null) return refused(sink.issues)
    const { top, materialIds } = parts

    // Step 1 already reports a non-array nodes field.
    const infos: NodeInfo[] = Array.isArray(top.nodes) ? validateNodes(top.nodes, materialIds, sink) : [] // step 2

    validateMaterials(top, sink) // step 3
    validateAnchors(top, sink)
    const budget = validateBudget(top, sink)

    checkCaps(infos, top, sink) // step 4
    checkBooleans(infos, sink) // step 5

    const nodeIds = new Set<string>()
    for (const info of infos) if (info.id !== null) nodeIds.add(info.id)

    let asset: RaaPrimsAsset | null = null
    let triangles: number | null = null
    if (sink.issues.length === 0 && budget !== null) {
      asset = { ...top, budget } as unknown as RaaPrimsAsset
      const total = checkBudget(asset, sink) // step 6
      triangles = Number.isSafeInteger(total) ? total : null
    }

    checkCollision(top, nodeIds, asset, sink) // step 7
    reportUnreadNonFinite(top, sink)

    const ok = sink.issues.length === 0 && asset !== null && triangles !== null
    return { ok, issues: sink.issues, triangles, asset: ok ? asset : null }
  } catch {
    return refused([
      {
        code: 'BAD_TYPE',
        path: '',
        message: 'The input could not be read as a raa.prims asset.',
        nodes: [],
      },
    ])
  }
}

/**
 * A non-finite number that no step read (e.g. under an unknown field, as JSON `{"a":1e400}`
 * gives) is still refused: one NUMBER_NOT_FINITE per value not already reported at its path.
 */
function reportUnreadNonFinite(top: Record<string, unknown>, sink: IssueSink): void {
  const found: string[] = []
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) found.push(path)
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], ptr(path, i))
    } else if (isRecord(v)) {
      for (const key of Object.keys(v)) walk(v[key], ptr(path, key))
    }
  }
  walk(top, '')
  if (found.length === 0) return
  const reported = new Set(
    sink.issues.filter((issue) => issue.code === 'NUMBER_NOT_FINITE').map((issue) => issue.path),
  )
  for (const path of found) {
    if (!reported.has(path)) {
      sink.add('NUMBER_NOT_FINITE', path, `The number at '${path}' must be finite.`)
    }
  }
}

function refused(issues: RaaValidation['issues']): RaaValidation {
  return { ok: false, issues, triangles: null, asset: null }
}
