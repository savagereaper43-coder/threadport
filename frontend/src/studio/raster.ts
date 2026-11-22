import { regionLabel, templates } from '../template'
import type { TemplateKind } from '../template'
import type { Box, Face, Layer, Photo, Point, Project, Selection } from './model'
import { id, mesh, newLayer, newProject, neutral } from './model'

export function surface(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas.getContext('2d', { willReadFrequently: true })!
}

const images = new Map<string, Promise<HTMLImageElement>>()
export function loadImage(src: string) {
  const cached = images.get(src)
  if (cached) return cached
  const image = new Image()
  image.src = src
  const ready = image.decode().then(() => image).catch((error) => {
    images.delete(src)
    throw error
  })
  if (images.size > 48) images.delete(images.keys().next().value!)
  images.set(src, ready)
  return ready
}

export const pngUrl = (png: string) => `data:image/png;base64,${png}`
export const fileUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

export function boxBetween(a: Point, b: Point): Box {
  return { x: Math.floor(Math.min(a.x, b.x)), y: Math.floor(Math.min(a.y, b.y)),
    w: Math.max(1, Math.ceil(Math.abs(a.x - b.x))), h: Math.max(1, Math.ceil(Math.abs(a.y - b.y))) }
}

export function includes(box: Box, p: Point) {
  return p.x >= box.x && p.x < box.x + box.w && p.y >= box.y && p.y < box.y + box.h
}

export function crop(source: CanvasImageSource, box: Box) {
  const ctx = surface(box.w, box.h)
  ctx.drawImage(source, -box.x, -box.y)
  return ctx
}

export function clip(ctx: CanvasRenderingContext2D, boxes: readonly Box[]) {
  ctx.beginPath()
  for (const { x, y, w, h } of boxes) ctx.rect(x, y, w, h)
  ctx.clip()
}

export function polygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
}

export function applySelection(ctx: CanvasRenderingContext2D, selection: Selection, keep: boolean) {
  const { width, height } = ctx.canvas
  const mask = surface(width, height)
  if (selection.mask) {
    const pixels = mask.createImageData(width, height)
    selection.mask.forEach((alpha, index) => { pixels.data[index * 4 + 3] = alpha })
    mask.putImageData(pixels, 0, 0)
  } else if (selection.points) {
    polygon(mask, selection.points)
    mask.fill()
  } else {
    const { x, y, w, h } = selection.box
    mask.fillRect(x, y, w, h)
  }
  ctx.save()
  ctx.globalCompositeOperation = keep ? 'destination-in' : 'destination-out'
  ctx.drawImage(mask.canvas, 0, 0)
  ctx.restore()
}

export function colorSelection(ctx: CanvasRenderingContext2D, p: Point, tolerance: number, object = false): Selection | undefined {
  const { width, height } = ctx.canvas
  const x = Math.floor(p.x)
  const y = Math.floor(p.y)
  if (!includes({ x: 0, y: 0, w: width, h: height }, { x, y })) return
  const data = ctx.getImageData(0, 0, width, height).data
  const start = y * width + x
  if (object && data[start * 4 + 3] < 16) return
  const mask = new Uint8ClampedArray(width * height)
  const seen = new Uint8Array(mask.length)
  const queue = [start]
  seen[start] = 1
  let minX = x, minY = y, maxX = x, maxY = y
  for (let head = 0; head < queue.length; head++) {
    const pixel = queue[head], i = pixel * 4
    if (object) {
      if (data[i + 3] < 16) continue
    } else {
      const sample = start * 4
      const difference = Math.max(Math.abs(data[i] - data[sample]), Math.abs(data[i + 1] - data[sample + 1]),
        Math.abs(data[i + 2] - data[sample + 2]), Math.abs(data[i + 3] - data[sample + 3]))
      if (difference > tolerance) continue
    }
    mask[pixel] = 255
    const col = pixel % width, row = Math.floor(pixel / width)
    minX = Math.min(minX, col)
    minY = Math.min(minY, row)
    maxX = Math.max(maxX, col)
    maxY = Math.max(maxY, row)
    const neighbors = [col > 0 ? pixel - 1 : -1, col + 1 < width ? pixel + 1 : -1, pixel - width, pixel + width]
    for (const next of neighbors) {
      if (next >= 0 && next < mask.length && !seen[next]) {
        seen[next] = 1
        queue.push(next)
      }
    }
  }
  return { box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, mask }
}

