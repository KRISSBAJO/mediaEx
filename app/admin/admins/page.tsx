import type { Metadata } from 'next'
import AdminAdmins from '@/components/admin/views/AdminAdmins'

export const metadata: Metadata = { title: 'Admins' }

export default function Page() {
  return <AdminAdmins />
}
