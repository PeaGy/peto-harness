/** Peto: Peto Agent's own Harness home, so it never shares data with an installed DeepSeek Harness. */

import { join } from 'node:path'
import { expect, it } from 'vitest'
import { applyPetoHome } from '../src/peto-home.ts'

it('points DSH_HOME at ~/.peto-agent when nothing names a Harness home', () => {
  const env: NodeJS.ProcessEnv = {}
  expect(applyPetoHome(env, join('C:', 'Users', 'someone'))).toBe(join('C:', 'Users', 'someone', '.peto-agent'))
  expect(env.DSH_HOME).toBe(join('C:', 'Users', 'someone', '.peto-agent'))
})

it('keeps an explicit DSH_HOME and treats a blank one as unset', () => {
  const explicit: NodeJS.ProcessEnv = { DSH_HOME: 'D:\harness' }
  expect(applyPetoHome(explicit, 'C:\Users\someone')).toBe('D:\harness')
  expect(explicit.DSH_HOME).toBe('D:\harness')
  const blank: NodeJS.ProcessEnv = { DSH_HOME: '  ' }
  expect(applyPetoHome(blank, 'C:\Users\someone')).toBe(join('C:\Users\someone', '.peto-agent'))
})
