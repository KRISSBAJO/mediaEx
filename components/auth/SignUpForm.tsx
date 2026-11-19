'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient, authMessage } from '@/lib/auth-client'
import { AuthHeader, Divider, Field, FormNote, PasswordField, SocialButtons, SubmitButton, isEmail, strength, type Social } from './ui'

export default function SignUpForm({ next, social }: { next: string; social: Social }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const edit = (key: keyof typeof errors, set: (v: string) => void) => (v: string) => {
    set(v)
    setFormError('')
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!name.trim()) nextErrors.name = 'Tell us your name.'
    if (!isEmail(email)) nextErrors.email = 'Enter a valid email address.'
    if (strength(password) < 2) nextErrors.password = 'Use 8+ characters with a mix of letters, numbers or symbols.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setLoading(true)
    setFormError('')
    const { data, error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: next })
    setLoading(false)
    if (error) return setFormError(authMessage(error))
    // signed in straight away when email verification isn't required; otherwise wait for the link
    if (data?.token) {
      router.replace(next)
      router.refresh()
    } else {
      setSentTo(email.trim())
    }
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
      <SocialButtons social={social} callbackURL={next} disabled={loading} />
      <Divider show={social.google || social.github}>or with email</Divider>
      <form onSubmit={submit} noValidate className="auth-fields">
        <Field label="Full name" name="name" autoComplete="name" placeholder="Ada Okafor" value={name} onChange={edit('name', setName)} error={errors.name} autoFocus />
        <Field label="Work email" name="email" type="email" autoComplete="email" placeholder="you@studio.com" value={email} onChange={edit('email', setEmail)} error={errors.email} />
        <PasswordField label="Password" name="password" autoComplete="new-password" value={password} onChange={edit('password', setPassword)} error={errors.password} meter />
        {formError && <FormNote tone="error">{formError}</FormNote>}
        <SubmitButton loading={loading}>Create account</SubmitButton>
        <p className="auth-legal">
          By creating an account you agree to the <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.
        </p>
      </form>
      <p className="auth-switch">
        Already have an account? <Link href={next === '/dashboard' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </p>
    </div>
  )
}
