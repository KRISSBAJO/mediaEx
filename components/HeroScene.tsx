'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/*
 * One object, lit like a product shot: a solid glass "play" prism.
 * Behind it sits a thin timeline ruler with an orange playhead, which refracts through the glass as it passes.
 * Light comes only from an environment of studio softboxes, so the glass shows real reflections, not glow.
 */

const ACCENT = '#ff5b1f'
const BG = '#0a0a0a'

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** Rounded equilateral triangle pointing +x, centred on its centroid. */
function playShape(radius: number, round: number) {
  const pts = [0, 1, 2].map((i) => {
    const a = (i * 2 * Math.PI) / 3
    return new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius)
  })
  const shape = new THREE.Shape()
  pts.forEach((p, i) => {
    const prev = pts[(i + 2) % 3]
    const next = pts[(i + 1) % 3]
    const a = p.clone().lerp(prev, round)
    const b = p.clone().lerp(next, round)
    if (i === 0) shape.moveTo(a.x, a.y)
    else shape.lineTo(a.x, a.y)
    shape.quadraticCurveTo(p.x, p.y, b.x, b.y)
  })
  shape.closePath()
  return shape
}

/** A dark studio with a few softboxes; used only as the reflection/lighting environment. */
function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene()
  env.background = new THREE.Color('#151514')
  const geo = new THREE.PlaneGeometry(1, 1)
  const box = (w: number, h: number, color: string, intensity: number, pos: [number, number, number]) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    m.color.multiplyScalar(intensity)
    const mesh = new THREE.Mesh(geo, m)
    mesh.scale.set(w, h, 1)
    mesh.position.set(...pos)
    mesh.lookAt(0, 0, 0)
    env.add(mesh)
    return m
  }
  const mats = [
    box(10, 3, '#ffffff', 4, [0, 7, 1]), // overhead key
    box(1.6, 9, '#ffffff', 6, [-7, 0.5, 2.5]), // tall strip, left
    box(1.2, 7, '#f2f1ee', 3, [6.5, 0, 3.5]), // fill strip, right
    box(6, 0.6, '#ffffff', 3, [0, -2, 7]), // low front kicker for the bevels
    box(14, 8, '#d9d8d4', 0.35, [0, 0, -8]), // soft back wall
    box(0.6, 5, ACCENT, 5, [5.5, 1, -5]), // a single warm accent strip behind, for an orange edge glint
  ]
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.035)
  pmrem.dispose()
  geo.dispose()
  mats.forEach((m) => m.dispose())
  return rt
}

