import { zipSync } from 'fflate'
import { pngBytes } from '../resultImage'
import { clip, download, fileUrl, loadImage, pngUrl, surface } from '../studio/raster'
import { exportTemplatePng, templates } from '../template'
import type { TemplateKind } from '../template'
import type { Fixes } from '../useResultEdits'

export type GraphicMatch = { side: 'front' | 'back'; x: number; y: number; w: number; h: number }

async function post<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  const value = await response.json()
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'We couldn’t finish that edit. Try again.')
  return value as T
}

export async function changeArtwork(png: string, mode: TemplateKind,
  fixes: Partial<Fixes> & { logo_face?: 'front' | 'back' }, signal?: AbortSignal) {
  const result = await post<{ png: string }>('quick-fix', { png, mode, fixes }, signal)
  if (typeof result.png !== 'string') throw new Error('We couldn’t finish that edit. Try again.')
  return result.png
}

export function checkGraphics(png: string, mode: TemplateKind, signal?: AbortSignal) {
  return post<{ matches: GraphicMatch[] }>('check-graphics', { png, mode }, signal)
}

export const base64 = (src: string) => src.slice(src.indexOf(',') + 1)

export async function pngForCanvas(ctx: CanvasRenderingContext2D, mode: TemplateKind) {
  const result = await exportTemplatePng(mode, ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height))
  return base64(await fileUrl(result))
}

export function archiveName(name: string) {
  return name.replace(/\.[^./\\]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'garment'
}

export function downloadSet(files: { name: string; png: string }[], filename: string) {
  const entries: Record<string, Uint8Array> = Object.create(null)
  for (const { name, png } of files) {
    const base = archiveName(name)
    let path = `${base}.png`
    for (let duplicate = 2; entries[path]; duplicate++) path = `${base}-${duplicate}.png`
    entries[path] = pngBytes(png)
  }
  const zipped = new Uint8Array(zipSync(entries, { level: 0 }))
  download(new Blob([zipped], { type: 'application/zip' }), filename)
}

export async function importPreview(file: File, classicMode: 'shirt' | 'pants'): Promise<{ mode: TemplateKind; png: string }> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a template PNG up to 10 MB.')
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer())
  if (header.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)) {
    throw new Error('Choose a Roblox template PNG.')
  }
  const view = new DataView(header.buffer)
  const w = view.getUint32(16), h = view.getUint32(20)
  const mode: TemplateKind = w === 512 && h === 512 ? 't-shirt' : classicMode
  const shape = templates[mode]
  if (w !== shape.width || h !== shape.height) throw new Error('Use a 585 × 559 Classic template or a 512 × 512 T-Shirt PNG.')
  const image = await loadImage(await fileUrl(file))
  if (image.width !== w || image.height !== h) throw new Error('The PNG dimensions couldn’t be read.')
  const ctx = surface(w, h)
  clip(ctx, shape.regions)
  ctx.drawImage(image, 0, 0)
  return { mode, png: await pngForCanvas(ctx, mode) }
}

export async function replaceGraphic(png: string, mode: TemplateKind, match: GraphicMatch, file: File) {
  if (file.size > 10 * 1024 * 1024 || file.type !== 'image/png') throw new Error('Choose an original PNG up to 10 MB.')
  const graphic = await loadImage(await fileUrl(file))
  const cleaned = await changeArtwork(png, mode, { remove_logo: true, logo_face: match.side })
  const source = await loadImage(pngUrl(cleaned))
  const ctx = surface(source.width, source.height)
  ctx.drawImage(source, 0, 0)
  const overlay = surface(source.width, source.height)
  contain(overlay, graphic, match.x, match.y, match.w, match.h)
  overlay.globalCompositeOperation = 'destination-in'
  overlay.drawImage(source, 0, 0)
  ctx.drawImage(overlay.canvas, 0, 0)
  return pngForCanvas(ctx, mode)
}

function contain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / image.width, h / image.height)
  const width = image.width * scale, height = image.height * scale
  ctx.drawImage(image, x + (w - width) / 2, y + (h - height) / 2, width, height)
}

export async function shareImage(original: File, png: string, imported = false) {
  const [photo, template] = await Promise.all([loadImage(await fileUrl(original)), loadImage(pngUrl(png))])
  const ctx = surface(1280, 728)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, 1280, 728)
  ctx.font = '600 22px Arial'
  const views = [
    { label: imported ? 'Original template' : 'Original photo', image: photo },
    { label: 'Roblox template', image: template },
  ]
  for (const [index, { label, image }] of views.entries()) {
    const x = 28 + index * 624
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, x, 80)
    ctx.fillStyle = '#111111'
    ctx.fillRect(x, 104, 600, 596)
    if (index) {
      ctx.fillStyle = '#1a1a1a'
      for (let y = 0; y < 29; y++) {
        for (let col = y % 2; col < 30; col += 2) ctx.fillRect(x + col * 20, 104 + y * 20, 20, 20)
      }
    }
    contain(ctx, image, x + 16, 120, 568, 564)
  }
  ctx.fillStyle = '#a1a1a1'
  ctx.font = '600 16px Arial'
  ctx.fillText('ThreadPort', 28, 35)
  const blob = await new Promise<Blob | null>((resolve) => ctx.canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('We couldn’t prepare the before and after image.')
  download(blob, 'threadport-before-after.png')
}
