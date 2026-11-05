// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { PetoMark, PetoName } from '../src/client/Brand.tsx'
import { PETO_MARK_PATH, PETO_MARK_VIEWBOX } from '../src/client/mark.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const MARK = 'sidebar.brand.mark'
const NAME = 'sidebar.brand.name'
const HERO = 'conversation.hero.brand.mark'
const HOLES = [MARK, NAME, HERO] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

const counts = (slots: SlotRegistry) => HOLES.map(name => slots.entries(name).length)

describe('Peto browser-brand plugin', () => {
  it('keeps the host Loader entry inert and needs only the slot registry', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots'])
  })

  it('fills both marks in a local build and keeps the local-build label', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(counts(subject.slots)).toEqual([1, 0, 1])
    await fiber.dispose()
    expect(counts(subject.slots)).toEqual([0, 0, 0])
  })

  it('also names the product in an official build, before or after the declarations', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(counts(before.slots)).toEqual([1, 1, 1])
    before.disposeHoles?.()
    expect(counts(before.slots)).toEqual([0, 0, 0])
    before.declareHoles()
    await Promise.resolve()
    expect(counts(before.slots)).toEqual([1, 1, 1])
    await fiber.dispose()
    expect(counts(before.slots)).toEqual([0, 0, 0])

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(counts(after.slots)).toEqual([0, 0, 0])
    after.declareHoles()
    await Promise.resolve()
    expect(counts(after.slots)).toEqual([1, 1, 1])
  })

  it('draws the mark in the current text colour at the requested width', () => {
    const mark = render(<PetoMark size={24} />)
    const svg = mark.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(Number(svg.getAttribute('height'))).toBeCloseTo((24 * PETO_MARK_VIEWBOX.height) / PETO_MARK_VIEWBOX.width)
    expect(svg.getAttribute('viewBox')).toBe('0 0 138 94')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const path = svg.querySelector('path')!
    expect(path.getAttribute('fill')).toBe('currentColor')
    expect(path.getAttribute('fill-rule')).toBe('evenodd')
    expect(path.getAttribute('d')).toBe(PETO_MARK_PATH)
    mark.rerender(<PetoMark size={34} className="hero-mark" />)
    expect(svg.getAttribute('width')).toBe('34')
    expect(svg.getAttribute('class')).toBe('hero-mark')
  })

  it('keeps the mark inside its view box', () => {
    const values = PETO_MARK_PATH.match(/-?\d+(?:\.\d+)?/gu)!.map(Number)
    const xs = values.filter((_, index) => index % 2 === 0)
    const ys = values.filter((_, index) => index % 2 === 1)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(PETO_MARK_VIEWBOX.width)
    expect(Math.max(...ys)).toBeLessThanOrEqual(PETO_MARK_VIEWBOX.height)
  })

  it('names the product Peto Agent', () => {
    expect(render(<PetoName />).container.textContent).toBe('Peto Agent')
  })
})
