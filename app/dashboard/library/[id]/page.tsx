import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import AssetDetail from '@/components/app/views/AssetDetail'
import { ASSETS, getAsset } from '@/lib/sample'

export function generateStaticParams() {
  return ASSETS.map((a) => ({ id: a.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return { title: getAsset(id)?.title ?? 'Asset not found' }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!getAsset(id)) notFound()
  return <AssetDetail id={id} />
}
