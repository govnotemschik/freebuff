#!/usr/bin/env bun
import './init-env'
import { spawn } from 'child_process'
import path from 'path'
import {
  bold,
  cyan,
  dim,
  gray,
  green,
  red,
  white,
  yellow,
} from 'picocolors'

import { safeOpen } from '../utils/open-url'
import {
  addAccountInteractive,
  checkAccountStatus,
  checkAllAccounts,
  getAccount,
  getActiveAccount,
  getAccountConfigDir,
  importAccount,
  listAccounts,
  loadRegistry,
  removeAccount,
  setAutoSwitch,
  switchAccount,
  switchNext,
} from './account-manager'
import type { AccountProfile, AccountStatus } from './types'

function formatCountdown(isoDate?: string): string {
  if (!isoDate) return '-'
  const diffMs = new Date(isoDate).getTime() - Date.now()
  if (diffMs <= 0) return 'ready'
  const diffSec = Math.floor(diffMs / 1000)
  const hours = Math.floor(diffSec / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  const seconds = diffSec % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatStatus(status: AccountStatus, message?: string): string {
  switch (status) {
    case 'ready':
      return green('● Ready')
    case 'rate_limited':
      return yellow(`● Limited${message ? ` (${message})` : ''}`)
    case 'spend_limited':
      return yellow('● Spend limit')
    case 'country_blocked':
      return red('● Country blocked')
    case 'banned':
      return red('● Suspended')
    case 'unauthorized':
      return red('● Auth invalid')
    default:
      return dim('○ Unknown')
  }
}

function pad(str: string, len: number): string {
  // Strip ANSI color length for proper padding
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '')
  const diff = len - stripped.length
  return diff > 0 ? str + ' '.repeat(diff) : str
}

export async function showAccountsTable(refresh = false): Promise<void> {
  const registry = loadRegistry()
  let accounts = listAccounts()

  if (accounts.length === 0) {
    console.log()
    console.log(yellow('No Freebuff accounts registered yet.'))
    console.log()
    console.log('To add an account, run:')
    console.log(cyan('  freebuff-accounts add <alias>'))
    console.log('or import via token:')
    console.log(cyan('  freebuff-accounts import <alias> <token>'))
    console.log()
    return
  }

  if (refresh) {
    process.stdout.write(dim('Refreshing accounts status from server...\r'))
    accounts = await checkAllAccounts()
    process.stdout.write('                                        \r')
  }

  console.log()
  console.log(bold(cyan('  Freebuff Multi-Account Manager')))
  console.log(gray('  ' + '─'.repeat(82)))

  const header = `  ${pad('', 3)} ${pad('NAME', 14)} ${pad('EMAIL', 26)} ${pad('STATUS', 14)} ${pad('FREEBUCKS', 11)} ${pad('RESETS', 9)}`
  console.log(bold(white(header)))
  console.log(gray('  ' + '─'.repeat(82)))

  for (const acc of accounts) {
    const isActive = registry.activeAccount === acc.name
    const activeMarker = isActive ? green(' * ') : '   '
    const nameStr = isActive ? bold(cyan(acc.name)) : acc.name

    const fb = acc.freebucks
      ? `${acc.freebucks.total} FB`
      : dim('-')

    const resetStr = formatCountdown(
      acc.freebucks?.resetAt || acc.rateLimit?.resetAt,
    )

    const row = `  ${activeMarker} ${pad(nameStr, 14)} ${pad(acc.email || '-', 26)} ${pad(formatStatus(acc.status), 14)} ${pad(fb, 11)} ${pad(resetStr, 9)}`
    console.log(row)
  }

  console.log(gray('  ' + '─'.repeat(82)))

  const activeAcc = getActiveAccount()
  if (activeAcc) {
    console.log(
      `  Active account: ${bold(green(activeAcc.name))} (${activeAcc.email}) | Auto-switch: ${
        registry.autoSwitchOnLimit ? green('ENABLED') : yellow('DISABLED')
      }`,
    )
  } else {
    console.log(yellow('  No active account selected. Run: freebuff-accounts switch <name>'))
  }
  console.log()
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const cleanArgs: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--cwd' || a === '--account') {
      i++
      continue
    }
    if (a === 'account' || a === 'accounts') {
      continue
    }
    cleanArgs.push(a)
  }

  const [subcommand, ...args] = cleanArgs

  switch (subcommand) {
    case 'list':
    case 'ls':
    case undefined: {
      const shouldRefresh = args.includes('--refresh') || args.includes('-r')
      await showAccountsTable(shouldRefresh)
      break
    }

    case 'check':
    case 'status': {
      await showAccountsTable(true)
      break
    }

    case 'switch':
    case 'use': {
      const targetName = args[0]
      if (!targetName) {
        console.error(red('Usage: freebuff-accounts switch <name>'))
        process.exit(1)
      }
      try {
        const switched = switchAccount(targetName)
        console.log(green(`\n✔ Switched active account to: ${bold(switched.name)} (${switched.email})\n`))
      } catch (err: any) {
        console.error(red(`\n✖ ${err.message}\n`))
        process.exit(1)
      }
      break
    }

    case 'next': {
      try {
        const { previous, next, reason } = switchNext()
        const prevText = previous ? previous.name : 'none'
        console.log(
          green(`\n✔ Rotated account: ${cyan(prevText)} → ${bold(green(next.name))} (${next.email})`),
        )
        console.log(dim(`  Reason: ${reason}`))
        if (next.freebucks) {
          console.log(dim(`  Balance: ${next.freebucks.total} Freebucks`))
        }
        console.log()
      } catch (err: any) {
        console.error(red(`\n✖ ${err.message}\n`))
        process.exit(1)
      }
      break
    }

    case 'add': {
      const name = args[0]
      if (!name) {
        console.error(red('Usage: freebuff-accounts add <alias>'))
        process.exit(1)
      }

      console.log(bold(`\nAdding account '${name}'...`))
      console.log('Generating login authorization link...\n')

      try {
        const profile = await addAccountInteractive(name, (url) => {
          console.log(bold('Open this URL in your browser to log in:'))
          console.log(cyan(url))
          console.log(yellow('\nOpening browser and waiting for confirmation...'))
          void safeOpen(url)
        })

        console.log(green(`\n✔ Successfully added and activated account '${profile.name}' (${profile.email})!\n`))
      } catch (err: any) {
        console.error(red(`\n✖ Failed to add account: ${err.message}\n`))
        process.exit(1)
      }
      break
    }

    case 'import': {
      const [name, token, email] = args
      if (!name || !token) {
        console.error(red('Usage: freebuff-accounts import <alias> <authToken> [email]'))
        process.exit(1)
      }

      console.log(bold(`\nImporting account '${name}'...`))
      try {
        const profile = await importAccount(name, token, email)
        console.log(green(`\n✔ Successfully imported account '${profile.name}' (${profile.email})!\n`))
      } catch (err: any) {
        console.error(red(`\n✖ Failed to import account: ${err.message}\n`))
        process.exit(1)
      }
      break
    }

    case 'remove':
    case 'rm': {
      const name = args[0]
      if (!name) {
        console.error(red('Usage: freebuff-accounts remove <alias>'))
        process.exit(1)
      }

      if (removeAccount(name)) {
        console.log(green(`\n✔ Removed account '${name}'.\n`))
      } else {
        console.error(yellow(`\nAccount '${name}' not found.\n`))
      }
      break
    }

    case 'auto': {
      const toggle = args[0]
      if (toggle === 'on' || toggle === 'true' || toggle === '1') {
        setAutoSwitch(true)
        console.log(green('\n✔ Automatic account switching enabled.\n'))
      } else if (toggle === 'off' || toggle === 'false' || toggle === '0') {
        setAutoSwitch(false)
        console.log(yellow('\n✔ Automatic account switching disabled.\n'))
      } else {
        const reg = loadRegistry()
        console.log(`\nAuto-switch is currently: ${reg.autoSwitchOnLimit ? green('ON') : yellow('OFF')}`)
        console.log('Usage: freebuff-accounts auto <on|off>\n')
      }
      break
    }

    case 'run': {
      // Run Freebuff with active account profile and auto-switch supervisor
      await runSupervisedFreebuff(args)
      break
    }

    case 'help':
    case '--help':
    case '-h': {
      printHelp()
      break
    }

    default: {
      console.error(red(`Unknown command: ${subcommand}`))
      printHelp()
      process.exit(1)
    }
  }
}

