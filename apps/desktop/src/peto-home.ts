/**
 * Peto: Peto Agent keeps its own Harness home, so an installed DeepSeek Harness and Peto Agent never share
 * sessions, settings, plugins or sign-ins. An explicit `DSH_HOME` still wins.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { DSH_HOME_ENV } from '@deepseek-ai/dsh-home-paths'

/** Directory under the user's home that holds Peto Agent's Harness home by default. */
export const PETO_HOME_DIR_NAME = '.peto-agent'

/**
 * Point `DSH_HOME` at Peto Agent's own Harness home unless the environment already names one.
 * @param env - Environment to update; the Host and every child process inherit it.
 * @param home - User home directory.
 * @returns The Harness home now in effect.
 */
export function applyPetoHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const current = env[DSH_HOME_ENV]?.trim()
  if (current !== undefined && current !== '') return current
  const petoHome = join(home, PETO_HOME_DIR_NAME)
  env[DSH_HOME_ENV] = petoHome
  return petoHome
}
