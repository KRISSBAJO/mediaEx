'use client'

import { useState } from 'react'

/**
 * The Developers section: a live request → response console. Pick an example, watch the request go out,
 * the real response come back and, for uploads, the signed webhook arrive. "Run again" replays it.
 * Every example matches the real public API (backend/media/v1.mts), webhooks (webhooks.mts) and transforms (transform.mts).
 */
type Flow = {
  key: string
  tab: string
  lang: string
  request: string
  resLabel: string
  status: string
  response: string
  event?: { name: string; to: string; result: string }
  frame?: boolean
}

const FLOWS: Flow[] = [
  {
    key: 'upload',
    tab: 'Upload',
    lang: 'cURL',
    request: `curl -X POST https://mediaex.io/api/v1/uploads \\
  -H "Authorization: Bearer $MEDIAEX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fileName": "launch.mp4",
    "size": 48211337
  }'`,
    resLabel: 'Response',
    status: '201 Created · 38 ms',
    response: `{
  "asset": {
    "id": "ast_k2v8m1",
    "title": "launch",
    "type": "video",
    "status": "uploading"
  },
  "upload": {
    "method": "PUT",
    "url": "https://r2.mediaex.io/ast_k2v8m1/original.mp4?X-Amz-…"
  }
}`,
    event: { name: 'asset.ready', to: 'api.northwind.app/hooks/mediaex', result: '200 · 84 ms' },
  },
  {
    key: 'search',
    tab: 'Search',
    lang: 'cURL',
    request: `curl "https://mediaex.io/api/v1/assets?q=sunset&type=video&limit=2" \\
  -H "Authorization: Bearer $MEDIAEX_KEY"`,
    resLabel: 'Response',
    status: '200 OK · 21 ms',
    response: `{
  "assets": [
    {
      "id": "ast_k2v8m1",
      "title": "Harbour sunset",
      "duration": 42.6,
      "playbackUrl": "https://mediaex.io/api/media/ast_k2v8m1/hls/master.m3u8"
    },
    { "id": "ast_p0d3x9", "title": "Sunset drone pass", "duration": 18.2 }
  ],
  "nextOffset": 2
}`,
  },
  {
    key: 'webhook',
    tab: 'Webhook',
    lang: 'TypeScript',
    request: `import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(raw: string, sig: string, key: string) {
  const [t, v1] = sig.split(',').map((p) => p.split('=')[1])
  const mac = createHmac('sha256', key).update(\`\${t}.\${raw}\`).digest()
  return timingSafeEqual(mac, Buffer.from(v1, 'hex'))
}`,
    resLabel: 'Incoming',
    status: 'verify() → true',
    response: `POST /hooks/mediaex
MediaEX-Event: asset.ready
MediaEX-Signature: t=1763573000,v1=5f2c9a41e0…

{
  "id": "evt_9jjz7oajfusaqj",
  "type": "asset.ready",
  "data": { "asset": { "id": "ast_k2v8m1", "status": "ready" } }
}`,
  },
  {
    key: 'transform',
    tab: 'Transform',
    lang: 'HTML',
    request: `<img
  src="https://mediaex.io/api/media/ast_k2v8m1/transform
       ?w=1200&h=630&fit=cover&f=auto"
  width="1200"
  height="630"
  alt="Harbour at dusk"
/>`,
    resLabel: 'Response',
    status: '200 OK · 92 KB',
    response: `content-type: image/avif
cache-control: public, max-age=86400
x-mediaex-cache: HIT`,
    frame: true,
  },
]

const KEYWORDS = new Set(['import', 'from', 'export', 'function', 'const', 'return', 'curl', 'POST'])

