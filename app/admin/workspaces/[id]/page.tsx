import type { Metadata } from 'next'
import AdminWorkspace from '@/components/admin/views/AdminWorkspace'

export const metadata: Metadata = { title: 'Workspace' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const operatorConnected = id === process.env.MEDIAEX_STORAGE_OPERATOR_WORKSPACE &&
    Boolean(process.env.MEDIAEX_STORAGE_OPERATOR_URL && process.env.MEDIAEX_STORAGE_OPERATOR_SERVICE_TOKEN)
  return <AdminWorkspace key={id} id={id} operatorConnected={operatorConnected} />
}
