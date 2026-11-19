'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SIMPLEX_NOISE } from './noise'
import { currentPalette, type Palette } from './palettes'

function tilePairs(p: Palette): [string, string][] {
  return [
    [p.a, p.b],
    [p.c, p.a],
    [p.b, p.c],
    [p.a, p.c],
    [p.b, p.a],
    [p.c, p.b],
  ]
}

function rand(seed: number) {
  const x = Math.sin(seed * 9301.17 + 49297.3) * 233280.5
  return x - Math.floor(x)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Draws a little "media thumbnail" (video, audio or image) onto a canvas. */
function makeTileTexture(i: number, pal: Palette) {
  const W = 512
  const H = 288
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const pairs = tilePairs(pal)
  const [a, b] = pairs[i % pairs.length]
  const kind = i % 3

  ctx.save()
  roundRect(ctx, 4, 4, W - 8, H - 8, 30)
  ctx.clip()
  ctx.fillStyle = '#0b0d16'
  ctx.fillRect(0, 0, W, H)

  if (kind === 0) {
    // video
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, a)
    g.addColorStop(1, b)
    ctx.globalAlpha = 0.85
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
    for (let k = 0; k < 4; k++) {
      const x = rand(i * 7 + k) * W
      const y = rand(i * 13 + k) * H
      const r = 60 + rand(i + k * 3) * 120
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
      rg.addColorStop(0, 'rgba(255,255,255,0.35)')
      rg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = rg
      ctx.fillRect(0, 0, W, H)
    }
    const shade = ctx.createLinearGradient(0, H * 0.5, 0, H)
    shade.addColorStop(0, 'rgba(5,6,10,0)')
    shade.addColorStop(1, 'rgba(5,6,10,0.75)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, W, H)
    // play button
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.beginPath()
    ctx.arc(W / 2, H / 2 - 10, 40, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0b0d16'
    ctx.beginPath()
    ctx.moveTo(W / 2 - 12, H / 2 - 32)
    ctx.lineTo(W / 2 + 22, H / 2 - 10)
    ctx.lineTo(W / 2 - 12, H / 2 + 12)
    ctx.closePath()
    ctx.fill()
    // progress
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    roundRect(ctx, 28, H - 40, W - 56, 8, 4)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, 28, H - 40, (W - 56) * (0.25 + rand(i) * 0.6), 8, 4)
    ctx.fill()
    ctx.font = '600 20px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(`0${1 + (i % 8)}:${10 + i * 3} / 0${4 + (i % 5)}:36`, 28, H - 56)
    // badge
    ctx.fillStyle = 'rgba(5,6,10,0.55)'
    roundRect(ctx, 24, 24, 104, 36, 10)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '700 18px system-ui, sans-serif'
    ctx.fillText(i % 2 ? '4K HDR' : '8K RAW', 38, 49)
  } else if (kind === 1) {
    // audio waveform
    const g = ctx.createLinearGradient(0, 0, W, 0)
    g.addColorStop(0, a)
    g.addColorStop(1, b)
    const bars = 46
    const bw = (W - 64) / bars
    for (let k = 0; k < bars; k++) {
      const h = 18 + Math.abs(Math.sin(k * 0.45 + i) * Math.cos(k * 0.17 + i * 2)) * 130 + rand(i * 31 + k) * 30
      ctx.fillStyle = g
      ctx.globalAlpha = k / bars < 0.55 ? 1 : 0.35
      roundRect(ctx, 32 + k * bw, H / 2 - h / 2 - 12, bw * 0.6, h, 3)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.font = '600 20px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText(`master_mix_0${i}.flac`, 32, H - 34)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '500 17px system-ui, sans-serif'
    ctx.fillText('24-bit · 96 kHz · Atmos', W - 230, H - 34)
  } else {
    // image
    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, a)
    sky.addColorStop(1, b)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(W * 0.7, H * 0.36, 34, 0, Math.PI * 2)
    ctx.fill()
    const layers = ['rgba(5,6,10,0.35)', 'rgba(5,6,10,0.6)', 'rgba(5,6,10,0.85)']
    layers.forEach((col, l) => {
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let x = 0; x <= W; x += 32) {
        const y = H * (0.5 + l * 0.13) - Math.abs(Math.sin(x * 0.012 + i + l * 2)) * (70 - l * 15)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(W, H)
      ctx.closePath()
      ctx.fill()
    })
    ctx.fillStyle = 'rgba(5,6,10,0.55)'
    roundRect(ctx, 24, 24, 76, 36, 10)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '700 18px system-ui, sans-serif'
    ctx.fillText('RAW', 42, 49)
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 3
  roundRect(ctx, 4, 4, W - 8, H - 8, 30)
  ctx.stroke()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export default function HeroScene() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const speed = reduce ? 0.15 : 1
    const pal = currentPalette()

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    } catch {
      canvas.style.display = 'none'
      return
    }
    renderer.setClearColor(pal.bg, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(0, 0, 12)

    const world = new THREE.Group()
    scene.add(world)

    const disposables: { dispose: () => void }[] = []
    const track = <T extends { dispose: () => void }>(x: T) => {
      disposables.push(x)
      return x
    }

    /* ---------- core: a living, noise-displaced media orb ---------- */
    const coreUniforms = {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uColA: { value: new THREE.Color(pal.a) },
      uColB: { value: new THREE.Color(pal.b) },
      uColC: { value: new THREE.Color(pal.c) },
    }
    const core = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(1.55, 48)),
      track(
        new THREE.ShaderMaterial({
          uniforms: coreUniforms,
          vertexShader: /* glsl */ `
            ${SIMPLEX_NOISE}
            uniform float uTime;
            uniform float uPulse;
            varying float vDisp;
            varying vec3 vNormal;
            varying vec3 vView;
            varying vec3 vPos;
            void main() {
              vec3 p = position;
              float n = snoise(p * 1.1 + vec3(uTime * 0.22));
              float n2 = snoise(p * 3.2 - vec3(uTime * 0.35)) * 0.3;
              float wave = sin(p.y * 7.0 + uTime * 2.2) * 0.035;
              float d = (n + n2) * (0.2 + uPulse * 0.18) + wave;
              vDisp = d;
              vPos = p;
              p += normal * d;
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              vNormal = normalize(normalMatrix * normal);
              vView = normalize(-mv.xyz);
              gl_Position = projectionMatrix * mv;
            }
          `,
          fragmentShader: /* glsl */ `
            uniform vec3 uColA;
            uniform vec3 uColB;
            uniform vec3 uColC;
            uniform float uTime;
            uniform float uPulse;
            varying float vDisp;
            varying vec3 vNormal;
            varying vec3 vView;
            varying vec3 vPos;
            void main() {
              float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);
              float t = smoothstep(-0.28, 0.32, vDisp);
              vec3 col = mix(uColA, uColB, t);
              col = mix(col, uColC, smoothstep(0.12, 0.38, vDisp) * 0.75);
              vec3 base = col * (0.06 + 0.42 * t);
              float bands = smoothstep(0.92, 1.0, sin(vPos.y * 38.0 - uTime * 3.0) * 0.5 + 0.5);
              base += col * bands * 0.25;
              base += fres * mix(uColB, uColC, 0.3) * (0.75 + uPulse * 0.6);
              gl_FragColor = vec4(base, 1.0);
            }
          `,
        }),
      ),
    )
    world.add(core)

    const glowTex = track(makeGlowTexture())
    const halo = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: new THREE.Color(pal.a),
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    )
    halo.scale.setScalar(8.5)
    halo.renderOrder = -1
    world.add(halo)

    const shell = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(2.25, 2)),
      track(
        new THREE.MeshBasicMaterial({
          color: pal.b,
          wireframe: true,
          transparent: true,
          opacity: 0.07,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    )
    world.add(shell)

    /* ---------- galaxy of particles (the "media stream") ---------- */
    const small = window.innerWidth < 760
    const COUNT = small ? 4000 : 9000
    const aR = new Float32Array(COUNT)
    const aA = new Float32Array(COUNT)
    const aY = new Float32Array(COUNT)
    const aS = new Float32Array(COUNT)
    const gauss = () => {
      let u = 0
      let v = 0
      while (u === 0) u = Math.random()
      while (v === 0) v = Math.random()
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    }
    for (let i = 0; i < COUNT; i++) {
      const r = 2.5 + Math.pow(Math.random(), 1.5) * 8
      const arm = (i % 3) * ((Math.PI * 2) / 3)
      aR[i] = r
      aA[i] = arm + r * 0.55 + gauss() * (0.25 + r * 0.03)
      aY[i] = gauss() * 0.18 * (1 + r * 0.06)
      aS[i] = Math.random()
    }
    const pGeo = track(new THREE.BufferGeometry())
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    pGeo.setAttribute('aR', new THREE.BufferAttribute(aR, 1))
    pGeo.setAttribute('aA', new THREE.BufferAttribute(aA, 1))
    pGeo.setAttribute('aY', new THREE.BufferAttribute(aY, 1))
    pGeo.setAttribute('aS', new THREE.BufferAttribute(aS, 1))
    pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12)
    const pUniforms = {
      uTime: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uC1: { value: new THREE.Color(pal.a) },
      uC2: { value: new THREE.Color(pal.b) },
      uC3: { value: new THREE.Color(pal.c) },
    }
    const particles = new THREE.Points(
      pGeo,
      track(
        new THREE.ShaderMaterial({
          uniforms: pUniforms,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: /* glsl */ `
            uniform float uTime;
            uniform float uPixel;
            uniform vec3 uC1;
            uniform vec3 uC2;
            uniform vec3 uC3;
            attribute float aR;
            attribute float aA;
            attribute float aY;
            attribute float aS;
            varying vec3 vCol;
            varying float vAlpha;
            void main() {
              float ang = aA + uTime * (0.9 / (aR * 0.55 + 0.6)) * 0.22;
              vec3 p = vec3(cos(ang) * aR, aY + sin(uTime * 0.6 + aS * 6.2831) * 0.06, sin(ang) * aR);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = (aS * 2.2 + 0.7) * uPixel * (14.0 / -mv.z);
              float t = clamp((aR - 2.5) / 8.0, 0.0, 1.0);
              vCol = mix(uC1, uC2, t);
              vCol = mix(vCol, uC3, smoothstep(0.75, 1.0, aS) * 0.8);
              float twinkle = 0.65 + 0.35 * sin(uTime * 2.0 + aS * 40.0);
              vAlpha = (1.0 - t * 0.6) * (0.22 + 0.55 * aS) * twinkle;
            }
          `,
          fragmentShader: /* glsl */ `
            varying vec3 vCol;
            varying float vAlpha;
            void main() {
              float d = length(gl_PointCoord - 0.5);
              float a = smoothstep(0.5, 0.0, d);
              gl_FragColor = vec4(vCol, a * a * vAlpha);
            }
          `,
        }),
      ),
    )
    const galaxy = new THREE.Group()
    galaxy.rotation.set(0.42, 0, -0.18)
    galaxy.add(particles)
    world.add(galaxy)

    /* ---------- orbiting media tiles ---------- */
    const tileRing = new THREE.Group()
    tileRing.rotation.set(0.32, 0, -0.12)
    world.add(tileRing)
    const TILE_COUNT = small ? 8 : 12
    const tileGeo = track(new THREE.PlaneGeometry(1.5, 0.84))
    const tiles: { mesh: THREE.Mesh; angle: number; radius: number; y: number; phase: number }[] = []
    for (let i = 0; i < TILE_COUNT; i++) {
      const tex = track(makeTileTexture(i, pal))
      const mat = track(
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.4,
          color: new THREE.Color(0.74, 0.74, 0.78),
          side: THREE.DoubleSide,
        }),
      )
      const mesh = new THREE.Mesh(tileGeo, mat)
      const s = 0.7 + rand(i * 5) * 0.35
      mesh.scale.setScalar(s)
      tileRing.add(mesh)
      tiles.push({
        mesh,
        angle: (i / TILE_COUNT) * Math.PI * 2,
        radius: 4.1 + rand(i * 3) * 1.2,
        y: (rand(i * 11) - 0.5) * 1.6,
        phase: rand(i * 17) * Math.PI * 2,
      })
    }

    /* ---------- orbit lines + data packets ---------- */
    const orbits: { group: THREE.Group; packets: THREE.Sprite[]; radius: number; speed: number }[] = []
    const orbitDefs = [
      { radius: 3.05, tilt: [1.2, 0.2, 0.3], color: pal.b, speed: 0.5 },
      { radius: 3.6, tilt: [-0.9, 0.6, -0.4], color: pal.c, speed: -0.35 },
      { radius: 6.6, tilt: [0.42, 0, -0.18], color: pal.a, speed: 0.18 },
    ]
    orbitDefs.forEach((def) => {
      const pts: THREE.Vector3[] = []
      for (let k = 0; k <= 256; k++) {
        const a = (k / 256) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius))
      }
      const line = new THREE.Line(
        track(new THREE.BufferGeometry().setFromPoints(pts)),
        track(
          new THREE.LineBasicMaterial({
            color: def.color,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      )
      const group = new THREE.Group()
      group.rotation.set(def.tilt[0], def.tilt[1], def.tilt[2])
      group.add(line)
      const pMat = track(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: def.color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      const packets: THREE.Sprite[] = []
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Sprite(pMat)
        s.scale.setScalar(0.32)
        group.add(s)
        packets.push(s)
      }
      world.add(group)
      orbits.push({ group, packets, radius: def.radius, speed: def.speed })
    })

    /* ---------- post-processing ---------- */
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.32)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    /* ---------- layout / input ---------- */
    const layout = { x: 0, y: 0, scale: 1 }
    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      if (w >= 1100) Object.assign(layout, { x: 3.1, y: 0, scale: 1 })
      else if (w >= 760) Object.assign(layout, { x: 2.1, y: 0.2, scale: 0.85 })
      else Object.assign(layout, { x: 0, y: 1.9, scale: 0.68 })
    }
    resize()
    window.addEventListener('resize', resize)

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    let pulse = 0
    const onDown = (e: PointerEvent) => {
      if (window.scrollY > window.innerHeight * 0.8) return
      const target = e.target as HTMLElement
      if (target.closest('a, button, input')) return
      pulse = 1
    }
    window.addEventListener('pointerdown', onDown)

    /* ---------- loop ---------- */
    let raf = 0
    let last = performance.now()
    let time = 0
    let scrollEase = 0
    const tmp = new THREE.Vector3()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      time += dt * speed

      pointer.x += (pointer.tx - pointer.x) * 0.05
      pointer.y += (pointer.ty - pointer.y) * 0.05
      const sp = Math.min(window.scrollY / window.innerHeight, 2)
      scrollEase += (sp - scrollEase) * 0.08
      pulse = Math.max(0, pulse - dt * 0.9)
      const breathing = 0.25 + 0.25 * Math.sin(time * 0.9)

      coreUniforms.uTime.value = time
      coreUniforms.uPulse.value = breathing + pulse * 1.6
      pUniforms.uTime.value = time

      world.position.set(layout.x, layout.y + scrollEase * 1.6, 0)
      world.scale.setScalar(layout.scale * (1 + pulse * 0.06))
      world.rotation.y = pointer.x * 0.28 + scrollEase * 0.6
      world.rotation.x = pointer.y * 0.16 + scrollEase * 0.25
      core.rotation.y = time * 0.12
      core.rotation.x = time * 0.05
      shell.rotation.y = -time * 0.06
      shell.rotation.z = time * 0.03
      halo.material.opacity = 0.22 + breathing * 0.12 + pulse * 0.3

      tileRing.rotation.y = time * 0.07
      tiles.forEach((t) => {
        const a = t.angle
        t.mesh.position.set(Math.cos(a) * t.radius, t.y + Math.sin(time * 0.8 + t.phase) * 0.18, Math.sin(a) * t.radius)
        t.mesh.lookAt(camera.getWorldPosition(tmp))
      })

      orbits.forEach((o) => {
        o.packets.forEach((p, k) => {
          const a = time * o.speed + (k / o.packets.length) * Math.PI * 2
          p.position.set(Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius)
        })
      })

      camera.position.x = pointer.x * 0.6
      camera.position.y = -pointer.y * 0.4
      camera.position.z = 12 + scrollEase * 3.5
      camera.lookAt(layout.x * 0.35, layout.y * 0.5 + scrollEase * 1.2, 0)

      canvas.style.opacity = String(1 - Math.min(scrollEase, 1) * 0.62)
      bloom.strength = 0.55 + pulse * 0.5

      composer.render()
    }
    raf = requestAnimationFrame(frame)
    canvas.classList.add('is-ready')

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onDown)
      disposables.forEach((d) => d.dispose())
      bloom.dispose()
      composer.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />
}
