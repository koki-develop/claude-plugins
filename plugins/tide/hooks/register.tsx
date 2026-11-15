import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown, Timer } from 'claude-code'

import type { Meter, Water } from '../types'

import { ALERT_AT, INK, LOOK, PLUGIN, SCENE, UNPAINTED, toneOf } from './look'
import {
  EMPTY_METER,
  barSvg,
  formatCost,
  formatPercent,
  formatReset,
  levelOf,
  meterOf,
  needsEstimate,
} from './meter'
import { clampLevel, sceneSvg } from './scene'

const STILL_WATER: Water = { level: 0, from: 0, phase: 'idle' }

const meterAtom = atom({ plugin: 'tide', key: 'meter' } as const, EMPTY_METER, { shape: 'meter-3' })
const waterAtom = atom({ plugin: 'tide', key: 'water' } as const, STILL_WATER, { shape: 'water-1' })

/** How long the ripple of a finished turn stays in the scene before the water settles. */
const SETTLE_MS = 3000
const GAUGE_WIDTH = 150

type Engine = EngineInterface

/** The settling of a finished turn's ripple; a reload drops it. */
let settle: Timer | undefined

function cancelSettle(): void {
  settle?.cancel()
  settle = undefined
}

function logFailure($: Engine, what: string, error: unknown): void {
  $.ui.log(`tide: ${what} failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

/**
 * Whether two plain-data values are the same. A value is written only when it differs, so a
 * drawing that reads it is not redrawn for nothing.
 */
function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Reads the session's usage into the band. The local estimate is read only where nothing is
 * measured. Resolves `undefined` when the reading failed, after logging it: the band keeps what it
 * showed.
 */
async function refreshMeter($: Engine): Promise<Meter | undefined> {
  try {
    const usage = await $.session.usage()
    let estimate: SessionContextBreakdown | undefined
    if (needsEstimate(usage)) estimate = (await $.session.usage({ breakdown: 'summary' })).context.breakdown

    const meter = meterOf(usage, estimate)
    if (!isSame(await read($, meterAtom), meter)) await update($, meterAtom, () => meter)
    return meter
  } catch (error) {
    logFailure($, 'reading usage', error)
    return undefined
  }
}

/**
 * Sets the water in one write, so the scene is redrawn once: the phase always, the level where it
 * is known (the water stays where it is otherwise), animating from where it stood.
 */
async function setWater($: Engine, level: number | undefined, phase?: Water['phase']): Promise<void> {
  await update($, waterAtom, (water): Water => ({
    level: level === undefined ? water.level : clampLevel(level),
    from: water.level,
    phase: phase ?? water.phase,
  }))
}

async function settleWater($: Engine): Promise<void> {
  await update($, waterAtom, (water): Water => (water.phase === 'done' ? { ...water, from: water.level, phase: 'idle' } : water))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cancelSettle()

    if (UNPAINTED !== undefined) $.ui.toast(`tide: ${UNPAINTED}`)
    try {
      const set = await $.theme.set(LOOK)
      if (!set.isDrawn) $.ui.log(`tide: theme not drawn: ${set.reason}`, { to: 'debug' })
    } catch (error) {
      logFailure($, 'setting the theme', error)
    }

    // A reload keeps the stored water, which may still say a turn runs: no turn runs at a start.
    await setWater($, levelOf(await refreshMeter($)), 'idle')

    return started
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId !== undefined) return started

    cancelSettle()
    await setWater($, undefined, 'busy')

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) return completed

    cancelSettle()
    const finished = e.reason === 'answer'
    await setWater($, levelOf(await refreshMeter($)), finished ? 'done' : 'idle')
    if (finished) settle = $.clock.after(SETTLE_MS, () => void settleWater($))

    return completed
  })

  // Context grows with every response of a turn: the band follows each tool result, and the water
  // moves mid-turn only when usage crosses the alert line, so the scene is not redrawn on every step.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    const level = levelOf(await refreshMeter($))
    const water = await read($, waterAtom)
    if (level !== undefined && level >= ALERT_AT !== water.level >= ALERT_AT) await setWater($, level)

    return result
  }).catch((_, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    // A subagent's compaction, a precomputation nobody applied yet, and a vetoed one leave the window as it is.
    if (e.agentId !== undefined || e.trigger === 'precompute' || 'skip' in compacted) return compacted

    await setWater($, levelOf(await refreshMeter($)))

    return compacted
  }).catch((_, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    cancelSettle()

    if (e.reason === 'clear') await setWater($, levelOf(await refreshMeter($)), 'idle')

    return ended
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN || e.props.scene !== SCENE) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)

    const water = await read($, waterAtom)
    const { Svg } = $.ui.resolve(e)

    return <Svg source={sceneSvg(water)} alt={`Water at ${water.level}% of the context window`} isInteractive />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (e.props.hasSurvey) return next(e)

    const meter = await read($, meterAtom)
    const now = await $.clock.now()
    const { Box, Text, Svg } = $.ui.resolve(e)

    const gauge = (label: string, percent: number | null, figure: string, alt: string) => {
      const tone = percent === null ? INK.muted : toneOf(percent)
      return (
        <Box flexDirection="row" alignItems="center" gap="sm" flexShrink={0}>
          <Text size="footnote" color={INK.muted}>
            {label}
          </Text>
          <Box flexDirection="row" alignItems="center" gap="xs">
            <Svg source={barSvg(percent ?? 0, tone, GAUGE_WIDTH)} alt={alt} width={GAUGE_WIDTH} height={8} />
            <Text size="footnote" mono tabular weight="medium" color={tone}>
              {figure}
            </Text>
          </Box>
        </Box>
      )
    }

    const context = meter.context
    const weekly = meter.weekly
    const reset = weekly?.resetsAt ? formatReset(weekly.resetsAt, now) : null

    return (
      <Box flexDirection="row" alignItems="center" gap="md" paddingX="xs">
        {context === null
          ? gauge('context', null, '–', 'context not measured yet')
          : gauge(
              'context',
              context.percent,
              formatPercent(context.percent, context.isEstimate),
              `context ${context.isEstimate ? 'about ' : ''}${formatPercent(context.percent)} used`,
            )}
        {weekly !== null && (
          <Box flexDirection="row" alignItems="center" gap="sm" flexShrink={0}>
            {gauge('7d', weekly.percent, formatPercent(weekly.percent), `7-day usage ${formatPercent(weekly.percent)}`)}
            {reset !== null && (
              <Text size="caption" color={INK.muted} wrap="truncate">
                {reset}
              </Text>
            )}
          </Box>
        )}
        <Box flexGrow={1} flexShrink={1} />
        {meter.costUsd !== null && (
          <Box flexShrink={0}>
            <Text size="footnote" mono tabular color={INK.secondary}>
              {formatCost(meter.costUsd)}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
