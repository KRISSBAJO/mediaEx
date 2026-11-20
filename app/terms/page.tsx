import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { Contact, type LegalSection } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service — MediaEX',
  description: 'The agreement between you and MediaEX for using the service.',
}

// Plans and limits here must match backend/media/billing.mts and the pricing page.
const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'The agreement',
    body: (
      <p>
        These terms are the agreement between you and MediaEX for using the MediaEX website, dashboard, API and media service. By creating an account or using the service
        you accept them. If you use MediaEX for an organisation, you accept them on its behalf and confirm you’re allowed to.
      </p>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts and workspaces',
    body: (
      <ul>
        <li>Give accurate information when you sign up, and keep your password and API keys secret. You’re responsible for what happens under your account and keys.</li>
        <li>
          A workspace belongs to its owners. Owners and admins decide who joins, what they can do and what happens to the workspace’s media and plan. Members act on the
          workspace’s behalf.
        </li>
        <li>Tell us straight away if you think someone else has access to your account.</li>
      </ul>
    ),
  },
  {
    id: 'content',
    title: 'Your content',
    body: (
      <>
        <p>
          You keep ownership of everything you upload. You give MediaEX permission to store, copy, process and deliver it only as needed to run the service for you: encoding
          it into streaming formats, making thumbnails, captions and image variants, and streaming it to the people you share it with.
        </p>
        <p>
          You’re responsible for having the rights to what you upload and share. Anyone with a public share link can watch that asset; use signed links if you need access to
          expire.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <>
        <p>Don’t use MediaEX to:</p>
        <ul>
          <li>Upload or share anything illegal, including content that sexually exploits children, which we report to the authorities.</li>
          <li>Infringe anyone’s copyright, trademarks, privacy or other rights.</li>
          <li>Share malware, run phishing, or harass or threaten people.</li>
          <li>Probe, overload or break the service or its security, get around plan limits or API rate limits, or access data that isn’t yours.</li>
          <li>Resell the service without our written agreement.</li>
        </ul>
        <p>We may remove content or suspend accounts that break these rules, and we act on valid legal notices about content hosted on MediaEX.</p>
      </>
    ),
  },
  {
    id: 'plans',
    title: 'Plans and payment',
    body: (
      <ul>
        <li>
          Creator is free. Pro and Studio are paid monthly or yearly, in advance, through Stripe or Paystack, and renew automatically until cancelled. Prices and limits are on
          the <Link href="/pricing">pricing page</Link>.
        </li>
        <li>
          Each plan has limits on storage, processing minutes and resolution. On Creator and Pro, new uploads pause when a limit is reached; media you already have keeps
          streaming.
        </li>
        <li>
          You can cancel at any time in Settings → Billing. Your plan stays active until the end of the period you’ve paid for, then the workspace moves to Creator. Payments
          already made aren’t refunded, except where the law requires it.
        </li>
        <li>If a payment fails, you keep the plan for 7 days while you update your card; after that the workspace moves to Creator.</li>
        <li>We may change prices with at least 30 days’ notice. Changes apply from your next billing period.</li>
        <li>Prices don’t include taxes, which are added where they apply.</li>
      </ul>
    ),
  },
  {
    id: 'api',
    title: 'The API and webhooks',
    body: (
      <p>
        You may use the API to build your own products on MediaEX within your plan and the published rate limits. Keep keys on your servers, not in apps or web pages that
        others can read. We may change or retire parts of the API, and will give reasonable notice of changes that break existing integrations.
      </p>
    ),
  },
  {
    id: 'third-parties',
    title: 'Other services',
    body: (
      <p>
        Some features rely on other providers, such as payment processors, speech-to-text for automatic captions and automated content review, which a workspace turns on.
        Their part of the service is described in the <Link href="/privacy">Privacy Policy</Link>. We aren’t responsible for services you connect yourself, such as the
        endpoints that receive your webhooks.
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <p>
        We work to keep MediaEX running and your media safe, but we don’t promise the service will be uninterrupted or error-free, and we don’t offer an uptime guarantee.
        Keep your own copies of anything important. We may change or improve features; if we stop offering the service, we’ll give notice and time to download your
        originals.
      </p>
    ),
  },
  {
    id: 'ending',
    title: 'Ending the agreement',
    body: (
      <p>
        You can stop using MediaEX and delete your workspaces at any time. We may suspend or close an account that seriously or repeatedly breaks these terms, or where the
        law requires it, and will tell you why unless we’re not allowed to. When an account is closed, its media is deleted.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Disclaimers and liability',
    body: (
      <p>
        The service is provided “as is”. To the extent the law allows, MediaEX isn’t liable for indirect or consequential losses, such as lost profits or data, and our total
        liability for any claim is limited to what you paid us in the 12 months before it. Nothing in these terms limits liability that can’t be limited by law.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. We’ll change the date at the top, and tell account holders by email or in the dashboard before significant changes take effect. Using
        MediaEX after that means you accept the updated terms.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms: contact us through <Contact />.
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="November 19, 2026"
      intro={
        <p>
          The agreement for using MediaEX. In short: your content stays yours, use the service fairly, paid plans renew until you cancel, and cancelling keeps your plan to the
          end of the period you paid for.
        </p>
      }
      sections={SECTIONS}
    />
  )
}
