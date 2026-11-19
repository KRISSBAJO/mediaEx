import type { Metadata } from 'next'
import ResetForm from '@/components/auth/ResetForm'

export const metadata: Metadata = { title: 'Choose a new password — MediaEX' }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  return <ResetForm token={token ?? null} linkError={!!error} />
}
