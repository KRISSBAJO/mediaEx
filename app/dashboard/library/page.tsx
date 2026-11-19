import type { Metadata } from 'next'
import { Suspense } from 'react'
import Library from '@/components/app/views/Library'

export const metadata: Metadata = { title: 'Library' }

export default function Page() {
  // the Library keeps its folder, filters and search in the URL
  return (
    <Suspense>
      <Library />
    </Suspense>
  )
}