function triangle(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, source: Point[], to: Point[]) {
  const [a, b, c] = source
  const [d, e, f] = to
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y
  const det = ux * vy - uy * vx
  if (Math.abs(det) < .00001) return
  const ax = ((e.x - d.x) * vy - (f.x - d.x) * uy) / det
  const bx = ((e.y - d.y) * vy - (f.y - d.y) * uy) / det
  const cx = ((f.x - d.x) * ux - (e.x - d.x) * vx) / det
  const dx = ((f.y - d.y) * ux - (e.y - d.y) * vx) / det
  ctx.save()
  polygon(ctx, to)
  ctx.clip()
  ctx.transform(ax, bx, cx, dx, d.x - ax * a.x - cx * a.y, d.y - bx * a.x - dx * a.y)
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}

function warpPoint(layer: Layer, x: number, y: number): Point {
  const offsets = Object.entries(layer.warp ?? {})
  const cornersOnly = offsets.every(([i]) => [0, 2, 6, 8].includes(Number(i)))
  return offsets.reduce((position, [key, offset]) => {
    const node = mesh[Number(key)]
    const falloff = cornersOnly ? 1 : 2
    const weight = Math.max(0, 1 - Math.abs(node.x - x) * falloff) * Math.max(0, 1 - Math.abs(node.y - y) * falloff)
    return { x: position.x + offset.x * weight, y: position.y + offset.y * weight }
  }, { x: layer.w * x, y: layer.h * y })
}

function meshMap(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, layer: Layer, w: number, h: number,
  inverse = false, padding = 0) {
  const grid = 4
  const point = (x: number, y: number) => ({ x: x * w, y: y * h })
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const cells = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
      for (const indexes of [[0, 1, 2], [0, 2, 3]]) {
        const v = indexes.map((i) => cells[i])
        const source = v.map(([a, b]) => point(a / grid, b / grid))
        const target = v.map(([a, b]) => {
          const p = warpPoint(layer, a / grid, b / grid)
          return { x: p.x + padding, y: p.y + padding }
        })
        triangle(ctx, image, inverse ? target : source, inverse ? source : target)
      }
    }
  }
}

function transform(layer: Layer) {
  return new DOMMatrix().translate(layer.x + layer.w / 2, layer.y + layer.h / 2)
    .rotate(layer.angle ?? 0).scale(layer.flip ? -1 : 1, 1).translate(-layer.w / 2, -layer.h / 2)
}

export function controlPoints(layer: Layer, perspective: boolean) {
  const matrix = transform(layer)
  return mesh.flatMap((node, index) => {
    if (perspective && ![0, 2, 6, 8].includes(index)) return []
    return [{ index, point: matrix.transformPoint(warpPoint(layer, node.x, node.y)) }]
  })
}

export function localOffset(layer: Layer, x: number, y: number): Point {
  const inverse = new DOMMatrix().rotate(layer.angle ?? 0).scale(layer.flip ? -1 : 1, 1).inverse()
  return inverse.transformPoint({ x, y })
}

export function mapToLayer(world: HTMLCanvasElement, layer: Layer, width: number, height: number) {
  const local = surface(width, height)
  const matrix = transform(layer).inverse()
  if (!layer.warp) {
    local.scale(width / layer.w, height / layer.h)
    local.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
    local.drawImage(world, 0, 0)
  } else {
    // Offset the working bounds so nodes that move beyond the original layer keep their pixels.
    const pad = Math.ceil(Math.max(layer.w, layer.h))
    const mapped = surface(layer.w + pad * 2, layer.h + pad * 2)
    mapped.translate(pad, pad)
    mapped.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
    mapped.drawImage(world, 0, 0)
    meshMap(local, mapped.canvas, layer, width, height, true, pad)
  }
  return local.canvas
}

