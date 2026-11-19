'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { currentPalette } from './palettes'

/** A field of glowing points that ripples like an audio spectrum. Renders only while on screen. */
export default function WaveTerrain() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const host = canvas.parentElement!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      canvas.style.display = 'none'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60)
    camera.position.set(0, 3.4, 8.5)
    camera.lookAt(0, -0.2, -1)

    const NX = window.innerWidth < 760 ? 110 : 170
    const NZ = window.innerWidth < 760 ? 60 : 90
    const SX = 18
    const SZ = 11
    const grid = new Float32Array(NX * NZ * 2)
    let k = 0
    for (let z = 0; z < NZ; z++) {
      for (let x = 0; x < NX; x++) {
        grid[k++] = (x / (NX - 1) - 0.5) * SX
        grid[k++] = (z / (NZ - 1) - 0.5) * SZ
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NX * NZ * 3), 3))
    geo.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20)

    const pal = currentPalette()
    const uniforms = {
      uC1: { value: new THREE.Color(pal.a) },
      uC2: { value: new THREE.Color(pal.b) },
      uC3: { value: new THREE.Color(pal.c) },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(100, 100) },
      uPixel: { value: renderer.getPixelRatio() },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uMouse;
        uniform float uPixel;
        attribute vec2 aGrid;
        varying float vH;
        varying float vScan;
        varying float vFade;
        void main() {
          float x = aGrid.x;
          float z = aGrid.y;
          float t = uTime;
          float h = sin(x * 0.55 + t * 1.1) * 0.32
                  + sin(z * 0.85 - t * 0.7) * 0.22
                  + sin((x + z) * 0.32 + t * 0.45) * 0.35;
          float spec = pow(abs(sin(x * 1.6 + t * 2.1) * sin(z * 0.45 - t * 0.9)), 3.0);
          h += spec * 0.55 * smoothstep(5.0, -1.0, z);
          float d = distance(vec2(x, z), uMouse);
          h += sin(d * 3.2 - t * 5.0) * 0.35 * exp(-d * 0.45);
          float scanZ = mod(t * 2.6, 16.0) - 8.0;
          vScan = exp(-pow((z - scanZ) * 1.6, 2.0));
          vH = h;
          vFade = (1.0 - smoothstep(6.0, 9.0, abs(x))) * (1.0 - smoothstep(3.5, 5.5, -z)) * smoothstep(5.5, 3.5, z);
          vec4 mv = modelViewMatrix * vec4(x, h, z, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.6 + vScan * 2.2 + max(h, 0.0) * 1.2) * uPixel * (7.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uC1;
        uniform vec3 uC2;
        uniform vec3 uC3;
        varying float vH;
        varying float vScan;
        varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          float t = smoothstep(-0.7, 0.9, vH);
          vec3 col = mix(uC1, uC2, t);
          col = mix(col, uC3, smoothstep(0.6, 1.1, vH));
          col += mix(uC2, vec3(1.0), 0.5) * vScan * 0.7;
          gl_FragColor = vec4(col, a * vFade * (0.35 + 0.65 * t + vScan * 0.6));
        }
      `,
    })
    scene.add(new THREE.Points(geo, mat))

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.position.z = w < 700 ? 10.5 : 8.5
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    const target = new THREE.Vector2(100, 100)
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      if (ray.ray.intersectPlane(plane, hit)) target.set(hit.x, hit.z)
    }
    const onLeave = () => target.set(100, 100)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)

    let raf = 0
    let running = false
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      uniforms.uTime.value += dt * (reduce ? 0.15 : 1)
      uniforms.uMouse.value.lerp(target, 0.08)
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

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      geo.dispose()
      mat.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={ref} className="terrain-canvas" aria-hidden="true" />
}