/** A small highlighter for the four known snippets: comments, strings, keywords, flags, env vars, JSON keys. */
function tokens(line: string) {
  const out: { c: string; t: string }[] = []
  const re = /(^\s*(?:#|\/\/).*$)|("[^"]*"(?=\s*:))|('[^']*'|"[^"]*"|`[^`]*`)|(^[A-Za-z-]+(?=:\s))|(\s-{1,2}[A-Za-z-]+)|(\$[A-Z_]+)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ c: '', t: line.slice(last, m.index) })
    const [all, cm, jkey, str, hdr, flag, env, num, word] = m
    if (cm) out.push({ c: 'cm', t: cm })
    else if (jkey || hdr) out.push({ c: 'key', t: all })
    else if (str) out.push({ c: 's', t: str })
    else if (flag) out.push({ c: 'k', t: flag })
    else if (env) out.push({ c: 'v', t: env })
    else if (num) out.push({ c: 'n', t: num })
    else if (word) out.push({ c: KEYWORDS.has(word) ? 'k' : line[m.index + word.length] === '(' ? 'f' : '', t: word })
    last = m.index + all.length
  }
  if (last < line.length) out.push({ c: '', t: line.slice(last) })
  return out
}

function Code({ text, from = 0, step = 0.035, numbered }: { text: string; from?: number; step?: number; numbered?: boolean }) {
  return (
    <pre className={`dx-code ${numbered ? 'is-numbered' : ''}`}>
      <code>
        {text.split('\n').map((line, n) => (
          <span key={n} className="dx-ln" style={{ ['--d' as string]: `${from + n * step}s` }}>
            {numbered && (
              <span className="dx-no" aria-hidden="true">
                {n + 1}
              </span>
            )}
            <span className="dx-text">
              {line
                ? tokens(line).map((t, k) =>
                    t.c ? (
                      <span key={k} className={t.c}>
                        {t.t}
                      </span>
                    ) : (
                      t.t
                    ),
                  )
                : ' '}
            </span>
          </span>
        ))}
      </code>
    </pre>
  )
}

export default function DevConsole() {
  const [i, setI] = useState(0)
  const [run, setRun] = useState(0)
  const [copied, setCopied] = useState(false)
  const f = FLOWS[i]
  const reqLines = f.request.split('\n').length
  const sendAt = 0.25 + reqLines * 0.035 + 0.15 // the request has finished writing
  const backAt = sendAt + 0.55 // the response arrives

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(f.request)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="dx">
      <div className="dx-bar">
        <div className="dx-tabs" role="tablist" aria-label="API examples">
          {FLOWS.map((x, n) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={n === i}
              className={`dx-tab ${n === i ? 'is-on' : ''}`}
              onClick={() => {
                setI(n)
                setRun((r) => r + 1)
              }}
            >
              {x.tab}
            </button>
          ))}
        </div>
        <div className="dx-tools">
          <button type="button" className="dx-btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="dx-btn" onClick={() => setRun((r) => r + 1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.5-3.55M13 3v2.5h-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Run again
          </button>
        </div>
      </div>

      <div
        className="dx-panes"
        key={`${f.key}-${run}`}
        role="tabpanel"
        style={{ ['--send' as string]: `${sendAt}s`, ['--back' as string]: `${backAt}s` }}
      >
        <section className="dx-pane">
          <header className="dx-label">
            <span>Request</span>
            <span className="dx-lang">{f.lang}</span>
          </header>
          <Code text={f.request} from={0.25} numbered />
        </section>

        <i className="dx-wire" aria-hidden="true" />

        <section className="dx-pane dx-res">
          <header className="dx-label">
            <span>{f.resLabel}</span>
            <span className="dx-status">
              <span className="is-wait">
                <i /> Waiting
              </span>
              <span className="is-ok">
                <i /> {f.status}
              </span>
            </span>
          </header>
          {f.frame && (
            <div className="dx-frame" style={{ ['--d' as string]: `${backAt}s` }}>
              <span>1200 × 630</span>
              <em>smart crop · AVIF for this browser</em>
            </div>
          )}
          <Code text={f.response} from={backAt + (f.frame ? 0.2 : 0)} step={0.04} />
          {f.event && (
            <div className="dx-event" style={{ ['--d' as string]: `${backAt + 1.4}s` }}>
              <span className="dx-event-kind">Webhook</span>
              <div>
                <b className="mono">{f.event.name}</b>
                <span className="mono">→ {f.event.to}</span>
              </div>
              <div className="dx-event-end">
                <span className="mono">{f.event.result}</span>
                <span className="dx-verified">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 8.5 2.5 2.5L12 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Signed
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
