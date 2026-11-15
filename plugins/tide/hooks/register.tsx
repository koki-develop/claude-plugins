import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

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

/** How often, and how many times, the water looks for a swapped-out window to land. */
const SWAP_POLL_MS = 100
const SWAP_POLLS = 20

/** The wait for a compaction or a clear to land; a reload drops it. */
let swap: Timer | undefined

function cancelSwap(): void {
  swap?.cancel()
  swap = undefined
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
    let estimatedTokens: number | undefined
    if (needsEstimate(usage)) {
      estimatedTokens = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.totalTokens
    }

    const meter = meterOf(usage, estimatedTokens)
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

/**
 * What identifies the context window as it stands: its last measure and the local estimate.
 * `undefined` when it cannot be read.
 */
async function windowMark($: Engine): Promise<string | undefined> {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    return JSON.stringify([context.tokens ?? null, context.breakdown?.totalTokens ?? null])
  } catch {
    return undefined
  }
}

/**
 * The engine swaps the context window out (a compaction, a /clear) only once that event's hooks
 * have returned, so a reading taken inside them still measures the old window. From right after the
 * hook returns, the band and the water wait for the window's mark to leave `stale`, the mark taken
 * inside the hook, then follow the new window.
 */
function followSwap($: Engine, stale: string | undefined): void {
  cancelSwap()
  waitForSwap($, stale, 0)
}

function waitForSwap($: Engine, stale: string | undefined, attempt: number): void {
  swap = $.clock.after(attempt === 0 ? 0 : SWAP_POLL_MS, () => void landSwap($, stale, attempt))
}

async function landSwap($: Engine, stale: string | undefined, attempt: number): Promise<void> {
  swap = undefined
  const mark = stale === undefined ? undefined : await windowMark($)
  if (mark !== undefined && mark === stale) {
    if (attempt + 1 < SWAP_POLLS) return waitForSwap($, stale, attempt + 1)
    $.ui.log('tide: the context window did not change after it was swapped out', { to: 'debug' })
    return
  }
  await setWater($, levelOf(await refreshMeter($)))
}

async function settleWater($: Engine): Promise<void> {
  await update($, waterAtom, (water): Water => (water.phase === 'done' ? { ...water, from: water.level, phase: 'idle' } : water))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cancelSettle()
    cancelSwap()

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
    // A subagent's compaction and a precomputation nobody applied yet leave the window as it is.
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)

    const stale = await windowMark($)
    const compacted = await next(e)
    if (!('skip' in compacted)) followSwap($, stale)

    return compacted
  }).catch((_, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const stale = e.reason === 'clear' ? await windowMark($) : undefined
    const ended = await next(e)
    cancelSettle()
    cancelSwap()

    // A /clear goes on in a new window, with no new session.start.
    if (e.reason === 'clear') {
      await setWater($, undefined, 'idle')
      followSwap($, stale)
    }

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
