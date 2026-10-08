import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  isAccountReady,
  getNextAvailableAccount,
  loadRegistry,
  saveRegistry,
  switchAccount,
} from '../account-manager'
import type { AccountProfile, AccountsRegistry } from '../types'

describe('Account Manager', () => {
  const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-acc-test-'))

  beforeAll(() => {
    process.env.FREEBUFF_PROFILES_DIR = tempTestDir
  })

  afterAll(() => {
    delete process.env.FREEBUFF_PROFILES_DIR
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true })
    } catch {}
  })
  it('determines account readiness correctly based on status and reset time', () => {
    const readyAcc: AccountProfile = {
      name: 'acc1',
      email: 'a1@test.com',
      authToken: 'tok1',
      configDir: '/fake/dir1',
      addedAt: new Date().toISOString(),
      status: 'ready',
      freebucks: {
        dailyRemaining: 25,
        dailyLimit: 25,
        dailySpent: 0,
        wallet: 0,
        total: 25,
      },
    }

    expect(isAccountReady(readyAcc)).toBe(true)

    const limitedAcc: AccountProfile = {
      ...readyAcc,
      status: 'rate_limited',
      freebucks: {
        dailyRemaining: 0,
        dailyLimit: 25,
        dailySpent: 25,
        wallet: 0,
        total: 0,
        resetAt: new Date(Date.now() + 3600_000).toISOString(), // 1h in future
      },
    }

    expect(isAccountReady(limitedAcc)).toBe(false)

    const resetPassedAcc: AccountProfile = {
      ...limitedAcc,
      freebucks: {
        ...limitedAcc.freebucks!,
        resetAt: new Date(Date.now() - 1000).toISOString(), // already in past
      },
    }

    expect(isAccountReady(resetPassedAcc)).toBe(true)

    const bannedAcc: AccountProfile = {
      ...readyAcc,
      status: 'banned',
    }
    expect(isAccountReady(bannedAcc)).toBe(false)
  })

  it('selects ready account over limited account', () => {
    const reg: AccountsRegistry = {
      activeAccount: 'main',
      autoSwitchOnLimit: true,
      accounts: {
        main: {
          name: 'main',
          email: 'main@test.com',
          authToken: 'tok_main',
          configDir: '/fake/main',
          addedAt: new Date().toISOString(),
          status: 'rate_limited',
          freebucks: {
            dailyRemaining: 0,
            dailyLimit: 25,
            dailySpent: 25,
            wallet: 0,
            total: 0,
            resetAt: new Date(Date.now() + 3600_000).toISOString(),
          },
        },
        spare: {
          name: 'spare',
          email: 'spare@test.com',
          authToken: 'tok_spare',
          configDir: '/fake/spare',
          addedAt: new Date().toISOString(),
          status: 'ready',
          freebucks: {
            dailyRemaining: 25,
            dailyLimit: 25,
            dailySpent: 0,
            wallet: 0,
            total: 25,
          },
        },
      },
    }

    saveRegistry(reg)
    const result = getNextAvailableAccount()
    expect(result.next).not.toBeNull()
    expect(result.next?.name).toBe('spare')
  })
})
