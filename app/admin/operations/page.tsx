import type { Metadata } from 'next'
import AdminOps from '@/components/admin/views/AdminOps'

export const metadata: Metadata = { title: 'Operations' }

export default function Page() {
  return <AdminOps />
}
