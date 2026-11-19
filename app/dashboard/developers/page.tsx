import type { Metadata } from 'next'
import { Suspense } from 'react'
import Developers from '@/components/app/views/Developers'

export const metadata: Metadata = { title: 'Developers' }

export default function Page() {
  return (
    <Suspense>
      <Developers />
    </Suspense>
  )
}
