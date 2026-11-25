// archicad-guard keeps no $.state values yet. Its contract grows with its points (1.3, 1.4).
export type Placeholder = never

declare module 'claude-code' {
  interface PluginState {
    'archicad-guard': {}
  }
}
