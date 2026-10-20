export interface CliIo {
  stdout(s: string): void
  stderr(s: string): void
  env: Record<string, string | undefined>
  cwd: string
}

export interface CliCommand {
  name: string
  summary: string
  usage: string
  run(argv: string[], io: CliIo): Promise<number> // exit code
}
