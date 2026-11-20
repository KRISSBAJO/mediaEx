import type { Metadata } from 'next'
import AdminShell from '@/components/admin/AdminShell'
import { requireSiteAdmin } from '@/lib/session'
import '../dashboard/dashboard.css'

export const metadata: Metadata = {
  title: { template: '%s · Site admin · MediaEX', default: 'Site admin · MediaEX' },
  robots: { index: false, follow: false },
}

/** Site admins only: everyone else gets sign-in (signed out) or a 404 (signed in), so the area isn't advertised. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSiteAdmin()
  return <AdminShell admin={admin}>{children}</AdminShell>
}