export default function HeroScene() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    } catch {
      canvas.style.display = 'none'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(BG, 1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05

    const scene = new THREE.Scene()
    const envRT = studioEnvironment(renderer)
    scene.environment = envRT.texture

    const CAM_Z = 9
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50)
    camera.position.set(0, 0, CAM_Z)

    const rig = new THREE.Group() // positioned by layout
    scene.add(rig)

    /* ---------- the prism ---------- */
    let prismGeo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(playShape(1.2, 0.2), {
      depth: 0.62,
      bevelEnabled: true,
      bevelThickness: 0.2,
      bevelSize: 0.17,
      bevelSegments: 14,
      curveSegments: 48,
    })
    prismGeo.center()
    prismGeo.deleteAttribute('normal')
    prismGeo.deleteAttribute('uv')
    prismGeo = mergeVertices(prismGeo, 1e-4)
    prismGeo.computeVertexNormals()

    const glass = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      metalness: 0,
      roughness: 0.09,
      transmission: 1,
      thickness: 1.6,
      ior: 1.5,
      attenuationColor: new THREE.Color('#e6e2da'),
      attenuationDistance: 5,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      specularIntensity: 1,
      envMapIntensity: 1.5,
    })
    const prism = new THREE.Mesh(prismGeo, glass)
    const prismPivot = new THREE.Group()
    prismPivot.add(prism)
    rig.add(prismPivot)

    /* ---------- a soft spotlight backdrop, so the glass has light to bend ---------- */
    const spotCanvas = document.createElement('canvas')
    spotCanvas.width = spotCanvas.height = 512
    const sctx = spotCanvas.getContext('2d')!
    const sg = sctx.createRadialGradient(256, 236, 0, 256, 256, 256)
    sg.addColorStop(0, '#3b3935')
    sg.addColorStop(0.35, '#1f1e1c')
    sg.addColorStop(0.7, '#0e0e0d')
    sg.addColorStop(1, BG)
    sctx.fillStyle = sg
    sctx.fillRect(0, 0, 512, 512)
    const spotTex = new THREE.CanvasTexture(spotCanvas)
    spotTex.colorSpace = THREE.SRGBColorSpace
    const spotMat = new THREE.MeshBasicMaterial({ map: spotTex, toneMapped: false })
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), spotMat)
    spot.position.z = -4.5
    rig.add(spot)

    /* ---------- the timeline behind it ---------- */
    const TICKS = 51
    const SPACING = 0.062
    const SPAN = ((TICKS - 1) / 2) * SPACING
    const tickGeo = new THREE.PlaneGeometry(1, 1)
    const tickMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
    const ticks = new THREE.InstancedMesh(tickGeo, tickMat, TICKS)
    ticks.position.z = -1.6
    rig.add(ticks)
    const tickBase: { x: number; h: number; fade: number }[] = []
    const grey = new THREE.Color('#9a9994')
    const bg = new THREE.Color(BG)
    const tc = new THREE.Color()
    for (let i = 0; i < TICKS; i++) {
      const x = (i - (TICKS - 1) / 2) * SPACING
      const h = i % 10 === 0 ? 0.95 : i % 5 === 0 ? 0.55 : 0.26
      const fade = 1 - easeInOut(clamp01((Math.abs(x) / SPAN - 0.45) / 0.55))
      tickBase.push({ x, h, fade })
      tc.copy(bg).lerp(grey, fade * (i % 10 === 0 ? 1 : 0.75))
      ticks.setColorAt(i, tc)
    }
    const dummy = new THREE.Object3D()

    const playhead = new THREE.Group()
    playhead.position.z = -1.58
    const headMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true })
    const headLine = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 1.5), headMat)
    const headCap = new THREE.Mesh(new THREE.CircleGeometry(0.045, 32), headMat)
    headCap.position.y = 0.75
    playhead.add(headLine, headCap)
    rig.add(playhead)

    /* ---------- layout ---------- */
    const layout = { x: 0, y: 0, scale: 1 }
    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z
      const halfW = halfH * camera.aspect
      if (w >= 900) {
        const scale = Math.min(1, halfW / 5)
        Object.assign(layout, { x: Math.max(halfW * 0.55, halfW - 2.0 * scale), y: -0.05, scale })
      }
      else {
        // phones: the hero reserves a band above the text (its padding-top); centre the prism in that band
        const top = parseFloat(getComputedStyle(host).paddingTop) || 300
        const band = Math.max(top - 80, 120)
        const py = 80 + band / 2
        const pxPerUnit = h / (2 * halfH)
        Object.assign(layout, { x: 0, y: (1 - (2 * py) / h) * halfH, scale: (band * 0.78) / (2.4 * pxPerUnit) })
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    /* ---------- loop (runs only while the hero is on screen) ---------- */
    let raf = 0
    let running = false
    const start = performance.now()
    let last = start
    let time = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      time += dt

      const intro = reduce ? 1 : clamp01((now - start) / 1800)
      const introE = easeOutCubic(intro)
      pointer.x += (pointer.tx - pointer.x) * 0.05
      pointer.y += (pointer.ty - pointer.y) * 0.05
      const scroll = clamp01(window.scrollY / Math.max(host.clientHeight, 1))

      rig.position.set(layout.x, layout.y + scroll * 0.9, 0)
      rig.scale.setScalar(layout.scale)

      // prism: a deliberate three-quarter view, a slow sway, the cursor tilts it, scroll turns it away
      const sway = reduce ? 0 : Math.sin(time * 0.35) * 0.22
      prismPivot.rotation.y = -0.55 + sway + pointer.x * 0.35 + (1 - introE) * 0.9 + scroll * 0.9
      prismPivot.rotation.x = 0.12 + pointer.y * 0.22 - scroll * 0.35
      prismPivot.rotation.z = -0.04
      prismPivot.position.y = (reduce ? 0 : Math.sin(time * 0.6) * 0.04) - (1 - introE) * 0.35
      prismPivot.scale.setScalar(0.94 + introE * 0.06)

      // ticks rise from the centre outward
      for (let i = 0; i < TICKS; i++) {
        const t = tickBase[i]
        const grow = easeOutCubic(clamp01(intro * 1.6 - Math.abs(t.x) / SPAN * 0.6))
        dummy.position.set(t.x, 0, 0)
        dummy.scale.set(0.012, Math.max(t.h * grow, 0.0001), 1)
        dummy.updateMatrix()
        ticks.setMatrixAt(i, dummy.matrix)
      }
      ticks.instanceMatrix.needsUpdate = true

      // playhead sweeps the ruler every 9s and fades at the ends
      const loop = reduce ? 0.5 : (time / 9) % 1
      const px = -SPAN * 0.92 + loop * SPAN * 1.84
      playhead.position.x = px
      headMat.opacity = (1 - easeInOut(clamp01((Math.abs(px) / SPAN - 0.6) / 0.32))) * clamp01((intro - 0.5) * 2)

      renderer.render(scene, camera)
    }

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(frame)
      } else if (!entry.isIntersecting && running) {
        running = false
        cancelAnimationFrame(raf)
      }
    })
    io.observe(host)
    canvas.classList.add('is-ready')

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
      prismGeo.dispose()
      glass.dispose()
      spot.geometry.dispose()
      spotMat.dispose()
      spotTex.dispose()
      tickGeo.dispose()
      tickMat.dispose()
      ticks.dispose()
      headLine.geometry.dispose()
      headCap.geometry.dispose()
      headMat.dispose()
      envRT.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />
}
