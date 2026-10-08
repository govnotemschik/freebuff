import { useKeyboard } from '@opentui/react'
import React, { useCallback, useEffect } from 'react'

import { useAccountModalStore } from '../state/account-modal-store'
import { useTheme } from '../hooks/use-theme'
import { useTerminalDimensions } from '../hooks/use-terminal-dimensions'
import { getUserCredentials } from '../utils/auth'
import { setApiClientAuthToken } from '../utils/codebuff-api'
import { useChatStore } from '../state/chat-store'
import { getSystemMessage } from '../utils/message-history'
import { BORDER_CHARS } from '../utils/ui-constants'

import type { KeyEvent } from '@opentui/core'
import type { AccountProfile } from '../accounts/types'

function formatCountdown(isoDate?: string): string {
  if (!isoDate) return ''
  const diffMs = new Date(isoDate).getTime() - Date.now()
  if (diffMs <= 0) return 'ready'
  const diffSec = Math.floor(diffMs / 1000)
  const hours = Math.floor(diffSec / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${diffSec}s`
}

export function AccountSwitcherModal() {
  const theme = useTheme()
  const { terminalWidth } = useTerminalDimensions()

  const {
    isOpen,
    accounts,
    activeAccount,
    autoSwitch,
    selectedIndex,
    isLoading,
    statusNotice,
    closeModal,
    setSelectedIndex,
    loadAccounts,
    refreshBalances,
    selectAccount,
    selectNext,
    toggleAutoSwitch,
  } = useAccountModalStore()

  useEffect(() => {
    if (isOpen) {
      loadAccounts()
    }
  }, [isOpen, loadAccounts])

  const applySwitchAndNotify = useCallback(
    async (account: AccountProfile) => {
      await selectAccount(account.name)
      const creds = getUserCredentials()
      if (creds?.authToken) {
        setApiClientAuthToken(creds.authToken)
      }
      useChatStore.getState().setMessages((prev) => [
        ...prev,
        getSystemMessage(
          `✔ Switched active account to **${account.name}** (${account.email}).`,
        ),
      ])
      closeModal()
    },
    [selectAccount, closeModal],
  )

  const handleNext = useCallback(async () => {
    await selectNext()
    const creds = getUserCredentials()
    if (creds?.authToken) {
      setApiClientAuthToken(creds.authToken)
    }
    const currentActive = useAccountModalStore.getState().activeAccount
    useChatStore.getState().setMessages((prev) => [
      ...prev,
      getSystemMessage(
        `✔ Rotated to next account: **${currentActive}**`,
      ),
    ])
    closeModal()
  }, [selectNext, closeModal])

  useKeyboard(
    useCallback(
      (key: KeyEvent) => {
        if (!isOpen) return

        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
          key.preventDefault()
          closeModal()
          return
        }

        if (key.name === 'up') {
          key.preventDefault()
          setSelectedIndex(Math.max(0, selectedIndex - 1))
          return
        }

        if (key.name === 'down') {
          key.preventDefault()
          setSelectedIndex(Math.min(accounts.length - 1, selectedIndex + 1))
          return
        }

        if (key.name === 'return' || key.name === 'enter') {
          key.preventDefault()
          const chosen = accounts[selectedIndex]
          if (chosen) {
            void applySwitchAndNotify(chosen)
          }
          return
        }

        if (key.name === 'n' && !key.ctrl && !key.meta) {
          key.preventDefault()
          void handleNext()
          return
        }

        if (key.name === 'r' && !key.ctrl && !key.meta) {
          key.preventDefault()
          void refreshBalances()
          return
        }

        if (key.name === 'space') {
          key.preventDefault()
          toggleAutoSwitch()
          return
        }
      },
      [
        isOpen,
        selectedIndex,
        accounts,
        closeModal,
        setSelectedIndex,
        applySwitchAndNotify,
        handleNext,
        refreshBalances,
        toggleAutoSwitch,
      ],
    ),
  )

  if (!isOpen) return null

  const modalWidth = Math.max(48, Math.min(84, terminalWidth - 4))

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 1,
        paddingBottom: 1,
      }}
    >
      <box
        style={{
          width: modalWidth,
          borderStyle: 'single',
          borderColor: theme.success,
          customBorderChars: BORDER_CHARS,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 0,
          paddingBottom: 0,
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Title */}
        <box
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            width: '100%',
            marginBottom: 1,
          }}
        >
          <text style={{ fg: theme.success }}>
            👥 Multi-Account Manager
          </text>
          <text style={{ fg: autoSwitch ? theme.success : theme.warning }}>
            Auto-Switch: [{autoSwitch ? 'ON' : 'OFF'}]
          </text>
        </box>

        {statusNotice && (
          <text style={{ fg: theme.warning, marginBottom: 1 }}>
            {statusNotice}
          </text>
        )}

        {/* Account list */}
        {accounts.length === 0 ? (
          <box style={{ flexDirection: 'column', margin: 1 }}>
            <text style={{ fg: theme.warning }}>
              No accounts registered yet.
            </text>
            <text style={{ fg: theme.muted }}>
              Add an account with: freebuff-accounts add &lt;alias&gt;
            </text>
          </box>
        ) : (
          <box style={{ flexDirection: 'column', width: '100%', gap: 0 }}>
            {accounts.map((acc, idx) => {
              const isSelected = idx === selectedIndex
              const isActive = acc.name === activeAccount
              const fbTotal = acc.freebucks?.total ?? 25
              const isReady = acc.status === 'ready'
              const resetCountdown = formatCountdown(
                acc.freebucks?.resetAt || acc.rateLimit?.resetAt,
              )

              let statusText = isReady
                ? `● Ready (${fbTotal} FB)`
                : acc.status === 'rate_limited'
                  ? `● Limited (0 FB${resetCountdown ? ` · in ${resetCountdown}` : ''})`
                  : `● ${acc.status}`

              return (
                <box
                  key={acc.name}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    width: '100%',
                    paddingLeft: 1,
                    paddingRight: 1,
                    borderColor: isSelected ? theme.success : 'transparent',
                    borderStyle: isSelected ? 'single' : 'none',
                  }}
                >
                  <box style={{ flexDirection: 'row', gap: 1 }}>
                    <text style={{ fg: isSelected ? theme.success : theme.foreground }}>
                      {isSelected ? '▶' : ' '}
                    </text>
                    <text style={{ fg: isActive ? theme.success : isSelected ? theme.foreground : theme.muted }}>
                      {acc.name}
                    </text>
                    {isActive && (
                      <text style={{ fg: theme.success }}>
                        [ACTIVE]
                      </text>
                    )}
                    <text style={{ fg: theme.muted }}>
                      ({acc.email})
                    </text>
                  </box>

                  <text style={{ fg: isReady ? theme.success : theme.warning }}>
                    {statusText}
                  </text>
                </box>
              )
            })}
          </box>
        )}

        {/* Controls footer */}
        <box
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            width: '100%',
            marginTop: 1,
            borderStyle: 'single',
            borderColor: theme.border,
            customBorderChars: BORDER_CHARS,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text style={{ fg: theme.muted }}>
            [↑/↓] Navigate  [Enter] Switch  [n] Next  [Space] Auto-switch  [r] Refresh  [Esc] Close
          </text>
        </box>
      </box>
    </box>
  )
}
