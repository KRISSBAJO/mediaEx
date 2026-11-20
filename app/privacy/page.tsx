import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { Contact, type LegalSection } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — MediaEX',
  description: 'What MediaEX collects, why, who helps us run the service, and the choices you have.',
}

// Written against what the product does today: backend/media/analytics.mts, captions.mts, moderation.mts, billing.mts,
// backend/auth.mts. Change it when they change.
const SECTIONS: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <p>
        MediaEX runs the website and the media service at this address: uploading, encoding, storing and streaming video, audio and images, and the dashboard and API around
        them. This policy covers people who use MediaEX (“you”) and people who watch media that MediaEX customers share (“viewers”).
      </p>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <h3>Your account</h3>
        <p>
          Your name, email address and a password, stored only as a secure hash. If you sign in with Google or GitHub, we receive your name, email address and an account
          identifier from them. We also keep the workspaces you belong to, your role in each, and invitations you send or receive.
        </p>
        <h3>What you upload and create</h3>
        <p>
          The files you upload and everything the pipeline makes from them (streaming renditions, thumbnails, posters, captions), plus the titles, tags, folders, collections,
          custom fields, moderation decisions, API keys and webhook settings in your workspace. API keys are stored only as a hash.
        </p>
        <h3>Viewing analytics</h3>
        <p>
          When someone watches through a MediaEX share link or embedded player, the player reports how the viewing went: time watched, the furthest point reached, how long
          the video took to start, stalls, the amount of data loaded, the device type (from the browser’s user agent), the site the player was embedded on, the viewer’s local
          hour, and an approximate country, taken from our network provider when it supplies one or otherwise from the viewer’s time zone. To count unique viewers, the
          player keeps a random identifier in the viewer’s browser. We don’t record viewers’ names, email addresses or IP addresses in analytics.
        </p>
        <h3>Billing</h3>
        <p>
          Payments are handled by Stripe or Paystack. We keep your plan, its status, billing period and the identifiers those providers give us. We never see or store card
          numbers.
        </p>
        <h3>Technical data</h3>
        <p>
          Like any web service, our servers handle IP addresses, browser details and request times to deliver pages and media, keep the service secure and fix problems.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <ul>
        <li>To run MediaEX: store and process your files, stream them, and show your dashboard.</li>
        <li>To sign you in, keep your account secure, and send the emails the service needs (verification, password resets, invitations).</li>
        <li>To show you and your workspace how your media is watched.</li>
        <li>To bill paid plans and apply plan limits.</li>
        <li>To prevent abuse, investigate problems and comply with the law.</li>
      </ul>
    ),
  },
  {
    id: 'providers',
    title: 'Who helps us run it',
    body: (
      <>
        <p>We use a small number of service providers, each only for its part of the service:</p>
        <ul>
          <li>
            <b>Hosting and storage.</b> Our servers and an object storage provider hold your account data and files.
          </li>
          <li>
            <b>Email.</b> An email delivery provider sends account emails.
          </li>
          <li>
            <b>Payments.</b> Stripe or Paystack take payments for paid plans.
          </li>
          <li>
            <b>Automatic captions.</b> When a workspace asks for captions to be generated, the audio is sent to OpenAI to transcribe. Nothing is sent unless the workspace turns
            this on or asks for it on an asset.
          </li>
          <li>
            <b>Automatic content review.</b> When a workspace turns on automatic review in moderation, images and frames from videos are sent to Anthropic to check. It’s off
            unless the workspace turns it on.
          </li>
          <li>
            <b>Sign-in providers.</b> Google and GitHub, if you choose to sign in with them.
          </li>
        </ul>
        <p>We don’t sell personal information, and we don’t share it for advertising.</p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and browser storage',
    body: (
      <>
        <p>We use only what the service needs. There are no advertising or cross-site tracking cookies.</p>
        <ul>
          <li>A sign-in cookie that keeps you signed in to the dashboard.</li>
          <li>A random viewer identifier in the browser of people who watch shared media, used only to count unique viewers.</li>
          <li>Small settings in your browser: how you like the library laid out, uploads that can be resumed, and whether the home page tour has already played this visit.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <ul>
        <li>Account information stays while your account exists.</li>
        <li>When you delete an asset, its original, renditions, captions and viewing analytics are deleted with it.</li>
        <li>Billing records are kept as long as tax and accounting rules require.</li>
        <li>Technical logs are kept briefly, then deleted.</li>
      </ul>
    ),
  },
  {
    id: 'rights',
    title: 'Your choices and rights',
    body: (
      <>
        <p>
          You can change your name and password and delete assets from the dashboard at any time. You can also ask us for a copy of your personal information, to correct
          it, or to delete your account and its data. Depending on where you live, you may have further rights, such as objecting to some processing or complaining to a data
          protection authority.
        </p>
        <p>
          Viewers who want their viewing data removed can clear their browser’s storage for the site, which resets the random identifier, or contact the workspace that shared
          the media.
        </p>
        <p>
          To make a request, contact us through <Contact />.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        Passwords and API keys are stored only as hashes, webhooks are signed, media can be restricted to signed links that expire, and connections to the service are
        encrypted. No system is perfectly secure, but we work to protect your information and will tell you if a breach affects you.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>MediaEX isn’t meant for children under 16, and we don’t knowingly collect their personal information.</p>,
  },
  {
    id: 'changes',
    title: 'Changes',
    body: (
      <p>
        We’ll update this page when the service changes in ways that matter for your privacy, and change the date at the top. If a change is significant, we’ll tell account
        holders by email or in the dashboard. The <Link href="/terms">Terms</Link> explain the rest of how MediaEX works.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about privacy or this policy: contact us through <Contact />.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 19, 2026"
      intro={
        <p>
          What MediaEX collects, why, who helps us run the service, and the choices you have. In short: we use your information to run MediaEX, we don’t sell it, and the
          services that see your media are only the ones listed here.
        </p>
      }
      sections={SECTIONS}
    />
  )
}
