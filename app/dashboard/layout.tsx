import type { Metadata } from 'next'
import Shell from '@/components/app/Shell'
import { getWorkspaceAssets, requireAccount } from '@/lib/session'
import './dashboard.css'

export const metadata: Metadata = {
  title: { template: '%s · MediaEX', default: 'Dashboard · MediaEX' },
  robots: { index: false, follow: false },
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // account first: it settles the active workspace that the asset list is scoped to
  const account = await requireAccount()
  const initialAssets = await getWorkspaceAssets()
  return (
    <Shell account={account} initialAssets={initialAssets}>
      {children}
    </Shell>
  )
}
