import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import AssetDetail from '@/components/app/views/AssetDetail'
import { getAssetRow, isMemberOf } from '@/lib/media/assets'

async function load(id: string) {
  const row = await getAssetRow(id)
  if (!row || !(await isMemberOf(await headers(), row.organizationId))) return null
  return row
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return { title: (await load(id))?.title ?? 'Asset not found' }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await load(id))) notFound()
  return <AssetDetail id={id} />
}
