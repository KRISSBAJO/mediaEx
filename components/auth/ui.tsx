'use client'

import { useId, useState } from 'react'

export function AuthHeader({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <header className="auth-head">
      <h1>{title}</h1>
      <p>{sub}</p>
    </header>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.33Zm-9.6 9.77c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Zm-5.59-8.1A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.9V7.51H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49l3.34-2.6ZM12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.51l3.34 2.59C7.2 7.74 9.4 5.98 12 5.98Z"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
      />
    </svg>
  )
}

export function SocialButtons({ disabled }: { disabled?: boolean }) {
  return (
    <div className="auth-social">
      <button type="button" className="auth-social-btn" disabled={disabled}>
        <GoogleIcon /> Google
      </button>
      <button type="button" className="auth-social-btn" disabled={disabled}>
        <GitHubIcon /> GitHub
      </button>
    </div>
  )
}

export function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-divider" role="separator">
      <span>{children}</span>
    </div>
  )
}

type FieldProps = {
  label: string
  name: string
  type?: string
  autoComplete?: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  error?: string
  aside?: React.ReactNode
  autoFocus?: boolean
}

export function Field({ label, name, type = 'text', autoComplete, placeholder, value, onChange, error, aside, autoFocus }: FieldProps) {
  const id = useId()
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <div className="field-top">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  )
}

export function PasswordField(props: Omit<FieldProps, 'type'> & { meter?: boolean }) {
  const [show, setShow] = useState(false)
  const id = useId()
  const { label, name, autoComplete, value, onChange, error, aside, meter } = props
  const score = strength(value)
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <div className="field-top">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="field-pw">
        <input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="field-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {meter && (
        <div className="pw-meter" aria-live="polite">
          <div className="pw-bars">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={value && i < score ? 'on' : ''} />
            ))}
          </div>
          <span>{value ? ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] : 'At least 8 characters'}</span>
        </div>
      )}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  )
}

/** 0 = too short, 1..4 = weak..strong */
export function strength(pw: string) {
  if (pw.length < 8) return 0
  let s = 1
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) s++
  return Math.min(s, 4)
}

export function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading} aria-busy={loading}>
      {loading ? <span className="spinner" aria-label="Working" /> : children}
    </button>
  )
}

export function FormNote({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'ok' }) {
  return (
    <div className={`form-note ${tone}`} role="status">
      {children}
    </div>
  )
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Placeholder for the real auth call. Resolves after a short delay so the UI states can be seen. */
export const fakeRequest = () => new Promise((r) => setTimeout(r, 900))
