import type { Metadata } from 'next'
import { Suspense } from 'react'
import AdminUsers from '@/components/admin/views/AdminUsers'

export const metadata: Metadata = { title: 'Users' }

export default function Page() {
  // the view reads its filters from the URL
  return (
    <Suspense>
      <AdminUsers />
    </Suspense>
  )
}
