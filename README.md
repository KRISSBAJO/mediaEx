# MediaEX

Landing page for MediaEX, the media cloud for creators and teams. Built with Next.js 16 (App Router) and Three.js.

## Run it

```bash
npm install
npm run dev   # http://localhost:3400
```

`npm run build` and `npm start` give the production build on the same port.

## What's where

- `app/page.tsx`: the page sections (hero, features, engine, workflow, developers, pricing, footer)
- `app/globals.css`: design tokens and all styles; the single blue accent is `--accent` at the top
- `components/HeroScene.tsx`: the full-screen Three.js hero (shader orb, particle galaxy, orbiting media tiles, bloom)
- `components/WaveTerrain.tsx`: the interactive point-field in the Engine section
- `components/palettes.ts`: the accent shades the 3D scenes use (keep in sync with `--accent`)
- `components/MotionRoot.tsx`: scroll reveals, counters, cursor spotlights

Motion respects `prefers-reduced-motion`.
