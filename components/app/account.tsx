'use client'

import { createContext, useContext } from 'react'

export type Role = 'owner' | 'admin' | 'member' | 'contributor' | 'reviewer' | 'viewer'
export type Account = {
  user: { id: string; name: string; email: string; initials: string; emailVerified: boolean; isAdmin: boolean }
  /** set while a site admin is signed in as this user */
  impersonation: { by: string; byEmail: string; expiresAt: string } | null
  workspace: {
    id: string
    name: string
    slug: string
    initial: string
    role: Role
    createdAt: string
    /** the plan right now (see backend/media/billing.mts) */
    plan: { id: 'creator' | 'pro' | 'studio'; name: string; storageLimit: number }
    /** a site admin suspended this workspace */
    suspended: { reason: string | null } | null
  }
  workspaces: { id: string; name: string; slug: string; initial: string }[]
}

const Ctx = createContext<Account | null>(null)

export function AccountProvider({ value, children }: { value: Account; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The signed-in user and their active workspace (real data from the database). */
export function useAccount() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAccount must be used inside the dashboard')
  return v
}

export const canManage = (role: Role) => role === 'owner' || role === 'admin'
