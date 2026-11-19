import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import SignInForm from '@/components/auth/SignInForm'
import { safeNext } from '@/lib/next-url'
import { getEnabledSocial, getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Sign in — MediaEX' }

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next)
  if (await getSession()) redirect(next)
  return <SignInForm next={next} social={await getEnabledSocial()} />
}
