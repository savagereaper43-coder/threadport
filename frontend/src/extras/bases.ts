import type { Box, Face } from '../studio/model'
import { assetImage } from '../studio/assets'
import { loadImage, surface } from '../studio/raster'
import { templates } from '../template'
import type { TemplateKind } from '../template'
import { pngForCanvas } from './artwork'

export const bases = {
  hoodie: { name: 'Hoodie', kind: 'shirt' },
  jersey: { name: 'Jersey', kind: 'shirt' },
  jeans: { name: 'Jeans', kind: 'pants' },
  joggers: { name: 'Joggers', kind: 'pants' },
} as const
export type Base = keyof typeof bases
export type Generated = { name: string; mode: TemplateKind; png: string; profile?: 'hoodie' | 't_shirt' | 'pants' }

function sampleFabric(image: HTMLImageElement, mode: TemplateKind | undefined, avoid: Box[]) {
  const scale = mode ? 1 : Math.min(1, 720 / Math.max(image.width, image.height))
  const ctx = surface(image.width * scale, image.height * scale)
  const { width, height } = ctx.canvas
  ctx.drawImage(image, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  const size = Math.max(2, 2 * Math.floor(Math.min(48, width, height) / 2))
  let best: { x: number; y: number; cost: number } | undefined
  const faces = mode ? templates[mode].regions : [{ x: 0, y: 0, w: width, h: height, part: 'torso', face: 'front' }]
  let fallback: [number, number, number] = [86, 96, 113]
  let fallbackFound = false
  for (const face of faces) {
    for (let y = face.y; y <= face.y + face.h - size; y += 8) {
      for (let x = face.x; x <= face.x + face.w - size; x += 8) {
        if (avoid.some((area) => x < area.x + area.w && x + size > area.x && y < area.y + area.h && y + size > area.y)) continue
        let opaque = 0, steps = 0, hardEdges = 0
        for (let dy = 0; dy < size; dy += 2) {
          for (let dx = 0; dx < size; dx += 2) {
            const i = ((y + dy) * width + x + dx) * 4
            if (data[i + 3] < 250) continue
            if (!fallbackFound) {
              fallback = [data[i], data[i + 1], data[i + 2]]
              fallbackFound = true
            }
            opaque++
            if (dx) {
              const edge = Math.abs(data[i] - data[i - 8]) + Math.abs(data[i + 1] - data[i - 7]) + Math.abs(data[i + 2] - data[i - 6])
              steps += edge
              if (edge > 120) hardEdges++
            }
          }
        }
        if (opaque !== size * size / 4) continue
        // Prefer the lower torso while keeping recognizable fabric texture.
        const cost = Math.abs(steps / (opaque * 3) - 5) + hardEdges * .7
          + (face.part === 'torso' && face.face === 'front' ? 0 : 4)
          + (y < face.y + face.h * .4 ? 5 : 0)
        if (!best || cost < best.cost) best = { x, y, cost }
      }
    }
  }

  const chip = surface(size, size)
  if (best) {
    chip.drawImage(ctx.canvas, best.x, best.y, size, size, 0, 0, size, size)
    const frame = chip.getImageData(0, 0, size, size)
    const clean = frame.data.every((value, index) => index % 4 !== 3 || value > 245)
    if (clean) return chip.canvas
  }
  if (!fallbackFound) {
    const firstFabric = data.findIndex((value, index) => index % 4 === 3 && value >= 240)
    if (firstFabric >= 3) fallback = [data[firstFabric - 3], data[firstFabric - 2], data[firstFabric - 1]]
  }
  chip.fillStyle = `rgb(${fallback.join(',')})`
  chip.fillRect(0, 0, size, size)
  return chip.canvas
}

function shade(ctx: CanvasRenderingContext2D, w: number, h: number, side: string) {
  const light = ctx.createLinearGradient(0, 0, w, 0)
  light.addColorStop(0, '#0005')
  light.addColorStop(.35, '#fff1')
  light.addColorStop(.7, '#fff0')
  light.addColorStop(1, '#0005')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, w, h)
  if (side === 'back' || side === 'down') {
    ctx.fillStyle = '#0002'
    ctx.fillRect(0, 0, w, h)
  }
}

