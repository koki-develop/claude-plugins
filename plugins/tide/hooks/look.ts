import type { ThemeBackdropGlass, ThemeSetArgs } from 'claude-code'

// The plugin-authoring skill's own copy for this Claude Code build, unmodified: the design system's
// color names change with the build, so copy it again from the skill when Claude Code updates.
import { makeColors } from './make-colors.js'

export const PLUGIN = 'tide'
export const SCENE = 'tide'

/** Usage at which a figure turns amber, and at which it turns coral and the water changes. */
const CAUTION_AT = 60
export const ALERT_AT = 80

export const INK = {
  primary: '#e3eef1',
  secondary: '#b7cbd1',
  muted: '#8ea9b0',
} as const

export const TONE = {
  calm: '#5fd0de',
  caution: '#e8c46a',
  alert: '#ff8f7d',
} as const

/** The color of a usage figure: its bar and its number. */
export function toneOf(percent: number): string {
  if (percent >= ALERT_AT) return TONE.alert
  if (percent >= CAUTION_AT) return TONE.caution
  return TONE.calm
}

/** The color of the water, which changes only once usage is past the alert line. */
export function waterToneOf(level: number): string {
  return level >= ALERT_AT ? TONE.alert : TONE.calm
}

/** The empty part of a usage bar. */
export const TRACK = 'rgba(127,216,228,0.14)'

export const GLASS: ThemeBackdropGlass = { blur: 16, tint: '#07161e', opacity: 0.74 }

const { theme, problems } = makeColors({
  label: 'Tide',
  only: 'dark',
  roles: {
    accent: '#5fd0de',
    danger: '#ff8f7d',
    success: '#84d9a3',
    warning: '#e8c46a',
    pro: '#ad97de',
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#061118',
        'surface-1': '#0a1a22',
        'surface-2': '#0e212a',
        'surface-3': '#10242d',
        'text-primary': INK.primary,
        'text-secondary': INK.secondary,
        'text-muted': INK.muted,
      },
      // Borders, rings and the translucent fills are this stop at low opacity: dimmer than the
      // near-white stop the anchors give, so outlines stay quiet over the water.
      stops: { 0: '#ff3030' },
    },
  },
})

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE, glass: GLASS },
}

/** The line that would stop the desktop app painting these colors, if `makeColors` reports one. */
export const UNPAINTED: string | undefined = problems.find(line => line.startsWith("Desktop won't paint"))
