import './init-env'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

import { generateLoginUrl, pollLoginStatus } from '../login/login-flow'
import { getFingerprintId } from '../utils/fingerprint'
import { logger } from '../utils/logger'
import { LOGIN_WEBSITE_URL } from '../login/constants'

import type {
  AccountProfile,
  AccountsRegistry,
  AccountStatus,
  FreebucksInfo,
  SessionRateLimitInfo,
} from './types'

const BASE_PROFILES_DIR = path.join(os.homedir(), '.config', 'freebuff', 'profiles')
const REGISTRY_FILE = path.join(BASE_PROFILES_DIR, 'registry.json')
const DEFAULT_MANICODE_DIR = path.join(os.homedir(), '.config', 'manicode')
const API_BASE_URL = (process.env.NEXT_PUBLIC_CODEBUFF_APP_URL || 'https://www.codebuff.com').replace(/\/$/, '')

export function getProfilesDir(): string {
  const dir =
    process.env.FREEBUFF_PROFILES_DIR ||
    path.join(os.homedir(), '.config', 'freebuff', 'profiles')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  return dir
}

export function getRegistryFile(): string {
  return path.join(getProfilesDir(), 'registry.json')
}

export function getAccountConfigDir(accountName: string): string {
  const profileDir = path.join(getProfilesDir(), accountName)
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  }
  return profileDir
}

export function loadRegistry(): AccountsRegistry {
  const registryFile = getRegistryFile()
  try {
    if (fs.existsSync(registryFile)) {
      const data = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
      if (data && typeof data === 'object') {
        const registry: AccountsRegistry = {
          activeAccount: data.activeAccount ?? null,
          autoSwitchOnLimit: Boolean(data.autoSwitchOnLimit ?? true),
          accounts: data.accounts ?? {},
        }
        return registry
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Could not read accounts registry, initializing new')
  }

  const initialRegistry: AccountsRegistry = {
    activeAccount: null,
    autoSwitchOnLimit: true,
    accounts: {},
  }

  // Attempt auto-import of existing ~/.config/freebuff-desktop credentials if found
  try {
    const desktopStatePath = path.join(
      os.homedir(),
      '.config',
      'freebuff-desktop',
      'state.json',
    )
    if (fs.existsSync(desktopStatePath)) {
      const stateData = JSON.parse(fs.readFileSync(desktopStatePath, 'utf8'))
      const sessions = stateData?.authSessions
      if (sessions && typeof sessions === 'object') {
        for (const session of Object.values(sessions) as any[]) {
          if (session?.token && session?.user?.email) {
            const accountName = 'main'
            const profileDir = getAccountConfigDir(accountName)
            const credentials = {
              default: {
                name: session.user.name || accountName,
                email: session.user.email,
                id: session.user.id,
                authToken: session.token,
              },
            }
            fs.writeFileSync(
              path.join(profileDir, 'credentials.json'),
              JSON.stringify(credentials, null, 2),
              { mode: 0o600 },
            )

            initialRegistry.accounts[accountName] = {
              name: accountName,
              email: session.user.email,
              userId: session.user.id,
              authToken: session.token,
              configDir: profileDir,
              addedAt: new Date().toISOString(),
              status: 'ready',
            }
            initialRegistry.activeAccount = accountName
            saveRegistry(initialRegistry)
            return initialRegistry
          }
        }
      }
    }
  } catch {
    // Non-fatal if desktop state could not be read
  }

  // Attempt auto-import of existing ~/.config/manicode credentials if found
  try {
    const defaultCredsPath = path.join(DEFAULT_MANICODE_DIR, 'credentials.json')
    if (fs.existsSync(defaultCredsPath)) {
      const parsed = JSON.parse(fs.readFileSync(defaultCredsPath, 'utf8'))
      const defaultUser = parsed.default
      if (defaultUser && defaultUser.authToken && !defaultUser.email?.includes('test.com')) {
        const profileDir = path.join(getProfilesDir(), 'default')
        if (!fs.existsSync(profileDir)) {
          fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 })
        }
        fs.writeFileSync(
          path.join(profileDir, 'credentials.json'),
          JSON.stringify({ default: defaultUser }, null, 2),
          { mode: 0o600 },
        )

        initialRegistry.accounts['default'] = {
          name: 'default',
          email: defaultUser.email || 'default@freebuff',
          userId: defaultUser.id,
          authToken: defaultUser.authToken,
          fingerprintId: defaultUser.fingerprintId,
          fingerprintHash: defaultUser.fingerprintHash,
          configDir: profileDir,
          addedAt: new Date().toISOString(),
          status: 'ready',
        }
        initialRegistry.activeAccount = 'default'
        saveRegistry(initialRegistry)
      }
    }
  } catch {
    // Non-fatal if default credentials could not be imported
  }

  return initialRegistry
}

