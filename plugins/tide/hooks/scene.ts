import type { Water } from '../types'

import { ALERT_AT, waterToneOf } from './look'

/**
 * The backdrop as one SVG document. The surface replaces the whole document on every redraw, so a
 * change of level is drawn as an animation from `water.from` to `water.level` inside the new document.
 *
 * Lengths are in CSS pixels of the window and vertical positions in percent of its height, so the
 * level is exact at any window size. `transform-box: view-box` makes a percentage in `translateY`
 * a percentage of the window's height.
 */
export function sceneSvg(water: Water): string {
  const level = clampLevel(water.level)
  const from = clampLevel(water.from)
  const tone = waterToneOf(level)
  const surface = 100 - level
  const moves = from !== level
  const busy = water.phase === 'busy'
  const done = water.phase === 'done'
  const murky = level >= ALERT_AT
  const waveSeconds = busy ? [6, 9] : [16, 26]

  const style = [
    `.water{transform-box:view-box;transform:translateY(${surface}%)}`,
    moves ? `.water{animation:rise 1.4s cubic-bezier(.2,.7,.2,1) both}` : '',
    moves ? `@keyframes rise{from{transform:translateY(${100 - from}%)}to{transform:translateY(${surface}%)}}` : '',
    `.wave{animation:drift ${waveSeconds[0]}s linear infinite}`,
    `.wave2{animation:drift ${waveSeconds[1]}s linear infinite reverse}`,
    `@keyframes drift{from{transform:translateX(0)}to{transform:translateX(-240px)}}`,
    `.bubble{transform-box:view-box;animation:bubble linear infinite}`,
    `@keyframes bubble{0%{transform:translateY(var(--depth));opacity:0}12%{opacity:.85}88%{opacity:.6}100%{transform:translateY(6px);opacity:0}}`,
    `.ripple{transform-box:fill-box;transform-origin:center;opacity:0;animation:ripple 2.4s cubic-bezier(.2,.6,.3,1) 1 both}`,
    `.ripple.late{animation-delay:.45s}`,
    `@keyframes ripple{from{transform:scale(.15);opacity:.9}to{transform:scale(1);opacity:0}}`,
    `.flash{opacity:0;animation:flash 1.6s ease-out 1 both}`,
    `@keyframes flash{0%{opacity:0}20%{opacity:.9}100%{opacity:0}}`,
    `@media (prefers-reduced-motion: reduce){*{animation:none !important}.ripple,.flash,.bubble{display:none}}`,
  ].join('')

  const bubbles = busy && level > 4 ? BUBBLES.map(b => bubble(b, level)).join('') : ''

  const ripple = done
    ? `<line class="flash" x1="0" y1="0" x2="100%" y2="0" stroke="#e9fdff" stroke-width="2"/>` +
      `<ellipse class="ripple" cx="72%" cy="0" rx="300" ry="20" fill="none" stroke="${tone}" stroke-width="1.5"/>` +
      `<ellipse class="ripple late" cx="72%" cy="0" rx="300" ry="20" fill="none" stroke="${tone}" stroke-width="1"/>`
    : ''

  const grain = murky ? `<rect x="0" y="6" width="100%" height="100%" fill="url(#grain)"/>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    `<style>${style}</style>` +
    `<defs>` +
    `<linearGradient id="air" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08161e"/><stop offset="1" stop-color="#050d12"/></linearGradient>` +
    `<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity=".24"/><stop offset=".12" stop-color="${tone}" stop-opacity=".17"/><stop offset=".6" stop-color="${tone}" stop-opacity=".13"/><stop offset="1" stop-color="${tone}" stop-opacity=".11"/></linearGradient>` +
    `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity=".22"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="calm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".26" stop-color="#fff"/><stop offset=".32" stop-color="#fff" stop-opacity=".55"/><stop offset=".88" stop-color="#fff" stop-opacity=".55"/><stop offset=".93" stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<mask id="calm-mask" maskUnits="userSpaceOnUse" x="0" y="-40" width="100%" height="80"><rect x="0" y="-40" width="100%" height="80" fill="url(#calm)"/></mask>` +
    `<radialGradient id="bub"><stop offset="0" stop-color="#d9fbff" stop-opacity=".9"/><stop offset=".6" stop-color="#d9fbff" stop-opacity=".25"/><stop offset="1" stop-color="#d9fbff" stop-opacity="0"/></radialGradient>` +
    `<pattern id="grain" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".9" fill="${tone}" fill-opacity=".16"/><circle cx="6.5" cy="7" r=".7" fill="${tone}" fill-opacity=".1"/></pattern>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="url(#air)"/>` +
    `<g class="water">` +
    `<rect x="0" y="0" width="100%" height="100%" fill="url(#body)"/>` +
    `<rect x="0" y="0" width="100%" height="34" fill="url(#sheen)"/>` +
    grain +
    bubbles +
    `<g mask="url(#calm-mask)">` +
    `<path class="wave2" d="${wavePath(-240, 5, 4, 120)}" fill="none" stroke="${tone}" stroke-opacity=".28" stroke-width="1"/>` +
    `<path class="wave" d="${wavePath(0, 0, 7, 120)}" fill="none" stroke="${tone}" stroke-opacity=".72" stroke-width="1.5"/>` +
    `</g>` +
    ripple +
    `</g>` +
    `</svg>`
  )
}

/** Widest window the waves cover, in CSS pixels, plus one wave period for the drift. */
const WAVE_SPAN = 7680

function wavePath(startX: number, y: number, amplitude: number, period: number): string {
  const half = period / 2
  const steps = Math.ceil((WAVE_SPAN - startX) / period) + 2
  return `M${startX} ${y} q${half} ${-amplitude} ${period} 0` + ` t${period} 0`.repeat(steps)
}

type BubbleSpec = { x: string; r: number; seconds: number; delay: number }

/** Bubbles rise along the right edge, clear of the sidebar and the conversation. */
const BUBBLES: readonly BubbleSpec[] = [
  { x: '92.5%', r: 3, seconds: 6, delay: 0 },
  { x: '95%', r: 4.6, seconds: 7.8, delay: -1.3 },
  { x: '97.6%', r: 6.2, seconds: 9.6, delay: -2.6 },
  { x: '94%', r: 3, seconds: 6, delay: -3.9 },
  { x: '96.6%', r: 4.6, seconds: 7.8, delay: -5.2 },
  { x: '91.6%', r: 6.2, seconds: 9.6, delay: -6.5 },
  { x: '98.8%', r: 3, seconds: 6, delay: -1.8 },
]

/** A bubble starts at the bottom of the window, `level` percent of its height below the surface. */
function bubble(spec: BubbleSpec, level: number): string {
  return (
    `<circle class="bubble" cx="${spec.x}" cy="0" r="${spec.r}" fill="url(#bub)" ` +
    `style="--depth:${level}%;animation-duration:${spec.seconds}s;animation-delay:${spec.delay}s"/>`
  )
}

export function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)))
}
