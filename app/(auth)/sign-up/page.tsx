import type { Metadata } from 'next'
import SignUpForm from '@/components/auth/SignUpForm'

export const metadata: Metadata = { title: 'Create your account — MediaEX' }

export default function SignUpPage() {
  return <SignUpForm />
}
