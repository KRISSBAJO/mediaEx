import type { Metadata } from 'next'
import AdminUser from '@/components/admin/views/AdminUser'

export const metadata: Metadata = { title: 'User' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminUser key={id} id={id} />
}
