import type { On, SessionContextBreakdown, SessionMessage, SessionUsage, ThemeSetArgs } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Meter, Water } from '../types'

import { ALERT_AT, GLASS, TONE } from '../hooks/look'
import { formatPercent, formatReset, meterOf } from '../hooks/meter'
import { sceneSvg } from '../hooks/scene'

const WINDOW = 200000

/** A `breakdown: 'summary'` reading, the local estimate /context makes; the mod reads its total alone. */
function estimateOf(totalTokens: number): SessionContextBreakdown {
  return { totalTokens } as unknown as SessionContextBreakdown
}

/** What the stand-in engine answers: a measured percent, none (`undefined`), or a failing read. */
type World = {
  percent: number | undefined
  estimateTokens: number | undefined
  fails: boolean
}

function usageOf(world: World, withBreakdown: boolean): SessionUsage {
  if (world.fails) throw new Error('usage unavailable')
  const breakdown = withBreakdown && world.estimateTokens !== undefined ? estimateOf(world.estimateTokens) : undefined
  return {
    startedAt: 0,
    context: {
      window: WINDOW,
      ...(world.percent === undefined ? {} : { percent: world.percent, tokens: world.percent * (WINDOW / 100) }),
      ...(breakdown === undefined ? {} : { breakdown }),
    },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 12 },
      { kind: 'seven_day', percentUsed: 61.4, resetsAt: '2026-11-19T00:00:00Z' },
    ],
    cost: { usd: 1.84 },
  }
}

