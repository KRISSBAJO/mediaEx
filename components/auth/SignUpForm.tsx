'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AuthHeader, Divider, Field, PasswordField, SocialButtons, SubmitButton, fakeRequest, isEmail, strength } from './ui'

export default function SignUpForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({})
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const edit = (key: keyof typeof errors, set: (v: string) => void) => (v: string) => {
    set(v)
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Tell us your name.'
    if (!isEmail(email)) next.email = 'Enter a valid email address.'
    if (strength(password) < 2) next.password = 'Use 8+ characters with a mix of letters, numbers or symbols.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    await fakeRequest() // TODO: call the real sign-up endpoint
    setLoading(false)
    setSentTo(email.trim())
  }

  if (sentTo) {
    return (
      <div className="auth-card">
        <div className="auth-done-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7.5 12 13l8-5.5M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
          </svg>
        </div>
        <AuthHeader
          title="Check your inbox"
          sub={
            <>
              We sent a verification link to <b>{sentTo}</b>. Open it to finish setting up your workspace.
            </>
          }
        />
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setSentTo('')}>
          Use a different email
        </button>
        <p className="auth-switch">
          Already verified? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <AuthHeader title="Create your account" sub="Start free. No card required." />
      <SocialButtons disabled={loading} />
      <Divider>or with email</Divider>
      <form onSubmit={submit} noValidate className="auth-fields">
        <Field label="Full name" name="name" autoComplete="name" placeholder="Ada Okafor" value={name} onChange={edit('name', setName)} error={errors.name} autoFocus />
        <Field label="Work email" name="email" type="email" autoComplete="email" placeholder="you@studio.com" value={email} onChange={edit('email', setEmail)} error={errors.email} />
        <PasswordField label="Password" name="password" autoComplete="new-password" value={password} onChange={edit('password', setPassword)} error={errors.password} meter />
        <SubmitButton loading={loading}>Create account</SubmitButton>
        <p className="auth-legal">
          By creating an account you agree to the <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.
        </p>
      </form>
      <p className="auth-switch">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  )
}
