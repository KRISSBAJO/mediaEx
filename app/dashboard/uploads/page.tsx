import type { Metadata } from 'next'
import { Suspense } from 'react'
import Uploads from '@/components/app/views/Uploads'

export const metadata: Metadata = { title: 'Uploads' }

export default function Page() {
  // reads ?folder= to upload straight into a folder
  return (
    <Suspense>
      <Uploads />
    </Suspense>
  )
}
