import type { Metadata } from 'next'
import Uploads from '@/components/app/views/Uploads'

export const metadata: Metadata = { title: 'Uploads' }

export default function Page() {
  return <Uploads />
}
