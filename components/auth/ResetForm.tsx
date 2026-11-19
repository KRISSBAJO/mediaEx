'use client'

import Link from 'next/link'
import { useState } from 'react'
import { authClient, authMessage } from '@/lib/auth-client'
import { AuthHeader, FormNote, PasswordField, SubmitButton, strength } from './ui'

export default function ResetForm({ token, linkError }: { token: string | null; linkError: boolean }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!token || linkError) {
    return (
      <div className="auth-card">
        <AuthHeader title="This link has expired" sub="Reset links work once and expire after an hour. Ask for a new one." />
        <Link href="/forgot-password" className="btn btn-primary btn-block">
          Send a new link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="auth-card">
        <AuthHeader title="Password updated" sub="You've been signed out everywhere else. Sign in with your new password." />
        <Link href="/sign-in" className="btn btn-primary btn-block">
          Sign in
        </Link>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (strength(password) < 2) next.password = 'Use 8+ characters with a mix of letters, numbers or symbols.'
    if (confirm !== password) next.confirm = 'The passwords don’t match.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    const { error } = await authClient.resetPassword({ newPassword: password, token })
    setLoading(false)
    if (error) return setFormError(authMessage(error))
    setDone(true)
  }

  return (
    <div className="auth-card">
      <AuthHeader title="Choose a new password" sub="Pick something you don't use anywhere else." />
      <form onSubmit={submit} noValidate className="auth-fields">
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(v) => {
            setPassword(v)
            setErrors((e) => ({ ...e, password: undefined }))
          }}
          error={errors.password}
          meter
          autoFocus
        />
        <PasswordField
          label="Confirm password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(v) => {
            setConfirm(v)
            setErrors((e) => ({ ...e, confirm: undefined }))
          }}
          error={errors.confirm}
        />
        {formError && <FormNote tone="error">{formError}</FormNote>}
        <SubmitButton loading={loading}>Update password</SubmitButton>
      </form>
    </div>
  )
}
