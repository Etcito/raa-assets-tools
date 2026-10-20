import { RaaError } from '../format/errors.ts'

export const MANIFEST_FORMAT = 'raa.manifest'
export const MANIFEST_VERSION = 0
export const LOGICAL_NAME_RE = /^[a-z][a-z0-9_.-]{0,127}$/

export interface ManifestEntry {
  sha256: string
  size: number
  contentType: string
  version: number
}

export interface RaaManifest {
  format: 'raa.manifest'
  version: 0
  name: string
  entries: Record<string, ManifestEntry>
}

export interface ManifestIssue {
  code: 'JSON_PARSE' | 'NOT_OBJECT' | 'BAD_FORMAT' | 'BAD_VERSION' | 'MISSING_FIELD' | 'UNKNOWN_FIELD' | 'BAD_TYPE' | 'BAD_NAME' | 'BAD_HASH' | 'BAD_SIZE' | 'BAD_CONTENT_TYPE' | 'BAD_ENTRY_VERSION'
  path: string
  message: string
}

type ValidationResult = { ok: boolean; issues: ManifestIssue[]; manifest: RaaManifest | null }
const TOP_KEYS = ['format', 'version', 'name', 'entries']
const ENTRY_KEYS = ['sha256', 'size', 'contentType', 'version']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function validateManifest(value: unknown): ValidationResult {
  const issues: ManifestIssue[] = []
  const issue = (code: ManifestIssue['code'], path: string, message: string) => {
    issues.push({ code, path, message })
  }

  if (!isObject(value)) {
    issue('NOT_OBJECT', '', 'Manifest must be an object.')
    return { ok: false, issues, manifest: null }
  }

  for (const key of TOP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) issue('MISSING_FIELD', `/${key}`, `Missing required field '${key}'.`)
  }
  for (const key of Object.keys(value)) {
    if (!TOP_KEYS.includes(key)) issue('UNKNOWN_FIELD', `/${pointerPart(key)}`, `Unknown field '${key}'.`)
  }

  if (Object.prototype.hasOwnProperty.call(value, 'format')) {
    if (typeof value.format !== 'string') issue('BAD_TYPE', '/format', 'Field format must be a string.')
    else if (value.format !== MANIFEST_FORMAT) issue('BAD_FORMAT', '/format', `Format must be '${MANIFEST_FORMAT}'.`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'version')) {
    if (typeof value.version !== 'number') issue('BAD_TYPE', '/version', 'Field version must be a number.')
    else if (value.version !== MANIFEST_VERSION) issue('BAD_VERSION', '/version', `Version must be ${MANIFEST_VERSION}.`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'name')) {
    if (typeof value.name !== 'string') issue('BAD_TYPE', '/name', 'Field name must be a string.')
    else if (!LOGICAL_NAME_RE.test(value.name)) issue('BAD_NAME', '/name', 'Name must match the logical-name format.')
  }

  const cleanEntries: Record<string, ManifestEntry> = {}
  if (Object.prototype.hasOwnProperty.call(value, 'entries')) {
    if (!isObject(value.entries)) {
      issue('BAD_TYPE', '/entries', 'Field entries must be an object.')
    } else {
      for (const [entryName, rawEntry] of Object.entries(value.entries)) {
        const entryPath = `/entries/${pointerPart(entryName)}`
        if (!LOGICAL_NAME_RE.test(entryName)) issue('BAD_NAME', entryPath, 'Entry key must match the logical-name format.')
        if (!isObject(rawEntry)) {
          issue('BAD_TYPE', entryPath, 'Entry must be an object.')
          continue
        }
        for (const key of ENTRY_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(rawEntry, key)) issue('MISSING_FIELD', `${entryPath}/${key}`, `Missing required field '${key}'.`)
        }
        for (const key of Object.keys(rawEntry)) {
          if (!ENTRY_KEYS.includes(key)) issue('UNKNOWN_FIELD', `${entryPath}/${pointerPart(key)}`, `Unknown field '${key}'.`)
        }

        const checked: Partial<ManifestEntry> = {}
        if (Object.prototype.hasOwnProperty.call(rawEntry, 'sha256')) {
          if (typeof rawEntry.sha256 !== 'string') issue('BAD_TYPE', `${entryPath}/sha256`, 'Field sha256 must be a string.')
          else if (!/^[0-9a-f]{64}$/.test(rawEntry.sha256)) issue('BAD_HASH', `${entryPath}/sha256`, 'sha256 must be 64 lowercase hexadecimal characters.')
          else checked.sha256 = rawEntry.sha256
        }
        if (Object.prototype.hasOwnProperty.call(rawEntry, 'size')) {
          if (typeof rawEntry.size !== 'number') issue('BAD_TYPE', `${entryPath}/size`, 'Field size must be a number.')
          else if (!Number.isInteger(rawEntry.size) || rawEntry.size < 0 || rawEntry.size > 52428800) issue('BAD_SIZE', `${entryPath}/size`, 'Size must be an integer from 0 to 52428800 bytes.')
          else checked.size = rawEntry.size
        }
        if (Object.prototype.hasOwnProperty.call(rawEntry, 'contentType')) {
          if (typeof rawEntry.contentType !== 'string') issue('BAD_TYPE', `${entryPath}/contentType`, 'Field contentType must be a string.')
          else if (!/^[^/\s]+\/[^/\s]+$/.test(rawEntry.contentType)) issue('BAD_CONTENT_TYPE', `${entryPath}/contentType`, 'contentType must be a non-empty type/subtype without whitespace.')
          else checked.contentType = rawEntry.contentType
        }
        if (Object.prototype.hasOwnProperty.call(rawEntry, 'version')) {
          if (typeof rawEntry.version !== 'number') issue('BAD_TYPE', `${entryPath}/version`, 'Field version must be a number.')
          else if (!Number.isInteger(rawEntry.version) || rawEntry.version < 1) issue('BAD_ENTRY_VERSION', `${entryPath}/version`, 'Entry version must be an integer of at least 1.')
          else checked.version = rawEntry.version
        }
        if (checked.sha256 !== undefined && checked.size !== undefined && checked.contentType !== undefined && checked.version !== undefined) {
          cleanEntries[entryName] = checked as ManifestEntry
        }
      }
    }
  }

  const ok = issues.length === 0
  const manifest: RaaManifest | null = ok ? {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    name: value.name as string,
    entries: cleanEntries
  } : null
  return { ok, issues, manifest }
}

