import type { Metadata } from 'next'
import { Suspense } from 'react'
import AdminMedia from '@/components/admin/views/AdminMedia'

export const metadata: Metadata = { title: 'Media' }

export default function Page() {
  // the view reads its filters from the URL
  return (
    <Suspense>
      <AdminMedia />
    </Suspense>
  )
}
