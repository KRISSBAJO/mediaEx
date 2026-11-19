import type { Metadata, Viewport } from 'next'
import { Inter, Sora, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const sora = Sora({ subsets: ['latin'], variable: '--font-sora', weight: ['400', '500', '600', '700', '800'] })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'MediaEX — Upload once. Stream everywhere.',
  description:
    'MediaEX is the media cloud for creators and teams: store, transcode, edit and deliver video, audio and images to any screen in milliseconds.',
}

export const viewport: Viewport = {
  themeColor: '#07080b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
