// @vitest-environment jsdom
/** Peto: Peto accounts show daily steps in the account card, the quota notice and onboarding instead of wallets. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuotaNoticeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AccountDetails, AccountSteps, AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '../src/client/index.ts'
import { AccountSection, type AccountSectionInjected, type AccountSnapshot } from '../src/client/AccountSection.tsx'
import { AccountQuotaNotice } from '../src/client/AccountQuotaNotice.tsx'
import { DesktopOnboarding } from '../src/client/DesktopOnboarding.tsx'
import type { DesktopOnboardingProps, DesktopOnboardingState } from '../src/client/onboarding-contract.ts'
import { formatResetTime, formatTokens, stepLevel, stepsLeft } from '../src/client/peto-steps.ts'
import { en, type AccountKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const MANAGE = 'https://peto.example/?settings=agent'
const RESET = '2026-11-06T17:00:00.000Z'
const STEPS: AccountSteps = {
  used: 12, limit: 200, resetsAt: RESET, tokens: 1_234_567,
  costs: [{ model: 'Peto', steps: 1 }, { model: '6 Luna', steps: 1 }, { model: '5.6 Terra', steps: 2 }],
}

/** Translate like the locale service: look the key up and fill `{name}` placeholders. */
function translate(key: string, params?: Record<string, unknown>): string {
  return (key in en ? en[key as AccountKey] : key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : match
  })
}

function view(status: AccountView['status']): AccountView {
  return { status, attempt: null, links: { usageUrl: 'https://peto.example/', topUpUrl: 'https://peto.example/', manageUrl: MANAGE } }
}

const theme: ThemeSnapshot = {
  preference: 'dark', fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' },
  active: { id: 'dark', colorScheme: 'dark', tokens: {} }, themes: [], revision: 0,
}

function section(status: AccountView['status'], details?: Partial<AccountDetails>) {
  const snapshot: AccountSnapshot = { view: view(status), details, avatar: undefined, failed: false }
  const operations: AccountSectionInjected = {
    hooks: {
      account: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      theme: { getSnapshot: () => theme, subscribe: () => () => {} },
    },
    hasRunningAccountTasks: vi.fn(async () => false), showLogin: vi.fn(), setOnboarding: vi.fn(),
    bonusNoticeShown: vi.fn(), bonusNoticeDismissed: vi.fn(), refreshAccount: vi.fn(() => Promise.resolve()), avatarFailed: vi.fn(),
    start: vi.fn(() => Promise.resolve()), cancel: vi.fn(() => Promise.resolve()), signOut: vi.fn(() => Promise.resolve()),
  }
  render(<AccountSection {...({} as GlobalStandardProps)} {...operations}
    useAccount={selector => selector(snapshot)} useTheme={selector => selector(theme)} close={() => {}} t={translate} />)
}

const profile: AccountDetails['profile'] = { status: 'ready', value: { id: null, name: 'Peargy', contact: null, avatarUrl: null } }
const ready = (steps: AccountSteps): AccountDetails['balance'] => ({ status: 'ready', value: [], bonusWallets: [], steps })

