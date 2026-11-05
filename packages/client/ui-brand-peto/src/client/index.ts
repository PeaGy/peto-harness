/** Peto occupants: the sidebar and home-hero brand marks, plus the product name in release builds. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PetoMark, PetoName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the brand marks in every build; an `official` build also names the product, where a local build keeps the
 * sidebar's local-build label and version.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PetoMark))
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') {
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, PetoMark))
    return
  }
  // One registration set, as in ui-brand-official, so the mark and the name never mix with fallbacks during HMR.
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PetoMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, PetoName)
    }))
}
