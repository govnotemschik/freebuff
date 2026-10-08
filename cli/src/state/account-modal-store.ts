import { create } from 'zustand'

import {
  checkAllAccounts,
  getActiveAccount,
  listAccounts,
  loadRegistry,
  setAutoSwitch,
  switchAccount,
  switchNext as switchNextAccount,
} from '../accounts/account-manager'
import type { AccountProfile } from '../accounts/types'

interface AccountModalState {
  isOpen: boolean
  accounts: AccountProfile[]
  activeAccount: string | null
  autoSwitch: boolean
  selectedIndex: number
  isLoading: boolean
  statusNotice: string | null

  openModal: () => void
  closeModal: () => void
  toggleModal: () => void
  setSelectedIndex: (index: number) => void
  setStatusNotice: (notice: string | null) => void
  loadAccounts: () => void
  refreshBalances: () => Promise<void>
  selectAccount: (name: string) => Promise<void>
  selectNext: () => Promise<void>
  toggleAutoSwitch: () => void
}

export const useAccountModalStore = create<AccountModalState>((set, get) => ({
  isOpen: false,
  accounts: [],
  activeAccount: null,
  autoSwitch: true,
  selectedIndex: 0,
  isLoading: false,
  statusNotice: null,

  openModal: () => {
    get().loadAccounts()
    set({ isOpen: true, statusNotice: null })
  },

  closeModal: () => set({ isOpen: false }),

  toggleModal: () => {
    if (get().isOpen) {
      set({ isOpen: false })
    } else {
      get().openModal()
    }
  },

  setSelectedIndex: (index: number) => set({ selectedIndex: index }),

  setStatusNotice: (notice: string | null) => set({ statusNotice: notice }),

  loadAccounts: () => {
    const reg = loadRegistry()
    const accs = listAccounts()
    const activeIdx = Math.max(
      0,
      accs.findIndex((a) => a.name === reg.activeAccount),
    )
    set({
      accounts: accs,
      activeAccount: reg.activeAccount,
      autoSwitch: reg.autoSwitchOnLimit,
      selectedIndex: activeIdx,
    })
  },

  refreshBalances: async () => {
    set({ isLoading: true, statusNotice: 'Refreshing balances from server...' })
    try {
      const updated = await checkAllAccounts()
      const reg = loadRegistry()
      set({
        accounts: updated,
        activeAccount: reg.activeAccount,
        isLoading: false,
        statusNotice: 'Balances updated successfully',
      })
      setTimeout(() => set({ statusNotice: null }), 3000)
    } catch (err: any) {
      set({
        isLoading: false,
        statusNotice: `Failed to refresh: ${err?.message || 'Network error'}`,
      })
    }
  },

  selectAccount: async (name: string) => {
    try {
      switchAccount(name)
      const reg = loadRegistry()
      const accs = listAccounts()
      set({
        activeAccount: name,
        accounts: accs,
        statusNotice: `Active account switched to: ${name}`,
      })
    } catch (err: any) {
      set({ statusNotice: `Error: ${err?.message}` })
    }
  },

  selectNext: async () => {
    try {
      const { next, reason } = switchNextAccount()
      const reg = loadRegistry()
      const accs = listAccounts()
      const newIdx = Math.max(
        0,
        accs.findIndex((a) => a.name === next.name),
      )
      set({
        activeAccount: next.name,
        accounts: accs,
        selectedIndex: newIdx,
        statusNotice: `Rotated to: ${next.name} (${reason})`,
      })
    } catch (err: any) {
      set({ statusNotice: `Error: ${err?.message}` })
    }
  },

  toggleAutoSwitch: () => {
    const nextVal = !get().autoSwitch
    setAutoSwitch(nextVal)
    set({ autoSwitch: nextVal })
  },
}))