export function saveRegistry(registry: AccountsRegistry): void {
  try {
    const registryFile = getRegistryFile()
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), {
      mode: 0o600,
    })
  } catch (err) {
    logger.error({ err }, 'Failed to save accounts registry')
    throw err
  }
}

export function getActiveAccount(): AccountProfile | null {
  const registry = loadRegistry()
  if (!registry.activeAccount) return null
  return registry.accounts[registry.activeAccount] || null
}

export function listAccounts(): AccountProfile[] {
  const registry = loadRegistry()
  return Object.values(registry.accounts)
}

export function getAccount(name: string): AccountProfile | null {
  const registry = loadRegistry()
  return registry.accounts[name] || null
}

export function switchAccount(name: string): AccountProfile {
  const registry = loadRegistry()
  const account = registry.accounts[name]
  if (!account) {
    throw new Error(`Account '${name}' not found. Use 'list' to see available accounts.`)
  }

  registry.activeAccount = name
  account.lastUsedAt = new Date().toISOString()
  saveRegistry(registry)

  // 1. Update active process environment so getConfigDir() points to the switched profile
  process.env.FREEBUFF_CONFIG_DIR = account.configDir

  // 2. Ensure profile directory and credentials.json exist with latest authToken
  try {
    if (!fs.existsSync(account.configDir)) {
      fs.mkdirSync(account.configDir, { recursive: true, mode: 0o700 })
    }
    const profileCreds = {
      default: {
        id: account.userId || 'user_' + account.name,
        name: account.name,
        email: account.email,
        authToken: account.authToken,
        fingerprintId: account.fingerprintId,
        fingerprintHash: account.fingerprintHash,
      },
    }
    fs.writeFileSync(
      path.join(account.configDir, 'credentials.json'),
      JSON.stringify(profileCreds, null, 2),
      { mode: 0o600 },
    )
  } catch (error) {
    logger.debug({ error }, 'Could not write credentials to profile dir')
  }

  // 3. Update in-memory keychain cache, api client token, and reset SDK client
  try {
    const { setCachedKeychainToken } = require('../utils/auth-token-store')
    setCachedKeychainToken(account.authToken)
  } catch {}
  try {
    const { setApiClientAuthToken } = require('../utils/codebuff-api')
    setApiClientAuthToken(account.authToken)
  } catch {}
  try {
    const { resetCodebuffClient } = require('../utils/codebuff-client')
    resetCodebuffClient()
  } catch {}

  // 4. Sync credentials to ~/.config/manicode/credentials.json for backward compatibility
  try {
    if (!fs.existsSync(DEFAULT_MANICODE_DIR)) {
      fs.mkdirSync(DEFAULT_MANICODE_DIR, { recursive: true, mode: 0o700 })
    }
    const credContent = {
      default: {
        id: account.userId,
        name: account.name,
        email: account.email,
        authToken: account.authToken,
        fingerprintId: account.fingerprintId,
        fingerprintHash: account.fingerprintHash,
      },
    }
    fs.writeFileSync(
      path.join(DEFAULT_MANICODE_DIR, 'credentials.json'),
      JSON.stringify(credContent, null, 2),
      { mode: 0o600 },
    )
  } catch (error) {
    logger.debug({ error }, 'Could not sync credentials to default config dir')
  }

  // Sync to Freebuff Desktop state.json if present
  try {
    const desktopStatePath = path.join(
      os.homedir(),
      '.config',
      'freebuff-desktop',
      'state.json',
    )
    if (fs.existsSync(desktopStatePath)) {
      const desktopState = JSON.parse(fs.readFileSync(desktopStatePath, 'utf8'))
      if (!desktopState.authSessions) desktopState.authSessions = {}
      desktopState.authSessions['https://www.codebuff.com'] = {
        token: account.authToken,
        user: {
          id: account.userId || 'user_' + account.name,
          email: account.email,
          name: account.name,
        },
      }
      fs.writeFileSync(
        desktopStatePath,
        JSON.stringify(desktopState, null, 2),
        { mode: 0o600 },
      )
    }

    // Clean up stale session locks in freebuff-desktop
    const sessionEndsPath = path.join(
      os.homedir(),
      '.config',
      'freebuff-desktop',
      'state.json.session-ends.json',
    )
    if (fs.existsSync(sessionEndsPath)) {
      try {
        const sessions = JSON.parse(fs.readFileSync(sessionEndsPath, 'utf8'))
        if (Array.isArray(sessions)) {
          for (const s of sessions) {
            s.active = false
          }
          fs.writeFileSync(sessionEndsPath, JSON.stringify(sessions, null, 2))
        }
      } catch {}
    }
  } catch (error) {
    logger.debug({ error }, 'Could not sync credentials to freebuff-desktop state')
  }

  // Best-effort release of stale server slot
  void releaseSessionSlot(account.authToken)

  return account
}

