import type { RaaValidation } from './types.ts'
import { validateRaaPrims } from './validate.ts'

/** Parses raa.prims JSON text and validates it; a syntax error gives one JSON_PARSE issue. Never throws. */
export function parseRaaPrims(text: string): RaaValidation {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      issues: [{ code: 'JSON_PARSE', path: '', message: `The text is not valid JSON: ${detail}.`, nodes: [] }],
      triangles: null,
      asset: null,
    }
  }
  return validateRaaPrims(value)
}
