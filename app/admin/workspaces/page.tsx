import type { Metadata } from 'next'
import { Suspense } from 'react'
import AdminWorkspaces from '@/components/admin/views/AdminWorkspaces'

export const metadata: Metadata = { title: 'Workspaces' }

export default function Page() {
  // the view reads its filters from the URL
  return (
    <Suspense>
      <AdminWorkspaces />
    </Suspense>
  )
}
