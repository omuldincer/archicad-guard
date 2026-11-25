// archicad-guard's $.state contract (point 1.4).

/** The backups made this session: project key (path, `/`, lower case) → the backup file's full path. */
export type Backups = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'archicad-guard': {
      backups: Backups
    }
  }
}
