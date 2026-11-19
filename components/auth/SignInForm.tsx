'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AuthHeader, Divider, Field, FormNote, PasswordField, SocialButtons, SubmitButton, fakeRequest, isEmail } from './ui'

export default function SignInForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const edit = (key: keyof typeof errors, set: (v: string) => void) => (v: string) => {
    set(v)
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!isEmail(email)) next.email = 'Enter a valid email address.'
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    await fakeRequest() // TODO: call the real sign-in endpoint
    setLoading(false)
    setDone(true)
    setTimeout(() => router.push('/'), 900)
  }

  return (
    <div className="auth-card">
      <AuthHeader title="Welcome back" sub="Sign in to your MediaEX workspace." />
      <SocialButtons disabled={loading} />
      <Divider>or with email</Divider>
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
        {done ? <FormNote tone="ok">Signed in. Taking you to your workspace…</FormNote> : <SubmitButton loading={loading}>Sign in</SubmitButton>}
      </form>
      <p className="auth-switch">
        New to MediaEX? <Link href="/sign-up">Create an account</Link>
      </p>
    </div>
  )
}
