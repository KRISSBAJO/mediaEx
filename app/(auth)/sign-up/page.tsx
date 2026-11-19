import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import SignUpForm from '@/components/auth/SignUpForm'
import { safeNext } from '@/lib/next-url'
import { enabledSocial } from '@/lib/auth'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Create your account — MediaEX' }

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next)
  if (await getSession()) redirect(next)
  return <SignUpForm next={next} social={enabledSocial} />
}
