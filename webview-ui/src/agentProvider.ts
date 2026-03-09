export type AgentProvider = 'claude' | 'codex' | 'gemini' | 'unknown'

export function detectAgentProvider(model?: string): AgentProvider {
  if (!model) return 'unknown'
  const normalized = model.toLowerCase()
  if (normalized.includes('gpt') || normalized.includes('o1') || normalized.includes('o3') || normalized.includes('o4') || normalized.includes('codex')) {
    return 'codex'
  }
  if (normalized.includes('gemini')) {
    return 'gemini'
  }
  if (normalized.includes('claude') || normalized.includes('opus') || normalized.includes('sonnet') || normalized.includes('haiku')) {
    return 'claude'
  }
  return 'unknown'
}

export function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'claude': return 'Claude'
    case 'codex': return 'Codex'
    case 'gemini': return 'Gemini'
    default: return 'Unknown'
  }
}

export function providerAccent(provider: AgentProvider): string {
  switch (provider) {
    case 'claude': return '#d2823b'
    case 'codex': return '#3b82f6'
    case 'gemini': return '#2db889'
    default: return '#8a8aa8'
  }
}
