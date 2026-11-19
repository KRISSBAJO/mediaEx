import type { Metadata } from 'next'
import Shell from '@/components/app/Shell'
import { requireAccount } from '@/lib/session'
import './dashboard.css'

export const metadata: Metadata = {
  title: { template: '%s · MediaEX', default: 'Dashboard · MediaEX' },
  robots: { index: false, follow: false },
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAccount()
  return <Shell account={account}>{children}</Shell>
}
