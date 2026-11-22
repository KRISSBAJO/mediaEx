'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon'

export type NavItem = { href: string; label: string; icon: string; count?: number; external?: boolean }
export type NavGroup = { group: string; items: NavItem[] }

/** A steady hue per workspace, so each one's mark has its own colour in the switcher. */
export function wsHue(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 360
}

/**
 * The sidebar's page list, shared by the dashboard and site admin. One highlight sits behind the
 * current page and slides to the next one when you navigate, instead of each row lighting up on its own.
 */
export default function SideNav({ groups, isActive, label, onNavigate }: { groups: NavGroup[]; isActive: (href: string) => boolean; label: string; onNavigate?: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ y: number; h: number; moved: boolean } | null>(null)
  const current = groups.flatMap((g) => g.items).find((i) => !i.external && isActive(i.href))?.href

  useLayoutEffect(() => {
    const nav = ref.current
    if (!nav) return
    const place = () => {
      const el = current ? nav.querySelector<HTMLElement>(`a[data-href="${CSS.escape(current)}"]`) : null
      // the first placement doesn't animate in from the top
      setPill((p) => (el ? { y: el.offsetTop, h: el.offsetHeight, moved: p !== null } : null))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [current])

  return (
    <nav ref={ref} className="side-nav" aria-label={label}>
      {pill && <span className={`side-pill ${pill.moved ? 'is-moving' : ''}`} style={{ transform: `translateY(${pill.y}px)`, height: pill.h }} aria-hidden="true" />}
      {groups.map((g) => (
        <div key={g.group} className="side-group">
          <span className="side-label">{g.group}</span>
          {g.items.map((it) => {
            const on = !it.external && it.href === current
            return (
              <Link
                key={it.href}
                href={it.href}
                data-href={it.href}
                className={on ? 'is-active' : ''}
                aria-current={on ? 'page' : undefined}
                onClick={onNavigate}
                {...(it.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                <Icon name={it.icon} size={17} />
                <span className="side-text">{it.label}</span>
                {it.count ? <em className="side-count">{it.count > 999 ? '999+' : it.count}</em> : null}
                {it.external && <Icon name="external" size={13} className="side-ext" />}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