function drawBodyDetail(ctx: CanvasRenderingContext2D, name: Base, face: Face) {
  const { w, h } = face
  const center = w / 2
  const front = face.face === 'front'
  ctx.fillStyle = '#0004'
  ctx.strokeStyle = '#eee6'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.2

  if (name === 'hoodie' && face.face === 'back') {
    ctx.beginPath()
    ctx.moveTo(center - 30, 1)
    ctx.bezierCurveTo(center - 38, 29, center - 15, 48, center, 53)
    ctx.bezierCurveTo(center + 23, 46, center + 35, 27, center + 30, 1)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  if (name === 'hoodie' && front) {
    ctx.beginPath()
    ctx.moveTo(center - 13, 8)
    ctx.quadraticCurveTo(center - 17, 22, center - 15, 39)
    ctx.moveTo(center + 13, 8)
    ctx.quadraticCurveTo(center + 16, 23, center + 15, 34)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(center - 26, h - 16)
    ctx.lineTo(center - 38, h - 32)
    ctx.lineTo(center - 23, h - 45)
    ctx.lineTo(center + 23, h - 45)
    ctx.lineTo(center + 38, h - 32)
    ctx.lineTo(center + 26, h - 16)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  if (name === 'jersey' && (front || face.face === 'back')) {
    ctx.strokeStyle = '#fff8'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(center - 19, 0)
    ctx.lineTo(center, front ? 24 : 10)
    ctx.lineTo(center + 19, 0)
    ctx.stroke()
    ctx.fillStyle = '#fff3'
    ctx.fillRect(9, 1, 5, h)
    ctx.fillRect(w - 14, 1, 5, h)
  }
  if (name === 'joggers' && front) {
    ctx.beginPath()
    ctx.moveTo(center - 10, 6)
    ctx.quadraticCurveTo(center - 18, 18, center - 12, 27)
    ctx.moveTo(center + 10, 6)
    ctx.quadraticCurveTo(center + 14, 18, center + 9, 25)
    ctx.stroke()
  }
  if (name === 'jeans' && front) {
    ctx.strokeStyle = '#e1ac758a'
    ctx.beginPath()
    ctx.moveTo(14, 10)
    ctx.quadraticCurveTo(19, 30, 42, 34)
    ctx.moveTo(w - 14, 10)
    ctx.quadraticCurveTo(w - 19, 30, w - 42, 34)
    ctx.moveTo(center + 6, 11)
    ctx.quadraticCurveTo(center + 6, 39, center, 44)
    ctx.stroke()
  }
}

export async function generateBase(key: Base, image: HTMLImageElement, mode?: TemplateKind, name: string = bases[key].name, avoid: Box[] = []): Promise<Generated> {
  const texture = sampleFabric(image, mode, avoid)
  const mirrored = surface(texture.width * 2, texture.height * 2)
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      mirrored.save()
      mirrored.translate(x * texture.width * 2, y * texture.height * 2)
      mirrored.scale(x ? -1 : 1, y ? -1 : 1)
      mirrored.drawImage(texture, 0, 0)
      mirrored.restore()
    }
  }
  const { kind } = bases[key]
  const { width, height, regions } = templates[kind]
  const ctx = surface(width, height)
  const material = ctx.createPattern(mirrored.canvas, 'repeat')!
  const pocket = key === 'jeans' ? await loadImage(assetImage('Pocket', '#daa778')) : undefined
  for (const face of regions) {
    const limb = face.part !== 'torso'
    if (key === 'jersey' && limb && face.face === 'down') continue
    const h = key === 'jersey' && limb && face.h === 128 ? 52 : face.h
    ctx.save()
    ctx.translate(face.x, face.y)
    ctx.beginPath()
    ctx.rect(0, 0, face.w, h)
    ctx.clip()
    ctx.fillStyle = material
    ctx.fillRect(0, 0, face.w, h)
    shade(ctx, face.w, h, face.face)
    if (face.h === 128) {
      ctx.fillStyle = key === 'jersey' ? '#fff6' : '#0005'
      if (limb) {
        ctx.fillRect(0, h - 7, face.w, 7)
        if (key === 'jeans' || key === 'joggers') {
          ctx.fillStyle = '#e9d3b156'
          ctx.fillRect(face.face === 'left' ? face.w - 4 : 3, 0, 1, h)
        }
      } else {
        ctx.fillRect(0, kind === 'pants' ? 0 : h - 8, face.w, 8)
        drawBodyDetail(ctx, key, face)
        if (pocket && face.face === 'back') {
          ctx.drawImage(pocket, 9, 18, 49, 47)
          ctx.drawImage(pocket, face.w - 58, 18, 49, 47)
        }
      }
    }
    ctx.restore()
  }
  const profile = ({ hoodie: 'hoodie', jersey: 't_shirt', jeans: 'pants', joggers: 'pants' } as const)[key]
  return { mode: kind, name, profile, png: await pngForCanvas(ctx, kind) }
}