export async function renderLayer(ctx: CanvasRenderingContext2D, layer: Layer) {
  const image = await loadImage(layer.src)
  const pixels = surface(image.width, image.height)
  const s = layer.settings ?? neutral
  if (layer.settings) pixels.filter = `brightness(${100 + s.brightness}%) contrast(${100 + s.contrast}%) hue-rotate(${s.hue}deg) saturate(${100 + s.saturation}%)`
  pixels.drawImage(image, 0, 0)
  pixels.filter = 'none'
  if (s.black || s.white !== 255 || s.gamma !== 1 || s.red || s.green || s.blue || s.tintAmount) {
    const frame = pixels.getImageData(0, 0, image.width, image.height)
    const tint = [1, 3, 5].map((i) => parseInt(s.tint.slice(i, i + 2), 16))
    const strength = s.tintAmount / 100
    const balance = [s.red, s.green, s.blue]
    for (let i = 0; i < frame.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const unit = Math.max(0, Math.min(1, (frame.data[i + c] - s.black) / Math.max(1, s.white - s.black)))
        frame.data[i + c] = 255 * unit ** (1 / s.gamma) * (1 - strength + strength * tint[c] / 255) + balance[c]
      }
    }
    pixels.putImageData(frame, 0, 0)
  }
  if (layer.mask) {
    pixels.globalCompositeOperation = 'destination-in'
    pixels.drawImage(await loadImage(layer.mask), 0, 0, image.width, image.height)
  }
  ctx.save()
  if (layer.clip) clip(ctx, [layer.clip])
  ctx.globalAlpha = layer.opacity
  ctx.globalCompositeOperation = layer.blend
  const m = transform(layer)
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
  if (layer.warp) meshMap(ctx, pixels.canvas, layer, image.width, image.height)
  else ctx.drawImage(pixels.canvas, 0, 0, layer.w, layer.h)
  ctx.restore()
}

export async function composite(project: Pick<Project, 'kind' | 'layers'>) {
  const { width, height, regions } = templates[project.kind]
  const ctx = surface(width, height)
  ctx.imageSmoothingQuality = 'high'
  clip(ctx, regions)
  for (const layer of project.layers) if (!layer.hidden) await renderLayer(ctx, layer)
  return ctx.canvas
}

export async function importTemplate(src: string, kind: TemplateKind, name: string, photos: Photo[] = []) {
  const template = templates[kind]
  const image = await loadImage(src)
  if (image.width !== template.width || image.height !== template.height) {
    throw new Error(`Choose a ${template.width} × ${template.height} PNG for this template.`)
  }
  const project = newProject(kind, name)
  project.photos = photos
  for (const face of template.regions) {
    const ctx = crop(image, face)
    if (!ctx.getImageData(0, 0, face.w, face.h).data.some((value, index) => index % 4 === 3 && value > 0)) continue
    const label = regionLabel(kind, face.part, face.face)
    const src = ctx.canvas.toDataURL()
    project.layers.push(newLayer(label, src, face))
    project.pieces.push({ id: id(), name: label, src })
  }
  return project
}

export function fitPiece(image: HTMLImageElement, face: Face, name: string, tile = false) {
  const ctx = surface(face.w, face.h)
  if (tile) {
    ctx.fillStyle = ctx.createPattern(image, 'repeat')!
    ctx.fillRect(0, 0, face.w, face.h)
  } else {
    const scale = Math.max(face.w / image.width, face.h / image.height)
    const w = image.width * scale, h = image.height * scale
    ctx.drawImage(image, (face.w - w) / 2, (face.h - h) / 2, w, h)
  }
  return newLayer(name, ctx.canvas.toDataURL(), face)
}

export function wrapPiece(image: HTMLImageElement, faces: Face[], name: string) {
  const total = faces.reduce((sum, face) => sum + face.w, 0)
  const h = Math.max(...faces.map((face) => face.h))
  const strip = surface(total, h)
  const scale = h / image.height
  const w = Math.max(1, image.width * scale)
  for (let x = 0, index = 0; x < total; x += w, index++) {
    strip.save()
    strip.translate(index % 2 ? x + w : x, 0)
    if (index % 2) strip.scale(-1, 1)
    strip.drawImage(image, 0, 0, w, h)
    strip.restore()
  }
  let x = 0
  return faces.map((face) => {
    const part = crop(strip.canvas, { x, y: 0, w: face.w, h: face.h })
    x += face.w
    return newLayer(`${name} · ${face.face}`, part.canvas.toDataURL(), face)
  })
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
