export class RaaError extends Error {
  readonly code: string
  readonly fix: string

  constructor(code: string, message: string, fix: string) {
    super(message)
    this.name = 'RaaError'
    this.code = code
    this.fix = fix
  }
}
