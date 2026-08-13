export function shouldAutoRunReadOnlyOverlay(input: {
  readonly hasAutoExecutableReadOnlyOverlay: boolean
  readonly writePolicy?: { mode?: 'auto' | 'ask' | 'off' } | null
  readonly writeExecution?: string | null
}): boolean {
  return !input.writePolicy && !input.writeExecution && input.hasAutoExecutableReadOnlyOverlay
}
