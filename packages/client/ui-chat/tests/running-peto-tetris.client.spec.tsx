// @vitest-environment jsdom
/** Peto: the running Chat status shows Peto Web's Tetris board instead of DeepSeek's whale tail. */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunningPetoTetris } from '../src/client/chat/RunningPetoTetris.tsx'
import { mountPetoTetris } from '../src/client/chat/peto-tetris.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A 2D context that records the cells drawn, enough for the board's calls. */
function fakeContext() {
  const cells: Array<{ fill: string; alpha: number }> = []
  const context = {
    fillStyle: '', globalAlpha: 1,
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(),
    fill() { cells.push({ fill: this.fillStyle, alpha: this.globalAlpha }) },
  }
  return { context, cells }
}

function canvasWith(context: unknown): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as CanvasRenderingContext2D)
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 14, height: 14 } as DOMRect)
  canvas.style.color = 'rgb(20, 40, 120)'
  document.body.append(canvas)
  return canvas
}

function stubMedia(matches: Record<string, boolean>) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches[query] ?? false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
}

describe('RunningPetoTetris', () => {
  it('renders a decorative canvas in the running icon footprint without the whale', () => {
    stubMedia({})
    const view = render(<RunningPetoTetris />)
    const icon = view.container.firstElementChild!
    expect(icon.tagName).toBe('SPAN')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('data-peto-running-icon')).toBe('animate')
    expect(icon.children).toHaveLength(1)
    expect(icon.firstElementChild?.tagName).toBe('CANVAS')
    expect(view.container.querySelector('svg')).toBeNull()
  })

  it('holds a still board when the system asks for less motion or forced colors', () => {
    stubMedia({ '(prefers-reduced-motion: reduce)': true })
    expect(render(<RunningPetoTetris />).container.firstElementChild?.getAttribute('data-peto-running-icon')).toBe('still')
    cleanup()
    stubMedia({ '(forced-colors: active)': true, '(prefers-reduced-motion: reduce)': true })
    expect(render(<RunningPetoTetris />).container.firstElementChild?.getAttribute('data-peto-running-icon')).toBe('forced')
  })
})

describe('mountPetoTetris', () => {
  it('draws a still frame once in the light palette and starts no loop', () => {
    const frame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', frame)
    const { context, cells } = fakeContext()
    const stop = mountPetoTetris(canvasWith(context), 'still')
    // One draw of 36 cells, plus a redraw when the size watch reports the first size.
    const draws = cells.length / 36
    expect(Number.isInteger(draws) && draws >= 1).toBe(true)
    // The T piece of the still frame and one brick below it, in the light palette's purple.
    expect(cells.filter(cell => cell.fill === 'rgb(135,55,205)')).toHaveLength(5 * draws)
    expect(frame).not.toHaveBeenCalled()
    stop()
  })

  it('draws forced colors in the text color only', () => {
    const { context, cells } = fakeContext()
    mountPetoTetris(canvasWith(context), 'forced')()
    expect(new Set(cells.map(cell => cell.fill))).toEqual(new Set(['rgb(20, 40, 120)']))
  })

  it('plays until stopped', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback))
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { context, cells } = fakeContext()
    const stop = mountPetoTetris(canvasWith(context), 'animate')
    for (let ms = 0; ms < 3000; ms += 50) callbacks.at(-1)!(ms)
    expect(cells.length).toBeGreaterThanOrEqual(36 * 60)
    // Pieces land within three seconds, so some cells carry a piece color instead of the faint grid.
    expect(cells.some(cell => cell.fill.startsWith('rgb(') && !cell.fill.includes(' '))).toBe(true)
    stop()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