export async function releaseSessionSlot(authToken: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/v1/freebuff/session`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })
  } catch {
    // Non-fatal
  }
}

export async function checkAccountStatus(accountName: string): Promise<AccountProfile> {
  const registry = loadRegistry()
  const account = registry.accounts[accountName]
  if (!account) {
    throw new Error(`Account '${accountName}' not found`)
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/freebuff/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${account.authToken}`,
        'x-freebuff-multi-session': '1',
        'x-freebuff-include-unused-rate-limits': '1',
      },
    })

    account.lastCheckedAt = new Date().toISOString()

    if (response.status === 401 || response.status === 403) {
      account.status = 'unauthorized'
      account.statusMessage = 'Token expired or unauthorized'
    } else if (response.ok) {
      const data = (await response.json()) as any

      if (data.status === 'rate_limited') {
        account.status = 'rate_limited'
        account.statusMessage = 'Rate limit reached'
      } else if (data.status === 'banned') {
        account.status = 'banned'
        account.statusMessage = 'Account suspended'
      } else if (data.status === 'country_blocked') {
        account.status = 'country_blocked'
        account.statusMessage = 'Country blocked / VPN detected'
      } else {
        account.status = 'ready'
        account.statusMessage = undefined
      }

      // Parse Freebucks
      if (data.freebucks) {
        const daily = data.freebucks.daily || {}
        const walletBalance =
          typeof data.freebucks.wallet === 'object' && data.freebucks.wallet !== null
            ? (data.freebucks.wallet.balance ?? 0)
            : Number(data.freebucks.wallet) || 0
        const dailyRemaining = Number(daily.remaining) || 0
        const total =
          typeof data.freebucks.balance === 'number'
            ? data.freebucks.balance
            : dailyRemaining + walletBalance

        const freebucksInfo: FreebucksInfo = {
          dailyRemaining,
          dailyLimit: Number(daily.limit) || 0,
          dailySpent: Number(daily.spent) || 0,
          wallet: walletBalance,
          total,
          resetAt: daily.resetAt,
        }
        account.freebucks = freebucksInfo

        if (freebucksInfo.total <= 0 && account.status === 'ready') {
          account.status = 'rate_limited'
          account.statusMessage = 'Out of Freebucks'
        }
      }

      // Parse Session Rate Limit
      if (data.rateLimit) {
        const rateLimitInfo: SessionRateLimitInfo = {
          limit: data.rateLimit.limit ?? 0,
          recentCount: data.rateLimit.recentCount ?? 0,
          resetAt: data.rateLimit.resetAt,
        }
        account.rateLimit = rateLimitInfo

        if (
          rateLimitInfo.recentCount >= rateLimitInfo.limit &&
          rateLimitInfo.limit > 0 &&
          account.status === 'ready'
        ) {
          account.status = 'rate_limited'
          account.statusMessage = 'Sessions quota exhausted'
        }
      }
    } else {
      account.status = 'unknown'
      account.statusMessage = `HTTP ${response.status}`
    }
  } catch (error) {
    account.status = 'unknown'
    account.statusMessage = error instanceof Error ? error.message : String(error)
  }

  registry.accounts[accountName] = account
  saveRegistry(registry)
  return account
}

