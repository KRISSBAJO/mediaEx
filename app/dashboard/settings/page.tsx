import type { Metadata } from 'next'
import { Suspense } from 'react'
import Settings from '@/components/app/views/Settings'

export const metadata: Metadata = { title: 'Settings' }

export default function Page() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  )
}