async function runSupervisedFreebuff(args: string[]): Promise<void> {
  const registry = loadRegistry()
  let active = getActiveAccount()

  if (!active) {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      console.error(red('No accounts configured. Add an account first with: freebuff-accounts add <name>'))
      process.exit(1)
    }
    active = switchAccount(accounts[0].name)
  }

  const profileDir = getAccountConfigDir(active.name)
  console.log(cyan(`[Freebuff Multi] Launching with account: ${bold(active.name)} (${active.email})`))

  const repoRoot = path.join(__dirname, '..', '..')
  const entryScript = path.join(repoRoot, 'cli', 'src', 'entry.ts')

  const env = {
    ...process.env,
    FREEBUFF_CONFIG_DIR: profileDir,
    FREEBUFF_ACTIVE_ACCOUNT: active.name,
  }

  const child = spawn('bun', [entryScript, ...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}

function printHelp(): void {
  console.log(`
${bold(cyan('Freebuff Multi-Account Manager'))}

Commands:
  ${cyan('list, ls')}                 List all registered accounts and quota status
  ${cyan('list --refresh')}           Refresh quota/limits from server before listing
  ${cyan('switch <name>')}            Quick switch active account to <name>
  ${cyan('next')}                     Instantly switch to the next account with available quota
  ${cyan('add <name>')}               Add a new account via browser login
  ${cyan('import <name> <token>')}    Import an account using auth token
  ${cyan('remove <name>')}            Remove an account profile
  ${cyan('check')}                    Query server for latest quotas and update status
  ${cyan('auto <on|off>')}            Enable/disable auto-switch when limits run out
  ${cyan('run [options...]')}         Run Freebuff with the active account
  ${cyan('help')}                     Show this help message
`)
}

if (import.meta.main) {
  runCli().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
