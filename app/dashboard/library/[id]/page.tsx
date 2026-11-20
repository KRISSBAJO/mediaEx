import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import AssetDetail from '@/components/app/views/AssetDetail'
import { getWorkspaceAsset } from '@/lib/session'

const load = cache(getWorkspaceAsset)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return { title: (await load(id))?.title ?? 'Asset not found' }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const asset = await load(id)
  if (!asset) notFound()
  return <AssetDetail key={id} id={id} initial={asset} />
}
