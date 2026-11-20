import type { Metadata } from 'next'
import { Suspense } from 'react'
import AdminAudit from '@/components/admin/views/AdminAudit'

export const metadata: Metadata = { title: 'Audit log' }

export default function Page() {
  // the view reads its filters from the URL
  return (
    <Suspense>
      <AdminAudit />
    </Suspense>
  )
}
