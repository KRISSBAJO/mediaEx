'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
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

const easeOutQuart = (x: number) => 1 - Math.pow(1 - x, 4)
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3)
const easeOutBack = (x: number) => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

const BEAT = 1.5 // seconds between "kicks"
const INTRO = 3 // seconds for the opening sequence

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
    const colA = new THREE.Color(pal.a)
    const colB = new THREE.Color(pal.b)
    const colC = new THREE.Color(pal.c)
    const small = window.innerWidth < 760

    /* ---------- core: a living orb that leans toward the cursor ---------- */
    const coreUniforms = {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uPtrDir: { value: new THREE.Vector3(0, 0, 1) },
      uPtrStr: { value: 0 },
      uColA: { value: colA },
      uColB: { value: colB },
      uColC: { value: colC },
    }
    const core = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(1.55, small ? 32 : 56)),
      track(
        new THREE.ShaderMaterial({
          uniforms: coreUniforms,
          vertexShader: /* glsl */ `
            ${SIMPLEX_NOISE}
            uniform float uTime;
            uniform float uPulse;
            uniform vec3 uPtrDir;
            uniform float uPtrStr;
            varying float vDisp;
            varying float vHot;
            varying vec3 vNormal;
            varying vec3 vView;
            varying vec3 vPos;
            void main() {
              vec3 p = position;
              vec3 dir = normalize(position);
              float n = snoise(p * 1.1 + vec3(uTime * 0.22));
              float n2 = snoise(p * 3.2 - vec3(uTime * 0.35)) * 0.3;
              float wave = sin(p.y * 7.0 + uTime * 2.2) * 0.035;
              float hot = pow(max(dot(dir, uPtrDir), 0.0), 5.0) * uPtrStr;
              float d = (n + n2) * (0.2 + uPulse * 0.16) + wave + hot * (0.42 + n * 0.12);
              vDisp = d;
              vHot = hot;
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
            varying float vHot;
            varying vec3 vNormal;
            varying vec3 vView;
            varying vec3 vPos;
            void main() {
              float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);
              float t = smoothstep(-0.28, 0.32, vDisp);
              vec3 col = mix(uColA, uColB, t);
              col = mix(col, uColC, smoothstep(0.12, 0.38, vDisp) * 0.75);
              vec3 base = col * (0.05 + 0.4 * t);
              float bands = smoothstep(0.93, 1.0, sin(vPos.y * 38.0 - uTime * 3.0) * 0.5 + 0.5);
              base += col * bands * (0.2 + uPulse * 0.25);
              base += fres * mix(uColB, uColC, 0.3) * (0.7 + uPulse * 0.55);
              base += uColC * vHot * 0.55;
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
          color: colA,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    )
    halo.scale.setScalar(8.5)
    halo.renderOrder = -1
    world.add(halo)

    const shell = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(2.2, 2)),
      track(
        new THREE.MeshBasicMaterial({
          color: colB,
          wireframe: true,
          transparent: true,
          opacity: 0.06,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    )
    world.add(shell)

    /* ---------- spectrum ring: a circular audio visualiser around the orb ---------- */
    const BARS = small ? 84 : 128
    const RING_R = 2.55
    const spectrum = new THREE.Group()
    world.add(spectrum)
    const barGeo = track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))
    const barMat = track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    const bars = new THREE.InstancedMesh(barGeo, barMat, BARS)
    bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    spectrum.add(bars)
    const ringPts: THREE.Vector3[] = []
    for (let k = 0; k <= 200; k++) {
      const a = (k / 200) * Math.PI * 2
      ringPts.push(new THREE.Vector3(Math.cos(a) * (RING_R - 0.06), Math.sin(a) * (RING_R - 0.06), 0))
    }
    const ringLine = new THREE.Line(
      track(new THREE.BufferGeometry().setFromPoints(ringPts)),
      track(
        new THREE.LineBasicMaterial({
          color: colB,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    )
    spectrum.add(ringLine)
    const dummy = new THREE.Object3D()
    const barCol = new THREE.Color()
    const barLevels = new Float32Array(BARS)

    /* ---------- galaxy of particles, swirls in on load, ripples with shockwaves ---------- */
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
    pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30)
    const pUniforms = {
      uTime: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uIntro: { value: 0 },
      uWaveR: { value: -10 },
      uWaveA: { value: 0 },
      uC1: { value: colA },
      uC2: { value: colB },
      uC3: { value: colC },
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
            uniform float uIntro;
            uniform float uWaveR;
            uniform float uWaveA;
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
              float r = aR * mix(2.6, 1.0, uIntro);
              float ang = aA + uTime * (0.9 / (aR * 0.55 + 0.6)) * 0.22 + (1.0 - uIntro) * 3.5 / (aR * 0.25 + 0.4);
              float wave = exp(-pow((r - uWaveR) * 1.3, 2.0)) * uWaveA;
              vec3 p = vec3(cos(ang) * r, aY + sin(uTime * 0.6 + aS * 6.2831) * 0.06 + wave * 0.45, sin(ang) * r);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = (aS * 2.2 + 0.7) * (1.0 + wave * 1.6) * uPixel * (14.0 / -mv.z);
              float t = clamp((aR - 2.5) / 8.0, 0.0, 1.0);
              vCol = mix(uC1, uC2, t);
              vCol = mix(vCol, uC3, clamp(smoothstep(0.75, 1.0, aS) * 0.8 + wave, 0.0, 1.0));
              float twinkle = 0.65 + 0.35 * sin(uTime * 2.0 + aS * 40.0);
              vAlpha = ((1.0 - t * 0.6) * (0.22 + 0.55 * aS) * twinkle + wave * 0.6) * uIntro;
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

    /* ---------- inflow streams: media pouring into the core ---------- */
    const STREAMS = small ? 5 : 8
    const PER = small ? 90 : 170
    const SN = STREAMS * PER
    const sStart = new Float32Array(SN * 3)
    const sCtrl = new Float32Array(SN * 3)
    const sJit = new Float32Array(SN * 3)
    const sOff = new Float32Array(SN)
    const sSeed = new Float32Array(SN)
    for (let s = 0; s < STREAMS; s++) {
      const th = (s / STREAMS) * Math.PI * 2 + Math.random() * 0.5
      const ph = (Math.random() - 0.5) * 0.9
      const R = 8 + Math.random() * 2.5
      const start = new THREE.Vector3(Math.cos(th) * Math.cos(ph) * R, Math.sin(ph) * R, Math.sin(th) * Math.cos(ph) * R)
      const ctrl = start.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.15).multiplyScalar(0.5)
      ctrl.y += (Math.random() - 0.5) * 2.5
      const phase = Math.random()
      for (let k = 0; k < PER; k++) {
        const i = s * PER + k
        start.toArray(sStart, i * 3)
        ctrl.toArray(sCtrl, i * 3)
        sJit[i * 3] = gauss() * 0.16
        sJit[i * 3 + 1] = gauss() * 0.16
        sJit[i * 3 + 2] = gauss() * 0.16
        sOff[i] = phase + k / PER + Math.random() * 0.01
        sSeed[i] = Math.random()
      }
    }
    const sGeo = track(new THREE.BufferGeometry())
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 3), 3))
    sGeo.setAttribute('aStart', new THREE.BufferAttribute(sStart, 3))
    sGeo.setAttribute('aCtrl', new THREE.BufferAttribute(sCtrl, 3))
    sGeo.setAttribute('aJit', new THREE.BufferAttribute(sJit, 3))
    sGeo.setAttribute('aOff', new THREE.BufferAttribute(sOff, 1))
    sGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 1))
    sGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14)
    const sUniforms = {
      uTime: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uIntro: { value: 0 },
      uC2: { value: colB },
      uC3: { value: colC },
    }
    const streams = new THREE.Points(
      sGeo,
      track(
        new THREE.ShaderMaterial({
          uniforms: sUniforms,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: /* glsl */ `
            uniform float uTime;
            uniform float uPixel;
            uniform float uIntro;
            uniform vec3 uC2;
            uniform vec3 uC3;
            attribute vec3 aStart;
            attribute vec3 aCtrl;
            attribute vec3 aJit;
            attribute float aOff;
            attribute float aSeed;
            varying vec3 vCol;
            varying float vAlpha;
            void main() {
              float t = fract(uTime * 0.16 + aOff);
              float e = t * t;
              vec3 a = mix(aStart, aCtrl, e);
              vec3 b = mix(aCtrl, vec3(0.0), e);
              vec3 p = mix(a, b, e) + aJit * (1.0 - e);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = (1.0 + aSeed * 1.8) * (0.6 + e * 0.8) * uPixel * (14.0 / -mv.z);
              vCol = mix(uC2, uC3, e);
              vAlpha = smoothstep(0.0, 0.18, t) * smoothstep(1.0, 0.85, t) * (0.3 + 0.7 * aSeed) * uIntro;
            }
          `,
          fragmentShader: /* glsl */ `
            varying vec3 vCol;
            varying float vAlpha;
            void main() {
              float d = length(gl_PointCoord - 0.5);
              float a = smoothstep(0.5, 0.0, d);
              gl_FragColor = vec4(vCol, a * vAlpha);
            }
          `,
        }),
      ),
    )
    world.add(streams)

    /* ---------- shockwaves (on the beat and on click) ---------- */
    const waveGeo = track(new THREE.PlaneGeometry(2, 2))
    type Wave = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; power: number; active: boolean }
    const waves: Wave[] = []
    for (let k = 0; k < 3; k++) {
      const mat = track(
        new THREE.ShaderMaterial({
          uniforms: { uProg: { value: 0 }, uPower: { value: 1 }, uColor: { value: colC } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uProg;
            uniform float uPower;
            uniform vec3 uColor;
            varying vec2 vUv;
            void main() {
              float d = length(vUv - 0.5) * 2.0;
              float ring = exp(-pow((d - 0.9) * 16.0, 2.0));
              float inner = smoothstep(0.9, 0.2, d) * 0.06;
              float fade = (1.0 - uProg) * (1.0 - uProg);
              gl_FragColor = vec4(uColor, (ring + inner) * fade * uPower);
            }
          `,
        }),
      )
      const mesh = new THREE.Mesh(waveGeo, mat)
      mesh.visible = false
      world.add(mesh)
      waves.push({ mesh, mat, t: 1, power: 1, active: false })
    }
    let lastWave: Wave | null = null
    const fireWave = (power: number) => {
      const w = waves.find((x) => !x.active) ?? waves.reduce((a, b) => (a.t > b.t ? a : b))
      w.t = 0
      w.power = power
      w.active = true
      w.mesh.visible = true
      lastWave = w
    }

    /* ---------- orbiting media tiles ---------- */
    const tileRing = new THREE.Group()
    tileRing.rotation.set(0.32, 0, -0.12)
    world.add(tileRing)
    const TILE_COUNT = small ? 8 : 12
    const tileGeo = track(new THREE.PlaneGeometry(1.5, 0.84))
    const tiles: { mesh: THREE.Mesh; angle: number; radius: number; y: number; phase: number; s: number }[] = []
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
      mesh.scale.setScalar(0.001)
      tileRing.add(mesh)
      tiles.push({
        mesh,
        angle: (i / TILE_COUNT) * Math.PI * 2,
        radius: 4.2 + rand(i * 3) * 1.2,
        y: (rand(i * 11) - 0.5) * 1.6,
        phase: rand(i * 17) * Math.PI * 2,
        s: 0.7 + rand(i * 5) * 0.35,
      })
    }

    /* ---------- orbit lines + data packets ---------- */
    const orbits: { packets: THREE.Sprite[]; radius: number; speed: number; mat: THREE.LineBasicMaterial }[] = []
    const orbitDefs = [
      { radius: 3.15, tilt: [1.2, 0.2, 0.3], color: colB, speed: 0.5 },
      { radius: 3.7, tilt: [-0.9, 0.6, -0.4], color: colC, speed: -0.35 },
      { radius: 6.6, tilt: [0.42, 0, -0.18], color: colA, speed: 0.18 },
    ]
    orbitDefs.forEach((def) => {
      const pts: THREE.Vector3[] = []
      for (let k = 0; k <= 256; k++) {
        const a = (k / 256) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * def.radius, 0, Math.sin(a) * def.radius))
      }
      const mat = track(
        new THREE.LineBasicMaterial({
          color: def.color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      const group = new THREE.Group()
      group.rotation.set(def.tilt[0], def.tilt[1], def.tilt[2])
      group.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), mat))
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
        s.scale.setScalar(0.3)
        group.add(s)
        packets.push(s)
      }
      world.add(group)
      orbits.push({ packets, radius: def.radius, speed: def.speed, mat })
    })

    /* ---------- post-processing: bloom + a quiet film finish ---------- */
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.32)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    const film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAberr: { value: 0.006 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAberr;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c);
          vec2 off = c * uAberr * d;
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + off).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - off).b;
          col *= mix(1.0, 0.6, smoothstep(0.4, 0.95, d));
          col += (hash(vUv * 900.0 + fract(uTime * 7.0) * 50.0) - 0.5) * 0.03;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    composer.addPass(film)

    /* ---------- layout / input ---------- */
    const layout = { x: 0, y: 0, scale: 1 }
    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // keep the orb + spectrum ring clear of the headline, but on screen
      const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 12 * camera.aspect
      if (w >= 1100) Object.assign(layout, { x: Math.min(3.7, halfW - 3.3), y: 0, scale: 1 })
      else if (w >= 760) Object.assign(layout, { x: 2.1, y: 0.2, scale: 0.85 })
      else Object.assign(layout, { x: 0, y: 1.9, scale: 0.68 })
    }
    resize()
    window.addEventListener('resize', resize)

    const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false }
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
      pointer.active = e.pointerType === 'mouse'
    }
    const onLeave = () => {
      pointer.active = false
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)

    let pulse = 0
    const onDown = (e: PointerEvent) => {
      if (window.scrollY > window.innerHeight * 0.8) return
      const target = e.target as HTMLElement
      if (target.closest('a, button, input')) return
      pulse = 1
      fireWave(1.4)
    }
    window.addEventListener('pointerdown', onDown)

    /* ---------- loop ---------- */
    let raf = 0
    const start = performance.now()
    let last = start
    let time = 0
    let scrollEase = 0
    let lastBeat = -1
    let introWaveFired = false
    const camPos = new THREE.Vector3()
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const center = new THREE.Vector3()
    const closest = new THREE.Vector3()
    const ptrLocal = new THREE.Vector3()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // decays use real elapsed time so a slow or throttled frame rate never leaves pulses stuck on
      const realDt = Math.min((now - last) / 1000, 0.5)
      const dt = Math.min(realDt, 0.05)
      last = now
      time += dt * speed

      // intro: 0 → 1 over the first seconds
      const introT = reduce ? 1 : clamp01((now - start) / 1000 / INTRO)
      const introE = easeOutQuart(introT)
      const orbIn = easeOutBack(clamp01((introT - 0.12) / 0.6))
      if (!introWaveFired && introT > 0.55) {
        introWaveFired = true
        if (!reduce) {
          fireWave(1.6)
          pulse = 0.8
        }
      }

      // beat
      const beatIdx = Math.floor(time / BEAT)
      const phase = (time % BEAT) / BEAT
      const beat = Math.exp(-phase * 6) * (introT >= 1 ? 1 : 0)
      if (beatIdx !== lastBeat) {
        lastBeat = beatIdx
        if (!reduce && introT >= 1 && beatIdx % 4 === 0) fireWave(0.7)
      }

      pointer.x += (pointer.tx - pointer.x) * 0.06
      pointer.y += (pointer.ty - pointer.y) * 0.06
      const sp = Math.min(window.scrollY / window.innerHeight, 2)
      scrollEase += (sp - scrollEase) * 0.08
      pulse = Math.max(0, pulse - realDt * 0.9)
      const breathing = 0.25 + 0.25 * Math.sin(time * 0.9)

      coreUniforms.uTime.value = time
      coreUniforms.uPulse.value = breathing * 0.7 + beat * 0.55 + pulse * 1.6
      pUniforms.uTime.value = time
      pUniforms.uIntro.value = introE
      sUniforms.uTime.value = time
      sUniforms.uIntro.value = clamp01((introT - 0.3) / 0.7)

      world.position.set(layout.x, layout.y + scrollEase * 1.6, 0)
      world.scale.setScalar(layout.scale * (1 + pulse * 0.05 + beat * 0.012))
      world.rotation.y = pointer.x * 0.28 + scrollEase * 0.6 + (1 - introE) * -1.2
      world.rotation.x = pointer.y * 0.16 + scrollEase * 0.25
      core.scale.setScalar(Math.max(orbIn, 0.001))
      shell.scale.setScalar(Math.max(orbIn, 0.001) * (1 + beat * 0.03))
      core.rotation.y = time * 0.12
      core.rotation.x = time * 0.05
      shell.rotation.y = -time * 0.06
      shell.rotation.z = time * 0.03
      halo.material.opacity = (0.2 + breathing * 0.1 + beat * 0.12 + pulse * 0.3) * introE

      camera.position.x = pointer.x * 0.6
      camera.position.y = -pointer.y * 0.4
      camera.position.z = 12 + scrollEase * 3.5 + (1 - introE) * 9
      camera.lookAt(layout.x * 0.35, layout.y * 0.5 + scrollEase * 1.2, 0)
      camera.updateMatrixWorld()
      camera.getWorldPosition(camPos)
      world.updateMatrixWorld(true)

      // spectrum ring faces the camera; bars follow a mirrored fake spectrum
      spectrum.lookAt(camPos)
      const specIn = clamp01((introT - 0.45) / 0.55)
      for (let i = 0; i < BARS; i++) {
        const th = (i / BARS) * Math.PI * 2 + Math.PI / 2
        const band = Math.abs(((i / BARS) * 2) % 2 - 1) // 0 at top, 1 at bottom, mirrored
        const a = 0.5 + 0.5 * Math.sin(time * 3.1 + band * 13.0)
        const b = 0.5 + 0.5 * Math.sin(time * 1.7 + band * 5.3 + 1.3)
        const c = 0.5 + 0.5 * Math.sin(time * 5.3 + band * 29.0)
        const target = (0.05 + a * b * 0.55 + c * 0.12 + beat * 0.5 * (1 - band * 0.5) + pulse * 0.6) * specIn
        barLevels[i] += (target - barLevels[i]) * (target > barLevels[i] ? 0.5 : 0.12)
        const h = barLevels[i]
        dummy.position.set(Math.cos(th) * RING_R, Math.sin(th) * RING_R, 0)
        dummy.rotation.set(0, 0, th - Math.PI / 2)
        dummy.scale.set(0.045, Math.max(h, 0.001), 0.045)
        dummy.updateMatrix()
        bars.setMatrixAt(i, dummy.matrix)
        barCol.copy(colA).lerp(colC, clamp01(h * 1.3)).multiplyScalar(0.55 + h)
        bars.setColorAt(i, barCol)
      }
      bars.instanceMatrix.needsUpdate = true
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true
      ;(ringLine.material as THREE.LineBasicMaterial).opacity = 0.35 * specIn

      // shockwaves
      let waveR = -10
      let waveA = 0
      waves.forEach((w) => {
        if (!w.active) return
        w.t += realDt / 1.8
        if (w.t >= 1) {
          w.active = false
          w.mesh.visible = false
          return
        }
        const sc = 1.7 + easeOutCubic(w.t) * 8
        w.mesh.scale.setScalar(sc)
        w.mesh.lookAt(camPos)
        w.mat.uniforms.uProg.value = w.t
        w.mat.uniforms.uPower.value = w.power
        if (w === lastWave) {
          waveR = sc * 0.9
          waveA = (1 - w.t) * Math.min(w.power, 1.2)
        }
      })
      pUniforms.uWaveR.value = waveR
      pUniforms.uWaveA.value = waveA

      // tiles fly in one after another
      tileRing.rotation.y = time * 0.07
      tiles.forEach((t, i) => {
        const appear = easeOutCubic(clamp01((introT - 0.35 - (i / TILE_COUNT) * 0.35) / 0.4))
        const r = t.radius * (1 + (1 - appear) * 1.4)
        t.mesh.position.set(Math.cos(t.angle) * r, t.y + Math.sin(time * 0.8 + t.phase) * 0.18, Math.sin(t.angle) * r)
        t.mesh.scale.setScalar(Math.max(t.s * appear, 0.001))
        t.mesh.lookAt(camPos)
      })

      orbits.forEach((o) => {
        o.mat.opacity = 0.2 * introE
        o.packets.forEach((p, k) => {
          const a = time * o.speed + (k / o.packets.length) * Math.PI * 2
          p.position.set(Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius)
        })
      })

      // the orb leans toward the cursor
      let ptrTarget = 0
      if (pointer.active) {
        ndc.set(pointer.x, -pointer.y)
        ray.setFromCamera(ndc, camera)
        core.getWorldPosition(center)
        ray.ray.closestPointToPoint(center, closest)
        const dist = closest.distanceTo(center) / world.scale.x
        ptrTarget = clamp01((5 - dist) / 3.6) * introE
        ptrLocal.copy(closest)
        core.worldToLocal(ptrLocal)
        if (ptrLocal.lengthSq() > 1e-6) {
          ptrLocal.normalize()
          coreUniforms.uPtrDir.value.lerp(ptrLocal, 0.15).normalize()
        }
      }
      coreUniforms.uPtrStr.value += (ptrTarget - coreUniforms.uPtrStr.value) * 0.08

      canvas.style.opacity = String(1 - Math.min(scrollEase, 1) * 0.62)
      bloom.strength = 0.55 + beat * 0.12 + pulse * 0.5
      film.uniforms.uTime.value = time
      film.uniforms.uAberr.value = 0.006 + beat * 0.004 + pulse * 0.02

      composer.render()
    }
    raf = requestAnimationFrame(frame)
    canvas.classList.add('is-ready')

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onDown)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      disposables.forEach((d) => d.dispose())
      bars.dispose()
      bloom.dispose()
      film.dispose()
      composer.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />
}
