/** Feed path on the policy origin; Peto Web serves `<channel>.yml` beneath it. */
export const PETO_UPDATE_FEED_PATH: '/api/agent/desktop/update/'

/** Update feed of one unsigned Peto Windows build. */
export interface PetoUpdateFeed {
  readonly channel: 'nightly' | 'stable'
  readonly target: 'win-x64'
  readonly publicUrl: string
}

/**
 * Resolve the feed of one unsigned build from its embedded mandatory-update policy.
 * @param policy Resolved policy of the build; absent for local macOS builds.
 * @param env Packaging environment; an explicit `DSH_DESKTOP_UPDATE_CHANNEL` wins.
 * @param platform Target platform.
 * @param arch Target architecture.
 * @returns Feed, or none for macOS and builds without a policy.
 */
export function resolvePetoUpdateFeed(
  policy: { readonly origin: string } | undefined,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  arch: string,
): PetoUpdateFeed | undefined
