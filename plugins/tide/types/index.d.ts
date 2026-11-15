/**
 * Usage as the band shows it. `context` is the last response's measure, or the local estimate
 * /context makes (`isEstimate`) while there is none, as at a session's start or right after a
 * compaction; `null` where neither is available.
 */
export type Meter = {
  context: { percent: number; isEstimate: boolean } | null
  weekly: { percent: number; resetsAt: string | null } | null
  costUsd: number | null
}

/**
 * The water level (0 to 100), the level the last redraw moves from, and the phase: `busy` while a
 * main-loop turn runs, `done` briefly after one ends.
 */
export type Water = {
  level: number
  from: number
  phase: 'idle' | 'busy' | 'done'
}

declare module 'claude-code' {
  interface PluginState {
    tide: {
      meter: Shaped<Meter>
      water: Shaped<Water>
    }
  }
}
