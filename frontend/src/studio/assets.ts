import type { Face } from './model'
import { surface } from './raster'

export const assetNames = ['Cotton', 'Pinstripe', 'Denim', 'Zipper', 'Pocket', 'Drawstrings', 'Buttons', 'Laces', 'Star sticker'] as const
export type Asset = (typeof assetNames)[number]

export function assetImage(name: Asset, color: string) {
  const ctx = surface(64, 64)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  function line(points: [number, number][]) {
    ctx.beginPath()
    ctx.moveTo(...points[0])
    points.slice(1).forEach((p) => ctx.lineTo(...p))
    ctx.stroke()
  }
  if (name === 'Cotton' || name === 'Denim' || name === 'Pinstripe') {
    ctx.fillRect(0, 0, 64, 64)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const grain = Math.sin(x * 7.13 + y * 67.1) * .07
        const thread = name === 'Pinstripe' ? x % 8 === 0 : name === 'Denim' ? (x + y * 2) % 4 === 0 : (x + y) % 2 === 0
        ctx.fillStyle = thread ? `rgba(255,255,255,${.15 + grain})` : `rgba(0,0,0,${.09 + grain})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  } else if (name === 'Zipper') {
    line([[25, 3], [25, 61]])
    line([[39, 3], [39, 61]])
    for (let y = 4; y < 62; y += 4) line([[27, y], [37, y + 1]])
    ctx.fillRect(28, 7, 8, 15)
  } else if (name === 'Pocket') {
    line([[9, 16], [55, 16], [55, 47], [33, 57], [9, 47], [9, 16]])
    ctx.setLineDash([2, 3])
    line([[13, 22], [51, 22], [51, 45], [33, 52], [13, 45], [13, 22]])
  } else if (name === 'Drawstrings') {
    ctx.lineWidth = 3
    line([[23, 5], [22, 19], [15, 31], [15, 43], [18, 54]])
    line([[41, 5], [40, 24], [47, 39], [46, 60]])
  } else if (name === 'Buttons') {
    for (let y = 12; y < 60; y += 20) {
      ctx.beginPath()
      ctx.arc(32, y, 5, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.fillRect(30, y - 1, 4, 2)
    }
  } else if (name === 'Laces') {
    for (let y = 13; y < 51; y += 12) {
      line([[15, y], [49, y + 11]])
      line([[49, y], [15, y + 11]])
    }
  } else {
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 27
      const angle = i * Math.PI / 5 - Math.PI / 2
      ctx.lineTo(32 + r * Math.cos(angle), 32 + r * Math.sin(angle))
    }
    ctx.fill()
  }
  return ctx.canvas.toDataURL()
}

export function shadingImage(face: Face, color: string) {
  const ctx = surface(face.w, face.h)
  const sides = ctx.createLinearGradient(0, 0, face.w, 0)
  sides.addColorStop(0, color + 'aa')
  sides.addColorStop(.24, color + '00')
  sides.addColorStop(.72, color + '00')
  sides.addColorStop(1, color + 'aa')
  ctx.fillStyle = sides
  ctx.fillRect(0, 0, face.w, face.h)
  const hem = ctx.createLinearGradient(0, 0, 0, face.h)
  hem.addColorStop(0, '#ffffff29')
  hem.addColorStop(.45, '#ffffff00')
  hem.addColorStop(.81, color + '00')
  hem.addColorStop(1, color + '72')
  ctx.fillStyle = hem
  ctx.fillRect(0, 0, face.w, face.h)
  return ctx.canvas.toDataURL()
}
