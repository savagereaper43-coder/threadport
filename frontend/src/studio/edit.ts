import {
  Brush, Circle, Crop, Eraser, Focus, Hand, Lasso, MousePointer2, PaintBucket, Pipette,
  SquareDashed, Stamp, Type, WandSparkles, Waves, ZoomIn, Blend, Grid2X2, SlidersHorizontal,
} from 'lucide-react'
import { templates } from '../template'
import { newLayer } from './model'
import type { Box, Face, Layer, Point, Project, Selection } from './model'
import { applySelection, boxBetween, clip, colorSelection, includes, loadImage, mapToLayer, surface } from './raster'

export const tools = [
  { id: 'move', label: 'Move / Transform', key: 'V', icon: MousePointer2 },
  { id: 'rectangle', label: 'Rectangle select', key: 'M', icon: SquareDashed },
  { id: 'lasso', label: 'Lasso select', key: 'L', icon: Lasso },
  { id: 'wand', label: 'Magic wand', key: 'W', icon: WandSparkles },
  { id: 'object', label: 'Select object', icon: Focus },
  { id: 'brush', label: 'Brush', key: 'B', icon: Brush },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'clone', label: 'Clone Stamp', key: 'S', icon: Stamp },
  { id: 'smudge', label: 'Smudge', icon: Waves },
  { id: 'fill', label: 'Fill', key: 'G', icon: PaintBucket },
  { id: 'gradient', label: 'Gradient', icon: Blend },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: Pipette },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'shape', label: 'Shapes', key: 'U', icon: Circle },
  { id: 'warp', label: 'Mesh Warp', icon: Grid2X2 },
  { id: 'perspective', label: 'Perspective', icon: SlidersHorizontal },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'hand', label: 'Hand', key: 'H', icon: Hand },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: ZoomIn },
] as const
export type Tool = (typeof tools)[number]['id']

export const strokes = ['brush', 'eraser', 'clone', 'smudge'] as const
export const isStroke = (tool: Tool) => (strokes as readonly string[]).includes(tool)

export type Options = {
  color: string; color2: string; size: number; opacity: number; hardness: number; flow: number; tolerance: number
  blend: GlobalCompositeOperation; text: string; font: string; shape: 'rectangle' | 'ellipse' | 'triangle'
  symmetric: boolean; clip: boolean
}
export const defaults: Options = {
  color: '#3b82f6', color2: '#111827', size: 24, opacity: 100, hardness: 85, flow: 100, tolerance: 35,
  blend: 'source-over', text: '', font: 'Arial', shape: 'rectangle', symmetric: false, clip: true,
}
export const blends: { value: GlobalCompositeOperation; name: string }[] = [
  { value: 'source-over', name: 'Normal' }, { value: 'multiply', name: 'Multiply' },
  { value: 'screen', name: 'Screen' }, { value: 'overlay', name: 'Overlay' },
  { value: 'soft-light', name: 'Soft light' }, { value: 'difference', name: 'Difference' },
]
export const bound = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const end = (points: Point[]) => points[points.length - 1]

export function mirroredFace(faces: readonly Face[], face: Face) {
  const opposite: Record<string, string> = { leftLimb: 'rightLimb', rightLimb: 'leftLimb', torso: 'torso' }
  const sides: Record<string, string> = { left: 'right', right: 'left' }
  return faces.find((candidate) => candidate.part === opposite[face.part] && candidate.face === (sides[face.face] ?? face.face))
}

function stamp(ctx: CanvasRenderingContext2D, p: Point, options: Options, tool: Tool,
  donor: HTMLCanvasElement, source: Point) {
  const radius = options.size / 2
  ctx.save()
  ctx.globalAlpha = options.opacity * options.flow / 10_000
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.clip()
  if (tool === 'clone' || tool === 'smudge') {
    if (tool === 'smudge') {
      ctx.globalAlpha *= .35
      ctx.filter = 'blur(1px)'
    }
    ctx.drawImage(donor, source.x - radius, source.y - radius, radius * 2, radius * 2,
      p.x - radius, p.y - radius, radius * 2, radius * 2)
  } else {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    const brush = ctx.createRadialGradient(p.x, p.y, radius * Math.min(.99, options.hardness / 100), p.x, p.y, radius)
    brush.addColorStop(0, options.color)
    brush.addColorStop(1, options.hardness === 100 ? options.color : options.color + '00')
    ctx.fillStyle = brush
    ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2)
  }
  ctx.restore()
}

