/** Peto: the account card's daily steps, shown in place of wallet balances on Peto accounts. */
import { IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountDetails } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountKey } from './locales.ts'
import { formatResetTime, formatTokens, stepLevel, stepsLeft } from './peto-steps.ts'
import base from './AccountSection.module.css'
import css from './PetoSteps.module.css'

/** Inputs of the steps card. */
export interface PetoStepsProps {
  /** Balance query outcome; absent while loading. */
  balance: AccountDetails['balance'] | undefined
  /** Peto Web page for this account's devices and steps. */
  manageUrl: string
  t: Translate<AccountKey>
}

/** @param props - today's steps, the Peto Web page and localized copy. @returns the steps card. */
export function PetoSteps({ balance, manageUrl, t }: PetoStepsProps) {
  const steps = balance?.status === 'ready' ? balance.steps : undefined
  const manage = <div className={base.row}>
    <span className={base.secondary}>{t('petoDevices')}</span>
    <div className={base.links}>
      <a className={`${base.linkButton} ${css.manage}`} href={manageUrl} target="_blank" rel="noopener noreferrer">
        {t('petoManage')}<IconRightUpOutlineRegular size={12} />
      </a>
    </div>
  </div>
  if (steps === undefined) return <div className={base.balanceCard}>
    <div className={base.row}>
      <span>{t('petoStepsToday')}</span>
      <span className={base.unavailable}>{t(balance === undefined ? 'loading' : 'petoStepsUnavailable')}</span>
    </div>
    <div className={base.divider} />
    {manage}
  </div>
  const level = stepLevel(steps)
  const left = stepsLeft(steps)
  const time = formatResetTime(steps.resetsAt)
  const tokens = t('petoTokens', { tokens: formatTokens(steps.tokens) })
  return <div className={base.balanceCard} data-step-level={level}>
    <div className={css.summary}>
      {level === 'out'
        ? <span className={`${css.headline} ${css.out}`}>{t('petoNoStepsLeft')}</span>
        : <span className={css.headline}>
          <span className={`${css.count} ${level === 'low' ? css.low : ''}`}>{left}</span>
          <span className={base.secondary}>{t('petoStepsLeftOf', { limit: steps.limit })}</span>
        </span>}
      <div className={css.track} role="meter" aria-label={t('petoStepsToday')} aria-valuemin={0} aria-valuemax={steps.limit}
        aria-valuenow={steps.used} aria-valuetext={t('petoStepsUsed', { used: steps.used, limit: steps.limit })}>
        <div className={css.fill} style={{ width: `${Math.round(steps.used / steps.limit * 100)}%` }} />
      </div>
      <span className={base.secondary}>
        {level === 'out' && time !== undefined && <span className={css.out}>{t('petoNewStepsAt', { time })} </span>}
        {level !== 'out' && time !== undefined ? `${t('petoResets', { time })} · ${tokens}` : tokens}
      </span>
    </div>
    {steps.costs.length > 0 && <>
      <div className={base.divider} />
      <div className={css.costs}>
        <span className={css.label}>{t('petoStepsPerRequest')}</span>
        <ul className={css.costList}>
          {steps.costs.map(cost => <li key={cost.model} className={css.cost}>
            <span>{cost.model}</span><span className={css.value}>{cost.steps}</span>
          </li>)}
        </ul>
        <span className={base.secondary}>{t('petoEffortCost')}</span>
      </div>
    </>}
    <div className={base.divider} />
    {manage}
  </div>
}