/** Stands in for the engine beneath the plugin, and records what the plugin set. */
function engine(on: On, world: World) {
  const themes: ThemeSetArgs[] = []
  const statuses: (string | undefined)[] = []
  const writes = { meter: 0 }
  const state: { water?: Water; meter?: Meter } = {}
  const clock = mock.clock(on, { now: 0 })

  on('state.set', (_, e, next) => {
    if (e.plugin === 'tide' && e.key === 'water') state.water = (e.value as { value: Water }).value
    if (e.plugin === 'tide' && e.key === 'meter') {
      state.meter = (e.value as { value: Meter }).value
      writes.meter += 1
    }
    return next(e)
  })

  on('session.usage', (_, e) => ({ value: usageOf(world, e.breakdown !== undefined) }))
  on('theme.set', (_, e) => {
    themes.push(e)
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('tool.call', () => ({ result: {} }))

  return { themes, statuses, writes, clock, water: () => state.water, meter: () => state.meter }
}

const measured = (percent: number): World => ({ percent, estimateTokens: percent * (WINDOW / 100), fails: false })

/** The engine swapping the window out: no response has measured the new one, only the estimate. */
function landWindow(world: World, estimateTokens: number): void {
  world.percent = undefined
  world.estimateTokens = estimateTokens
}

const BAND = {
  plugin: 'tide',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const BACKDROP = {
  plugin: 'tide',
  component: 'Backdrop',
  props: { scene: 'tide', plugin: 'tide', glass: { blur: GLASS.blur ?? 16, tint: GLASS.tint, opacity: GLASS.opacity ?? 0.6 } },
} as const

const SUMMARY: SessionMessage[] = [{ role: 'user', text: 'Summary of the conversation so far.', toolUses: [] }]

const ANSWERED = {
  answer: 'done',
  durationMs: 38000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: {
    input_tokens: 10,
    output_tokens: 12400,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: 'claude-opus-5-5',
  },
} as const

describe('scene', () => {
  test('stands at the context level and moves from the previous one', async () => {
    const still = sceneSvg({ level: 46, from: 46, phase: 'idle' })
    expect(still).toContain('translateY(54%)')
    expect(still).not.toContain('@keyframes rise')
    expect(still).not.toContain('class="bubble"')
    expect(still).not.toContain('class="ripple')
    expect(still).not.toContain('url(#grain)')

    const moving = sceneSvg({ level: 46, from: 18, phase: 'idle' })
    expect(moving).toContain('from{transform:translateY(82%)}to{transform:translateY(54%)}')
  })

  test('changes the water only past the alert line', async () => {
    expect(sceneSvg({ level: 70, from: 70, phase: 'idle' })).toContain(TONE.calm)
    expect(sceneSvg({ level: 70, from: 70, phase: 'idle' })).not.toContain(TONE.alert)

    const alert = sceneSvg({ level: ALERT_AT, from: ALERT_AT, phase: 'idle' })
    expect(alert).toContain(TONE.alert)
    expect(alert).toContain('url(#grain)')
  })

  test('bubbles while busy, ripples once when done', async () => {
    const busy = sceneSvg({ level: 46, from: 46, phase: 'busy' })
    expect(busy.split('class="bubble"').length - 1).toBe(7)
    expect(busy).toContain('--depth:46%')
    expect(busy).toContain('animation:drift 6s')

    const done = sceneSvg({ level: 86, from: 30, phase: 'done' })
    expect(done.split('class="ripple').length - 1).toBe(2)
    expect(done).toContain('class="flash"')
    expect(done).toContain('prefers-reduced-motion')
  })

  test('fits the size a scene may have', async () => {
    for (const phase of ['idle', 'busy', 'done'] as const) {
      expect(sceneSvg({ level: 100, from: 0, phase }).length).toBeLessThan(131072)
    }
  })
})

describe('meter', () => {
  test('figures in whole percent, an estimate marked', async () => {
    expect(formatPercent(46)).toBe('46%')
    expect(formatPercent(61.4)).toBe('61%')
    expect(formatPercent(64.5)).toBe('65%')
    expect(formatPercent(18, true)).toBe('~18%')
  })

  test('the 7-day reset by weekday, and by date where the weekday would name today', async () => {
    const reset = '2026-11-19T00:00:00Z' // Thu Nov 19, 09:00 in Tokyo
    const tokyo = 'Asia/Tokyo'
    expect(formatReset(reset, Date.parse('2026-11-17T03:00:00Z'), tokyo)).toBe('resets Thu 09:00') // Tue
    expect(formatReset(reset, Date.parse('2026-11-18T22:00:00Z'), tokyo)).toBe('resets Thu 09:00') // Thu, 07:00
    expect(formatReset(reset, Date.parse('2026-11-12T01:00:00Z'), tokyo)).toBe('resets Nov 19 09:00') // Thu, a week before
    expect(formatReset('not a date', 0, tokyo)).toBe(null)
  })

  test('an estimate stands in only where nothing is measured', async () => {
    const measuredUsage = usageOf(measured(46), true)
    expect(meterOf(measuredUsage, 36000).context).toEqual({ percent: 46, isEstimate: false })

    const fresh = usageOf({ percent: undefined, estimateTokens: 36000, fails: false }, true)
    expect(meterOf(fresh, 36000).context).toEqual({ percent: 18, isEstimate: true })
    expect(meterOf(fresh).context).toBe(null)
  })
})

describe('session', () => {
  test('sets the theme at start and draws the band on desktop and mobile', async ($, on) => {
    const { themes } = engine(on, measured(46))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(themes.length).toBe(1)
    expect(themes[0]?.colors?.label).toBe('Tide')
    expect(themes[0]?.backdrop).toEqual(expect.objectContaining({ scene: 'tide' }))

    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: '46%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '61%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^resets / })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '$1.84' })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }

    const backdrop = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    expect(await backdrop.find({ type: 'Svg' })).toBeDefined()
    await backdrop.unmount()
  })

  test('leaves the terminal its own band', async ($, on) => {
    engine(on, measured(46))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '46%' })).toBeUndefined()
    await ui.unmount()
  })

  test('a fresh session shows the estimate, marked as one', async ($, on) => {
    const world: World = { percent: undefined, estimateTokens: 36000, fails: false }
    const { water } = engine(on, world)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(water()).toEqual({ level: 18, from: 0, phase: 'idle' })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: '~18%' })).toBeDefined()
    await ui.unmount()
  })

  test('a turn bubbles, then ripples once and settles, and touches no status line', async ($, on) => {
    const world = measured(46)
    const { statuses, water, clock } = engine(on, world)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(water()?.phase).toBe('busy')

    world.percent = 52
    await $.turn.complete(ANSWERED)
    expect(water()).toEqual({ level: 52, from: 46, phase: 'done' })

    await clock.advance(3000)
    expect(water()).toEqual({ level: 52, from: 52, phase: 'idle' })
    expect(statuses).toEqual([])
  })

  test('a failed reading still ends the turn and keeps the water where it stood', async ($, on) => {
    const world = measured(46)
    const { water } = engine(on, world)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })

    world.fails = true
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete(ANSWERED)

    expect(water()).toEqual({ level: 46, from: 46, phase: 'done' })
  })

  test('a start resets a turn the stored water still shows, even when the reading fails', async ($, on) => {
    const world = measured(46)
    const { water } = engine(on, world)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(water()?.phase).toBe('busy')

    world.fails = true
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect(water()).toEqual({ level: 46, from: 46, phase: 'idle' })
  })

  test('an interrupted turn does not ripple', async ($, on) => {
    const { water } = engine(on, measured(46))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 4000, isAborted: true, turnId: 't1', reason: 'aborted' })

    expect(water()?.phase).toBe('idle')
  })

  test('a subagent turn leaves the main turn alone', async ($, on) => {
    const { water } = engine(on, measured(46))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'agent-1' })
    await $.turn.complete({ answer: 'r', durationMs: 1000, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'agent-1' })

    expect(water()?.phase).toBe('busy')
  })

  test('mid-turn the water moves only when usage crosses the alert line, and unchanged figures are not rewritten', async ($, on) => {
    const world = measured(70)
    const { water, writes } = engine(on, world)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })

    const before = writes.meter
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(writes.meter).toBe(before)

    world.percent = 74
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(water()?.level).toBe(70)

    world.percent = 83
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(water()).toEqual({ level: 83, from: 70, phase: 'busy' })

    world.percent = 86
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(water()?.level).toBe(83)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: '86%' })).toBeDefined()
    await ui.unmount()
  })

  test('compaction moves the water only once the engine has swapped the window out', async ($, on) => {
    const world = measured(88)
    const { water, meter, clock } = engine(on, world)
    on('session.compact', () => ({ messages: SUMMARY }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    // The hooks run while the old window still stands; it is swapped out once they returned.
    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    expect(water()?.level).toBe(88)
    landWindow(world, 36000)
    await clock.advance(0)

    expect(water()).toEqual({ level: 18, from: 88, phase: 'idle' })
    expect(meter()?.context).toEqual({ percent: 18, isEstimate: true })
  })

  test('a window swapped out late is waited for, and one that never changes is let go', async ($, on) => {
    const world = measured(88)
    const { water, clock } = engine(on, world)
    on('session.compact', () => ({ messages: SUMMARY }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    await clock.advance(250)
    expect(water()?.level).toBe(88)
    landWindow(world, 36000)
    await clock.advance(100)
    expect(water()?.level).toBe(18)

    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    await clock.advance(5000)
    landWindow(world, 10000)
    await clock.advance(5000)
    expect(water()?.level).toBe(18)
  })

  test('a vetoed compaction, a precomputation and a subagent compaction leave the water', async ($, on) => {
    const world = measured(88)
    const { water, clock } = engine(on, world)
    let skip: string | undefined = 'blocked'
    on('session.compact', () => (skip === undefined ? { messages: SUMMARY } : { skip }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    skip = undefined
    await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
    await $.session.compact({ trigger: 'auto', messages: SUMMARY, agentId: 'agent-1' })
    landWindow(world, 36000)
    await clock.advance(5000)

    expect(water()?.level).toBe(88)
  })

  test('a clear settles the water and follows the new window', async ($, on) => {
    const world = measured(70)
    const { water, clock } = engine(on, world)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(ANSWERED)
    expect(water()?.phase).toBe('done')

    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(water()).toEqual({ level: 70, from: 70, phase: 'idle' })
    landWindow(world, 20000)
    await clock.advance(0)

    expect(water()).toEqual({ level: 10, from: 70, phase: 'idle' })
  })

  test('with nothing measured or estimated the water stays where it stood', async ($, on) => {
    const world = measured(64)
    const { water, clock } = engine(on, world)
    on('session.compact', () => ({ messages: SUMMARY }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    world.percent = undefined
    world.estimateTokens = undefined
    await clock.advance(0)
    expect(water()?.level).toBe(64)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: '–' })).toBeDefined()
    await ui.unmount()
  })
})
