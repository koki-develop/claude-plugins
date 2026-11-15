import type { SessionContextBreakdown, SessionUsage } from 'claude-code'

import type { Meter } from '../types'

import { TRACK } from './look'

export const EMPTY_METER: Meter = { context: null, weekly: null, costUsd: null }

/**
 * The band's figures from `$.session.usage()`. Where the session has no measured context (no
 * response since it started or compacted), `estimate`, a `breakdown: 'summary'` reading, stands in,
 * against the same window so the figure stays comparable with a measured one.
 */
export function meterOf(usage: SessionUsage, estimate?: SessionContextBreakdown): Meter {
  const { context } = usage
  const weekly = usage.rateLimits.find(limit => limit.kind === 'seven_day')

  return {
    context: contextOf(context.percent, context.window, estimate),
    weekly: weekly === undefined ? null : { percent: weekly.percentUsed, resetsAt: weekly.resetsAt ?? null },
    costUsd: usage.cost?.usd ?? null,
  }
}

function contextOf(
  percent: number | undefined,
  window: number,
  estimate: SessionContextBreakdown | undefined,
): Meter['context'] {
  if (percent !== undefined) return { percent, isEstimate: false }
  if (estimate === undefined || window <= 0) return null
  return { percent: Math.round((estimate.totalTokens / window) * 100), isEstimate: true }
}

/** Whether a reading needs the local estimate to stand in for a missing measure. */
export function needsEstimate(usage: SessionUsage): boolean {
  return usage.context.percent === undefined
}

/** The water level a meter stands for; `undefined` where context is neither measured nor estimated. */
export function levelOf(meter: Meter | undefined): number | undefined {
  return meter?.context?.percent
}

/**
 * A usage figure as the band prints it, in whole percent so figures of different sources read
 * alike (the 7-day usage arrives with a decimal): `46%`, or `~18%` for an estimate.
 */
export function formatPercent(percent: number, isEstimate = false): string {
  return `${isEstimate ? '~' : ''}${Math.round(percent)}%`
}

const PART_FORMATS = new Map<string | undefined, Intl.DateTimeFormat>()

function partFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  let format = PART_FORMATS.get(timeZone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
    PART_FORMATS.set(timeZone, format)
  }
  return format
}

function localParts(
  time: number,
  timeZone: string | undefined,
): Record<'year' | 'month' | 'day' | 'weekday' | 'hour' | 'minute', string> {
  const parts = partFormat(timeZone).formatToParts(new Date(time))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    weekday: part('weekday'),
    hour: part('hour'),
    minute: part('minute'),
  }
}

/**
 * When the 7-day window resets, as of `now`, in `timeZone` (the machine's when absent):
 * `resets Thu 09:00`, or `resets Nov 26 09:00` where the weekday alone would name today.
 * `null` for a time that does not parse.
 */
export function formatReset(resetsAt: string, now: number, timeZone?: string): string | null {
  const time = new Date(resetsAt).getTime()
  if (Number.isNaN(time)) return null
  const at = localParts(time, timeZone)
  const today = localParts(now, timeZone)
  const isAnotherDay = at.year !== today.year || at.month !== today.month || at.day !== today.day
  const day = isAnotherDay && at.weekday === today.weekday ? `${at.month} ${at.day}` : at.weekday
  return `resets ${day} ${at.hour}:${at.minute}`
}

/** `$1.84`. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** A usage bar with marks at 60% and 80%. */
export function barSvg(percent: number, tone: string, width: number): string {
  const fill = Math.round((width * Math.min(100, Math.max(0, percent))) / 100)
  const mark = (at: number, color: string) =>
    `<rect x="${Math.round((width * at) / 100)}" y="0" width="1" height="8" fill="${color}"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect x="0" y="2" width="${width}" height="4" rx="2" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect x="0" y="2" width="${fill}" height="4" rx="2" fill="${tone}"/>` : '') +
    mark(60, 'rgba(227,238,241,0.22)') +
    mark(80, 'rgba(255,155,138,0.45)') +
    `</svg>`
  )
}
