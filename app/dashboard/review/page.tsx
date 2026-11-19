import type { Metadata } from 'next'
import Review from '@/components/app/views/Review'

export const metadata: Metadata = { title: 'Review' }

export default function Page() {
  return <Review />
}
