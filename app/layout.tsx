import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
// the italic serif for the second half of each headline (.grad-text): one accent face, used nowhere else
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: 'italic', variable: '--font-instrument' })

export const metadata: Metadata = {
  title: 'MediaEX — Upload once. Stream everywhere.',
  description:
    'MediaEX is the media cloud for creators and teams: store, transcode, edit and deliver video, audio and images to any screen in milliseconds.',
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
