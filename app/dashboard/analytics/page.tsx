import type { Metadata } from 'next'
import Analytics from '@/components/app/views/Analytics'

export const metadata: Metadata = { title: 'Analytics' }

export default function Page() {
  return <Analytics />
}