export function parseManifest(text: string): ValidationResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ code: 'JSON_PARSE', path: '', message: 'Text is not valid JSON.' }], manifest: null }
  }
  return validateManifest(value)
}

export function serializeManifest(m: RaaManifest): string {
  const result = validateManifest(m)
  if (!result.ok || result.manifest === null) {
    const first = result.issues[0]
    throw new RaaError('MANIFEST_INVALID', `${result.issues.length} issues; first: ${first.code} ${first.path}: ${first.message}`, 'fix the manifest fields; see docs/store.md')
  }
  const manifest = result.manifest
  const lines = [
    '{',
    `  "format": ${JSON.stringify(manifest.format)},`,
    `  "version": ${String(manifest.version)},`,
    `  "name": ${JSON.stringify(manifest.name)},`,
    '  "entries": {'
  ]
  const names = Object.keys(manifest.entries).sort()
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const entry = manifest.entries[name]
    const comma = i + 1 < names.length ? ',' : ''
    lines.push(`    ${JSON.stringify(name)}: {`)
    lines.push(`      "sha256": ${JSON.stringify(entry.sha256)},`)
    lines.push(`      "size": ${String(entry.size)},`)
    lines.push(`      "contentType": ${JSON.stringify(entry.contentType)},`)
    lines.push(`      "version": ${String(entry.version)}`)
    lines.push(`    }${comma}`)
  }
  if (names.length === 0) lines[4] = '  "entries": {}'
  else lines.push('  }')
  lines.push('}')
  return `${lines.join('\n')}\n`
}

export function contentTypeFor(fileName: string): string {
  const name = fileName.toLowerCase()
  const types: [string, string][] = [
    ['.raa.prims.json', 'application/vnd.raa.prims+json'],
    ['.sdfm.json', 'application/vnd.sdfm+json'],
    ['.json', 'application/json'],
    ['.png', 'image/png'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.glb', 'model/gltf-binary']
  ]
  return types.find(([suffix]) => name.endsWith(suffix))?.[1] ?? 'application/octet-stream'
}
