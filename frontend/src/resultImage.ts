import { useEffect, useState } from 'react'
import { regionLabel, templates } from './template'
import type { TemplateKind } from './template'
import type { PlacedTemplate } from './photos'
import type { Fixes } from './useResultEdits'

export function useTemplateImage(png: string) {
  const [loaded, setLoaded] = useState<{ png: string; image: HTMLImageElement }>()
  const [failed, setFailed] = useState('')
  useEffect(() => {
    const image = new Image()
    image.onload = () => setLoaded({ png, image })
    image.onerror = () => setFailed(png)
    image.src = `data:image/png;base64,${png}`
    return () => { image.onload = null; image.onerror = null }
  }, [png])
  return { image: loaded?.image, ready: loaded?.png === png, failed: failed === png }
}

export function pngBytes(png: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(png), (character) => character.charCodeAt(0))
}

export function downloadResult(png: string, filename: string) {
  const url = URL.createObjectURL(new Blob([pngBytes(png)], { type: 'image/png' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function imagePixels(image: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export function palette(pixels: ImageData | undefined): string[] {
  if (!pixels) return []
  const groups = new Map<string, { total: [number, number, number]; count: number }>()
  const { data } = pixels
  for (let offset = 0; offset < data.length; offset += 16) {
    if (data[offset + 3] < 220) continue
    const channels = [data[offset], data[offset + 1], data[offset + 2]] as const
    const key = channels.map((value) => Math.floor(value / 48)).join('.')
    const group = groups.get(key) ?? { total: [0, 0, 0], count: 0 }
    group.count += 1
    channels.forEach((value, index) => { group.total[index] += value })
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 4)
    .map(({ total, count }) => `#${total.map((value) => Math.round(value / count).toString(16).padStart(2, '0')).join('')}`)
}

export function inspectTemplate(png: string, pixels: ImageData, mode: TemplateKind,
  profile: PlacedTemplate['profile'], sleeves: Fixes['sleeves']) {
  const { width, height, regions } = templates[mode]
  const exactSize = pixels.width === width && pixels.height === height
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const data = pngBytes(png)
  const isPng = signature.every((byte, index) => data[index] === byte)
  const hasAlpha = isPng && (data[25] === 4 || data[25] === 6)
  const allowed = new Uint8Array(pixels.width * pixels.height)
  const emptyRegions: string[] = []
  let visible = false
  if (exactSize) {
    for (const region of regions) {
      const limb = region.part !== 'torso'
      const uncovered = limb && ((mode === 'shirt' && sleeves === 'none')
        || (region.face === 'down' && (mode === 'pants' ? profile === 'shorts'
          : sleeves === 'short' || (sleeves === 'auto' && profile === 't_shirt'))))
      let occupied = false
      for (let y = region.y; y < region.y + region.h; y++) {
        const start = y * width + region.x
        allowed.fill(1, start, start + region.w)
        for (let x = start; x < start + region.w; x++) {
          if (pixels.data[x * 4 + 3] > 16) occupied = true
        }
      }
      visible ||= occupied
      if (!occupied && !uncovered) emptyRegions.push(regionLabel(mode, region.part, region.face))
    }
  }
  const transparency = exactSize && hasAlpha
    && allowed.every((inside, index) => inside || pixels.data[index * 4 + 3] === 0)
  return { exactSize, isPng, transparency, emptyRegions, visible }
}