export async function checkAllAccounts(): Promise<AccountProfile[]> {
  const accounts = listAccounts()
  const results: AccountProfile[] = []
  for (const acc of accounts) {
    try {
      const updated = await checkAccountStatus(acc.name)
      results.push(updated)
    } catch {
      results.push(acc)
    }
  }
  return results
}

export function markAccountLimited(
  name: string,
  reason?: string,
  remainingFreebucks?: number,
): void {
  const registry = loadRegistry()
  const acc = registry.accounts[name]
  if (!acc) return
  acc.status = 'rate_limited'
  acc.statusMessage = reason || 'Rate limited or insufficient Freebucks'
  if (remainingFreebucks !== undefined) {
    if (!acc.freebucks) {
      acc.freebucks = {
        dailyRemaining: remainingFreebucks,
        dailyLimit: 25,
        dailySpent: 25 - remainingFreebucks,
        wallet: 0,
        total: remainingFreebucks,
      }
    } else {
      acc.freebucks.total = remainingFreebucks
      acc.freebucks.dailyRemaining = remainingFreebucks
    }
  }
  saveRegistry(registry)
}

export function isAccountReady(acc: AccountProfile, minFreebucks: number = 1): boolean {
  if (acc.status === 'banned' || acc.status === 'unauthorized') {
    return false
  }
  if (acc.freebucks !== undefined && acc.freebucks.total < minFreebucks) {
    return false
  }
  if (acc.status === 'rate_limited') {
    // Check if reset time has passed
    const resetTimeStr = acc.freebucks?.resetAt || acc.rateLimit?.resetAt
    if (resetTimeStr) {
      const resetTime = new Date(resetTimeStr).getTime()
      if (Date.now() >= resetTime) {
        return true
      }
    }
    return false
  }
  return true
}

