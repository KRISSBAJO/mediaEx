import type { Metadata } from 'next'
import Shell from '@/components/app/Shell'
import './dashboard.css'

export const metadata: Metadata = {
  title: { template: '%s · MediaEX', default: 'Dashboard · MediaEX' },
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>
}
