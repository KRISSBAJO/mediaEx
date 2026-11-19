'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AuthHeader, Field, SubmitButton, fakeRequest, isEmail } from './ui'

export default function ForgotForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isEmail(email)) return setError('Enter a valid email address.')
    setError(undefined)
    setLoading(true)
    await fakeRequest() // TODO: call the real password-reset endpoint
    setLoading(false)
    setSentTo(email.trim())
  }

  return (
    <div className="auth-card">
      <Link href="/sign-in" className="auth-back">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13 8H4m4-4-4 4 4 4" />
        </svg>
        Back to sign in
      </Link>
      {sentTo ? (
        <>
          <AuthHeader
            title="Check your inbox"
            sub={
              <>
                If an account exists for <b>{sentTo}</b>, you&apos;ll get a reset link in a minute. It expires in 30 minutes.
              </>
            }
          />
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setSentTo('')}>
            Send to a different email
          </button>
        </>
      ) : (
        <>
          <AuthHeader title="Reset your password" sub="Enter the email you use for MediaEX and we'll send you a reset link." />
          <form onSubmit={submit} noValidate className="auth-fields">
            <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@studio.com" value={email} onChange={(v) => {
                setEmail(v)
                setError(undefined)
              }} error={error} autoFocus />
            <SubmitButton loading={loading}>Send reset link</SubmitButton>
          </form>
        </>
      )}
    </div>
  )
}