export function getNextAvailableAccount(
  minFreebucks: number = 1,
  excludeNames: string[] = [],
): {
  previous: AccountProfile | null
  next: AccountProfile | null
  reason: string
} {
  const registry = loadRegistry()
  const accounts = Object.values(registry.accounts)
  if (accounts.length === 0) {
    return { previous: null, next: null, reason: 'No accounts registered' }
  }

  const currentActive = registry.activeAccount
    ? registry.accounts[registry.activeAccount] ?? null
    : null

  const excluded = new Set([registry.activeAccount, ...excludeNames].filter(Boolean))

  // Prioritize other accounts that are ready with at least minFreebucks
  const otherReady = accounts.filter(
    (acc) => !excluded.has(acc.name) && isAccountReady(acc, minFreebucks),
  )

  if (otherReady.length > 0) {
    // Pick the one with the most Freebucks or earliest used
    otherReady.sort((a, b) => {
      const fbA = a.freebucks?.total ?? 25
      const fbB = b.freebucks?.total ?? 25
      return fbB - fbA
    })
    return {
      previous: currentActive,
      next: otherReady[0],
      reason: `Found ready account with ${otherReady[0].freebucks?.total ?? 25} Freebucks`,
    }
  }

  // If excludeNames excluded candidates, see if any ready account outside current active is available
  if (excludeNames.length > 0) {
    const fallbackReady = accounts.filter(
      (acc) => acc.name !== registry.activeAccount && isAccountReady(acc, minFreebucks),
    )
    if (fallbackReady.length > 0) {
      fallbackReady.sort((a, b) => {
        const fbA = a.freebucks?.total ?? 25
        const fbB = b.freebucks?.total ?? 25
        return fbB - fbA
      })
      return {
        previous: currentActive,
        next: fallbackReady[0],
        reason: `Found ready account with ${fallbackReady[0].freebucks?.total ?? 25} Freebucks`,
      }
    }
  }

  // Check if any other account has any Freebucks (> 0)
  const anyOtherWithFb = accounts.filter(
    (acc) =>
      acc.name !== registry.activeAccount &&
      acc.status !== 'banned' &&
      acc.status !== 'unauthorized' &&
      (acc.freebucks?.total ?? 25) > 0,
  )
  if (anyOtherWithFb.length > 0) {
    anyOtherWithFb.sort((a, b) => (b.freebucks?.total ?? 25) - (a.freebucks?.total ?? 25))
    return {
      previous: currentActive,
      next: anyOtherWithFb[0],
      reason: `Found account with ${anyOtherWithFb[0].freebucks?.total ?? 25} Freebucks`,
    }
  }

  // If all are limited, find the one with the soonest reset time
  const accountsWithReset = accounts.filter(
    (a) => a.freebucks?.resetAt || a.rateLimit?.resetAt,
  )
  if (accountsWithReset.length > 0) {
    accountsWithReset.sort((a, b) => {
      const timeA = new Date(a.freebucks?.resetAt || a.rateLimit?.resetAt || '').getTime()
      const timeB = new Date(b.freebucks?.resetAt || a.rateLimit?.resetAt || '').getTime()
      return timeA - timeB
    })
    return {
      previous: currentActive,
      next: accountsWithReset[0],
      reason: 'All accounts limited; chosen account with earliest reset time',
    }
  }

  // Fallback to any other account
  const candidate = accounts.find((a) => a.name !== registry.activeAccount) || accounts[0]
  return {
    previous: currentActive,
    next: candidate,
    reason: 'Rotated to next configured profile',
  }
}

export function switchNext(
  minFreebucks: number = 1,
  excludeNames: string[] = [],
): {
  previous: AccountProfile | null
  next: AccountProfile
  reason: string
} {
  const { previous, next, reason } = getNextAvailableAccount(minFreebucks, excludeNames)
  if (!next) {
    throw new Error('No accounts available to switch to')
  }
  switchAccount(next.name)
  return { previous, next, reason }
}

const failedInActiveRun = new Set<string>()

export function autoSwitchAccount(
  reason: string,
  minFreebucks: number = 10,
): { switched: boolean; previous?: AccountProfile | null; next?: AccountProfile } {
  try {
    const reg = loadRegistry()
    if (!reg.autoSwitchOnLimit) return { switched: false }

    const previousName = reg.activeAccount
    if (previousName) {
      failedInActiveRun.add(previousName)
      markAccountLimited(previousName, reason)
    }

    const { previous, next } = switchNext(
      minFreebucks,
      Array.from(failedInActiveRun),
    )
    if (!next || next.name === previous?.name) return { switched: false }

    // Synchronize UI stores
    try {
      const { useAccountModalStore } = require('../state/account-modal-store')
      useAccountModalStore.getState().loadAccounts()
    } catch {}

    try {
      const { useFreebuffSessionStore } = require('../state/freebuff-session-store')
      useFreebuffSessionStore.getState().setSession(null)
      useFreebuffSessionStore.getState().setFailure(null)
    } catch {}

    try {
      const { useFreebuffChatStore } = require('../state/freebuff-chat-store')
      const currentAdmission = useFreebuffChatStore.getState().admission
      const targetModel = currentAdmission?.model || 'z-ai/glm-5.3-flash'
      useFreebuffChatStore.setState({
        admission: {
          phase: 'starting',
          model: targetModel,
          metadataChecked: true,
        },
      })
      const { startFreebuffSession } = require('../hooks/use-freebuff-session')
      void startFreebuffSession(targetModel, {
        preserveQueue: true,
        persistSelection: false,
      }).catch(() => {})
    } catch {}


    return { switched: true, previous, next }
  } catch {
    return { switched: false }
  }
}

