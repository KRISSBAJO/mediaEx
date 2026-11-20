import type { Metadata } from 'next'
import { Suspense } from 'react'
import Analytics from '@/components/app/views/Analytics'

export const metadata: Metadata = { title: 'Analytics' }

export default function Page() {
  // the view reads ?asset= from the URL
  return (
    <Suspense>
      <Analytics />
    </Suspense>
  )
}
