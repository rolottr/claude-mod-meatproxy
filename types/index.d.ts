export type Draft = {
  id: number
  body: string
  subject?: string
  to?: string
  createdAt: number
}

declare module 'claude-code' {
  interface PluginState {
    meatproxy: {
      drafts: Draft[]
      shown: number
      notice: string | null
    }
  }
}
