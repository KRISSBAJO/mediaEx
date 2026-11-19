'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient, authMessage } from '@/lib/auth-client'
import { AuthHeader, Divider, Field, FormNote, PasswordField, SocialButtons, SubmitButton, isEmail, type Social } from './ui'

export default function SignInForm({ next, social }: { next: string; social: Social }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState('')
  const [unverified, setUnverified] = useState(false)
  const [resent, setResent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const edit = (key: keyof typeof errors, set: (v: string) => void) => (v: string) => {
    set(v)
    setFormError('')
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!isEmail(email)) nextErrors.email = 'Enter a valid email address.'
    if (!password) nextErrors.password = 'Enter your password.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setLoading(true)
    setFormError('')
    setUnverified(false)
    setResent(false)
    const { error } = await authClient.signIn.email({ email: email.trim(), password, callbackURL: next })
    setLoading(false)
    if (error) {
      setUnverified(error.code === 'EMAIL_NOT_VERIFIED')
      setFormError(authMessage(error))
      return
    }
    setDone(true)
    router.replace(next)
    router.refresh()
  }

  const resend = async () => {
    await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: next })
    setResent(true)
  }

  return (
    <div className="auth-card">
      <AuthHeader title="Welcome back" sub="Sign in to your MediaEX workspace." />
      <SocialButtons social={social} callbackURL={next} disabled={loading} />
      <Divider show={social.google || social.github}>or with email</Divider>
      <form onSubmit={submit} noValidate className="auth-fields">
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@studio.com" value={email} onChange={edit('email', setEmail)} error={errors.email} autoFocus />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={edit('password', setPassword)}
          error={errors.password}
          aside={
            <Link href="/forgot-password" className="field-link">
              Forgot password?
            </Link>
          }
        />
        {formError && (
          <FormNote tone="error">
            {resent ? 'New verification link sent. Check your inbox.' : formError}
            {unverified && !resent && (
              <button type="button" onClick={resend}>
                Resend link
              </button>
            )}
          </FormNote>
        )}
        {done ? <FormNote tone="ok">Signed in. Opening your workspace…</FormNote> : <SubmitButton loading={loading}>Sign in</SubmitButton>}
      </form>
      <p className="auth-switch">
        New to MediaEX? <Link href={next === '/dashboard' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </p>
    </div>
  )
}
