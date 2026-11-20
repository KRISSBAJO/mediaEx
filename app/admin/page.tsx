import type { Metadata } from 'next'
import AdminOverview from '@/components/admin/views/AdminOverview'

export const metadata: Metadata = { title: { absolute: 'Overview · Site admin · MediaEX' } }

export default function Page() {
  return <AdminOverview />
}
