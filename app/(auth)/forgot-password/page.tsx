import type { Metadata } from 'next'
import ForgotForm from '@/components/auth/ForgotForm'

export const metadata: Metadata = { title: 'Reset your password — MediaEX' }

export default function ForgotPasswordPage() {
  return <ForgotForm />
}