it('shows the steps left today, the reset time, tokens and the cost of each model', () => {
  section('credential-stored', { profile, balance: ready(STEPS) })
  const card = screen.getByRole('region', { name: en.nav })
  expect(within(card).getByText('Peargy')).toBeTruthy()
  expect(within(card).getByRole('status').textContent).toBe(en.petoAccount)
  expect(within(card).getByRole('link', { name: en.petoWeb }).getAttribute('href')).toBe('https://peto.example/')
  expect(within(card).getByText('188')).toBeTruthy()
  expect(within(card).getByText('of 200 steps left today')).toBeTruthy()
  const meter = within(card).getByRole('meter', { name: en.petoStepsToday })
  expect(meter.getAttribute('aria-valuenow')).toBe('12')
  expect(meter.getAttribute('aria-valuetext')).toBe('12 of 200 steps used')
  expect(card.textContent).toContain(`Resets at ${formatResetTime(RESET)} · ${formatTokens(1_234_567)} tokens today`)
  expect(within(card).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Peto1', '6 Luna1', '5.6 Terra2'])
  expect(within(card).getByText(en.petoEffortCost)).toBeTruthy()
  expect(within(card).getByRole('link', { name: en.petoManage }).getAttribute('href')).toBe(MANAGE)
  expect(within(card).queryByText(en.balance)).toBeNull()
  expect(within(card).queryByText(en.topUp)).toBeNull()
  expect(card.querySelector('[data-step-level]')?.getAttribute('data-step-level')).toBe('plenty')
})

it('warns when steps run low and says when new steps arrive once they run out', () => {
  section('credential-stored', { profile, balance: ready({ ...STEPS, used: 195 }) })
  expect(document.querySelector('[data-step-level]')?.getAttribute('data-step-level')).toBe('low')
  expect(screen.getByText('5')).toBeTruthy()
  cleanup()
  const { resetsAt: _resetsAt, ...withoutReset } = STEPS
  section('credential-stored', { profile, balance: ready({ ...withoutReset, used: 200 }) })
  const card = screen.getByRole('region', { name: en.nav })
  expect(card.querySelector('[data-step-level]')?.getAttribute('data-step-level')).toBe('out')
  expect(within(card).getByText(en.petoNoStepsLeft)).toBeTruthy()
  expect(card.textContent).not.toContain('New steps at')
  cleanup()
  section('credential-stored', { profile, balance: ready({ ...STEPS, used: 200 }) })
  expect(screen.getByRole('region', { name: en.nav }).textContent).toContain(`New steps at ${formatResetTime(RESET)}.`)
})

it('keeps the Peto Web link when the steps cannot be read, and waits while they load', () => {
  section('credential-stored', { profile, balance: { status: 'failed' } })
  expect(screen.getByText(en.petoStepsUnavailable)).toBeTruthy()
  expect(screen.getByRole('link', { name: en.petoManage }).getAttribute('href')).toBe(MANAGE)
  cleanup()
  section('credential-stored', {})
  expect(screen.getByRole('status').textContent).toBe(en.loading)
  expect(screen.getAllByText(en.loading)).toHaveLength(2)
})

it('invites a signed-out user to sign in with Peto Web instead of offering an API key', () => {
  section('signed-out')
  expect(screen.getByText(en.petoSignedOutDescription)).toBeTruthy()
  expect(screen.queryByText(en.settingsSignedOutDescription)).toBeNull()
})

function quota(details: Partial<AccountDetails>) {
  const snapshot: AccountSnapshot = { view: view('credential-stored'), details, avatar: undefined, failed: false }
  const dismiss = vi.fn()
  const owner: QuotaNoticeOwnerProps = { code: 'ACCOUNT_QUOTA', message: 'Request quota exhausted.', dismiss, keepOpen: vi.fn(() => vi.fn()) }
  render(<AccountQuotaNotice {...({} as GlobalStandardProps)} {...owner} matched={owner} openPlatformPage={vi.fn()}
    useAccount={selector => selector(snapshot)} usePlatformPage={selector => selector(null)} t={translate} />)
  return dismiss
}

it('explains used-up daily steps with the reset time and offers no top-up', () => {
  const dismiss = quota({ balance: ready({ ...STEPS, used: 200 }) })
  const dialog = screen.getByRole('dialog', { name: en.petoQuotaTitle })
  expect(dialog.textContent).toContain(`used all 200 Peto Agent steps for today. New steps arrive at ${formatResetTime(RESET)}.`)
  expect(within(dialog).getByRole('link', { name: en.petoManage }).getAttribute('href')).toBe(MANAGE)
  expect(within(dialog).queryByRole('button', { name: en.quotaTopUp })).toBeNull()
  fireEvent.click(within(dialog).getAllByRole('button', { name: en.close }).at(-1)!)
  expect(dismiss).toHaveBeenCalledOnce()
  cleanup()
  quota({})
  expect(screen.getByRole('dialog', { name: en.petoQuotaTitle }).textContent).toContain(en.petoQuotaDescriptionMidnight)
})

function onboarding() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const update = vi.fn(async (_change: Parameters<DesktopOnboardingProps['update']>[0]) => true)
  function App() {
    const [state, setState] = useState<DesktopOnboardingState>({
      status: 'ready', visible: true, error: null, creditFunded: false,
      progress: { version: 1, step: 'credit', purpose: null, process: null, completion: null, usage: 'compact', developerTools: false },
    })
    return <DesktopOnboarding locale="en" state={state} t={key => en[key]} complete={vi.fn(async () => true)} retry={vi.fn(async () => true)}
      update={async (change) => {
        const saved = await update(change)
        setState(current => ({ ...current, progress: { ...current.progress, ...change } }))
        return saved
      }}
      account={{ view: view('credential-stored'), avatar: undefined, failed: false, details: { balance: ready(STEPS) } }}
      openPlatformPage={vi.fn()} />
  }
  render(<App />)
  return update
}

it('introduces daily steps during onboarding without credits or recharge', async () => {
  const update = onboarding()
  expect(screen.getByRole('heading', { name: en.petoOnboardingTitle })).toBeTruthy()
  expect(screen.getByText(en.petoOnboardingDescription)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.onboardingTopUp })).toBeNull()
  expect(document.querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.onboardingSkip }))
  expect(screen.getByRole('dialog', { name: en.onboardingSkipTitle })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.onboardingKeepSetting }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.onboardingContinue })) })
  expect(update).toHaveBeenCalledWith({ step: 'purpose' })
})

it('derives the step level and formats reset times and token counts', () => {
  expect([0, 179, 180, 199, 200, 230].map(used => stepLevel({ ...STEPS, used }))).toEqual(['plenty', 'plenty', 'low', 'low', 'out', 'out'])
  expect(stepsLeft({ ...STEPS, used: 230 })).toBe(0)
  expect(formatResetTime(undefined)).toBeUndefined()
  expect(formatResetTime('not a time')).toBeUndefined()
  expect(formatResetTime(RESET, 'en-US')).toMatch(/\d{1,2}:00\s?(AM|PM)/)
  expect(formatTokens(1_234_567, 'en-US')).toBe('1.2M')
})
