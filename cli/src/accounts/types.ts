export interface FreebucksInfo {
  dailyRemaining: number
  dailyLimit: number
  dailySpent: number
  wallet: number
  total: number
  resetAt?: string
}

export interface SessionRateLimitInfo {
  limit: number
  recentCount: number
  resetAt?: string
}

export type AccountStatus =
  | 'ready'
  | 'rate_limited'
  | 'spend_limited'
  | 'country_blocked'
  | 'banned'
  | 'unauthorized'
  | 'unknown'

export interface AccountProfile {
  name: string
  email: string
  userId?: string
  authToken: string
  fingerprintId?: string
  fingerprintHash?: string
  configDir: string
  addedAt: string
  lastUsedAt?: string
  lastCheckedAt?: string
  status: AccountStatus
  statusMessage?: string
  freebucks?: FreebucksInfo
  rateLimit?: SessionRateLimitInfo
}

export interface AccountsRegistry {
  activeAccount: string | null
  autoSwitchOnLimit: boolean
  accounts: Record<string, AccountProfile>
}