export async function importAccount(
  name: string,
  authToken: string,
  customEmail?: string,
): Promise<AccountProfile> {
  const cleanToken = authToken.trim().replace(/^Bearer\s+/i, '')
  if (!cleanToken) {
    throw new Error('Auth token cannot be empty')
  }

  let email = customEmail || ''
  let userId: string | undefined

  try {
    const meRes = await fetch(`${API_BASE_URL}/api/v1/me?fields=id,email`, {
      headers: { Authorization: `Bearer ${cleanToken}` },
    })
    if (meRes.ok) {
      const meData = (await meRes.json()) as any
      if (meData.email) email = meData.email
      if (meData.id) userId = meData.id
    }
  } catch {
    // Non-fatal, use fallback or user-provided email
  }

  if (!email) {
    email = `${name}@freebuff.local`
  }

  const profileDir = getAccountConfigDir(name)
  const creds = {
    default: {
      id: userId,
      name,
      email,
      authToken: cleanToken,
    },
  }

  fs.writeFileSync(
    path.join(profileDir, 'credentials.json'),
    JSON.stringify(creds, null, 2),
    { mode: 0o600 },
  )

  const profile: AccountProfile = {
    name,
    email,
    userId,
    authToken: cleanToken,
    configDir: profileDir,
    addedAt: new Date().toISOString(),
    status: 'ready',
  }

  const registry = loadRegistry()
  registry.accounts[name] = profile
  if (!registry.activeAccount) {
    registry.activeAccount = name
  }
  saveRegistry(registry)

  // Verify and update status
  try {
    return await checkAccountStatus(name)
  } catch {
    return profile
  }
}

export async function addAccountInteractive(
  name: string,
  onUrlReady?: (url: string) => void,
): Promise<AccountProfile> {
  const profileDir = getAccountConfigDir(name)
  const fingerprintId = await getFingerprintId()

  const loginData = await generateLoginUrl(
    { logger },
    { baseUrl: LOGIN_WEBSITE_URL, fingerprintId, via: 'plain_command' },
  )

  if (onUrlReady) {
    onUrlReady(loginData.loginUrl)
  }

  const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

  const result = await pollLoginStatus(
    { sleep, logger },
    {
      baseUrl: LOGIN_WEBSITE_URL,
      fingerprintId,
      fingerprintHash: loginData.fingerprintHash,
      expiresAt: loginData.expiresAt,
      via: 'plain_command',
    },
  )

  if (result.status !== 'success' || !result.user) {
    throw new Error(`Login failed: ${result.status}`)
  }

  const user = result.user as any
  const authToken = user.authToken as string

  const creds = {
    default: {
      id: user.id,
      name: user.name || name,
      email: user.email,
      authToken,
      fingerprintId,
      fingerprintHash: loginData.fingerprintHash,
    },
  }

  fs.writeFileSync(
    path.join(profileDir, 'credentials.json'),
    JSON.stringify(creds, null, 2),
    { mode: 0o600 },
  )

  const profile: AccountProfile = {
    name,
    email: user.email || `${name}@freebuff`,
    userId: user.id,
    authToken,
    fingerprintId,
    fingerprintHash: loginData.fingerprintHash,
    configDir: profileDir,
    addedAt: new Date().toISOString(),
    status: 'ready',
  }

  const registry = loadRegistry()
  registry.accounts[name] = profile
  if (!registry.activeAccount) {
    registry.activeAccount = name
  }
  saveRegistry(registry)

  // Fetch quota & freebucks
  try {
    return await checkAccountStatus(name)
  } catch {
    return profile
  }
}

export function removeAccount(name: string): boolean {
  const registry = loadRegistry()
  if (!registry.accounts[name]) return false

  delete registry.accounts[name]
  if (registry.activeAccount === name) {
    const remaining = Object.keys(registry.accounts)
    registry.activeAccount = remaining.length > 0 ? remaining[0] : null
  }
  saveRegistry(registry)

  // Clean directory
  try {
    const profileDir = path.join(getProfilesDir(), name)
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true })
    }
  } catch {
    // Non-fatal
  }

  return true
}

export function setAutoSwitch(enabled: boolean): void {
  const registry = loadRegistry()
  registry.autoSwitchOnLimit = enabled
  saveRegistry(registry)
}
