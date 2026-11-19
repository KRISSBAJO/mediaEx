'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient, authMessage } from '@/lib/auth-client'
import { FormNote } from './ui'

export default function AcceptInvite({ id, org }: { id: string; org: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState('')
  const [declined, setDeclined] = useState(false)

  const accept = async () => {
    setBusy('accept')
    const { data, error: err } = await authClient.organization.acceptInvitation({ invitationId: id })
    if (err || !data) {
      setBusy(null)
      return setError(authMessage(err, 'Couldn’t accept the invitation.'))
    }
    await authClient.organization.setActive({ organizationId: data.member.organizationId })
    router.replace('/dashboard')
    router.refresh()
  }
  const decline = async () => {
    setBusy('decline')
    const { error: err } = await authClient.organization.rejectInvitation({ invitationId: id })
    setBusy(null)
    if (err) return setError(authMessage(err, 'Couldn’t decline the invitation.'))
    setDeclined(true)
  }

  if (declined) return <FormNote tone="ok">Invitation declined. You won’t be added to {org}.</FormNote>

  return (
    <div className="auth-fields">
      {error && <FormNote tone="error">{error}</FormNote>}
      <button type="button" className="btn btn-primary btn-block" onClick={accept} disabled={!!busy}>
        {busy === 'accept' ? 'Joining…' : `Join ${org}`}
      </button>
      <button type="button" className="btn btn-ghost btn-block" onClick={decline} disabled={!!busy}>
        {busy === 'decline' ? 'Declining…' : 'Decline'}
      </button>
    </div>
  )
}
