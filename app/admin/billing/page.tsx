import type { Metadata } from 'next'
import AdminBilling from '@/components/admin/views/AdminBilling'

export const metadata: Metadata = { title: 'Billing' }

export default function Page() {
  return <AdminBilling />
}