function spaced(points: Point[], step: number) {
  const path = [points[0]]
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index]
    const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)
    for (let i = 1; i <= count; i++) path.push({ x: a.x + (b.x - a.x) * i / count, y: a.y + (b.y - a.y) * i / count })
  }
  return path
}

export async function editPixels({ project, layer, tool, points, options, donor, region, selection, cloneSource, mask }: {
  project: Project; layer?: Layer; tool: Tool; points: Point[]; options: Options; donor: HTMLCanvasElement
  region?: Face; selection?: Selection; cloneSource?: Point; mask: boolean
}): Promise<Layer | undefined> {
  const { width, height, regions } = templates[project.kind]
  const box: Box = { x: 0, y: 0, w: width, h: height }
  const paint = surface(width, height)
  const first = points[0]
  const last = end(points)
  const start = regions.find((face) => includes(face, first))
  const activePaint = layer && !layer.locked && ['Layer', 'Brush', 'Clone Stamp', 'Smudge'].includes(layer.name) && isStroke(tool)
  const editsLayer = tool === 'eraser' || tool === 'crop' || mask || activePaint
  if (editsLayer && (!layer || layer.locked)) return
  if (tool === 'crop') {
    paint.fillRect(0, 0, width, height)
    applySelection(paint, selection ?? { box: boxBetween(first, last) }, true)
  } else {
    if (options.clip || region) {
      const target = region ?? start
      if (!target && options.clip) return
      const mirror = target && options.symmetric && mirroredFace(regions, target)
      const boxes = target ? [target, ...(mirror ? [mirror] : [])] : regions
      clip(paint, boxes)
    }
    if (isStroke(tool)) {
      const source = cloneSource ?? first
      const trail = spaced(points, Math.max(1, options.size / 6))
      trail.forEach((p, index) => {
        const sample = tool === 'smudge' ? trail[Math.max(0, index - 3)]
          : { x: source.x + p.x - first.x, y: source.y + p.y - first.y }
        stamp(paint, p, options, tool === 'eraser' ? 'brush' : tool, donor, sample)
        if (options.symmetric && start) {
          const other = mirroredFace(regions, start)
          if (other) stamp(paint, { x: other.x + other.w - (p.x - start.x), y: other.y + p.y - start.y },
            options, tool === 'eraser' ? 'brush' : tool, donor, sample)
        }
      })
    } else if (tool === 'fill') {
      const sampling = surface(width, height)
      sampling.drawImage(donor, 0, 0)
      const flood = colorSelection(sampling, first, options.tolerance)
      paint.fillStyle = options.color
      paint.fillRect(0, 0, width, height)
      if (flood) applySelection(paint, flood, true)
    } else if (tool === 'gradient') {
      const gradient = paint.createLinearGradient(first.x, first.y, last.x + (last.x === first.x ? .1 : 0), last.y)
      gradient.addColorStop(0, options.color)
      gradient.addColorStop(1, options.color2)
      paint.fillStyle = gradient
      paint.fillRect(0, 0, width, height)
    } else if (tool === 'text') {
      if (!options.text.trim()) return
      paint.font = `${options.size}px ${options.font}`
      paint.textBaseline = 'top'
      paint.fillStyle = options.color
      paint.fillText(options.text, first.x, first.y)
    } else if (tool === 'shape') {
      const { x, y, w, h } = boxBetween(first, last)
      paint.fillStyle = options.color
      paint.beginPath()
      if (options.shape === 'ellipse') paint.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      else if (options.shape === 'triangle') {
        paint.moveTo(x + w / 2, y)
        paint.lineTo(x + w, y + h)
        paint.lineTo(x, y + h)
      } else paint.rect(x, y, w, h)
      paint.fill()
    }
    if (selection) applySelection(paint, selection, true)
  }

  if (editsLayer && layer) {
    const source = await loadImage(layer.src)
    const ctx = surface(source.width, source.height)
    if (mask) {
      if (layer.mask) ctx.drawImage(await loadImage(layer.mask), 0, 0, source.width, source.height)
      else ctx.fillRect(0, 0, source.width, source.height)
    } else ctx.drawImage(source, 0, 0)
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : tool === 'crop' ? 'destination-in'
      : mask ? 'source-over' : options.blend
    ctx.drawImage(mapToLayer(paint.canvas, layer, source.width, source.height), 0, 0)
    const result = ctx.canvas.toDataURL()
    return mask ? { ...layer, mask: result } : { ...layer, src: result }
  }

  return { ...newLayer(tools.find((item) => item.id === tool)!.label, paint.canvas.toDataURL(), box),
    blend: options.blend, opacity: isStroke(tool) ? 1 : options.opacity / 100 }
}
