/**
 * Peto: update feed of unsigned Windows releases.
 *
 * Every Peto release is unsigned, which upstream treats as a local build without automatic updates. Peto Web, the
 * origin that already answers the mandatory-update policy, serves the feed instead of DeepSeek's download host. With no
 * publisher in `app-update.yml`, electron-updater checks only the installer's SHA-512 from the feed. macOS stays
 * without a feed: Squirrel.Mac refuses unsigned updates.
 */

import { resolveDesktopAutoUpdateTarget, resolveDesktopUpdateChannel } from './desktop-auto-update-environment.mjs'

/** Feed path on the policy origin; Peto Web serves `<channel>.yml` beneath it. */
export const PETO_UPDATE_FEED_PATH = '/api/agent/desktop/update/'

/**
 * Resolve the feed of one unsigned build from its embedded mandatory-update policy.
 * @param {{ origin: string } | undefined} policy Resolved policy of the build; absent for local macOS builds.
 * @param {NodeJS.ProcessEnv} env Packaging environment; an explicit `DSH_DESKTOP_UPDATE_CHANNEL` wins.
 * @param {NodeJS.Platform} platform Target platform.
 * @param {string} arch Target architecture.
 * @returns {{ channel: 'nightly' | 'stable', target: 'win-x64', publicUrl: string } | undefined} Feed, or none.
 */
export function resolvePetoUpdateFeed(policy, env, platform, arch) {
  if (policy === undefined || platform !== 'win32') return undefined
  const target = resolveDesktopAutoUpdateTarget(platform, arch)
  const channel = env.DSH_DESKTOP_UPDATE_CHANNEL ? resolveDesktopUpdateChannel(env) : 'stable'
  return { channel, target, publicUrl: `${policy.origin}${PETO_UPDATE_FEED_PATH}${target}/` }
}
