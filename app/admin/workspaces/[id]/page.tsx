import type { Metadata } from 'next'
import AdminWorkspace from '@/components/admin/views/AdminWorkspace'

export const metadata: Metadata = { title: 'Workspace' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminWorkspace key={id} id={id} />
}
