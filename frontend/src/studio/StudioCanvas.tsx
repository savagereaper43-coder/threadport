import { useEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent } from 'react'
import { regionLabel, templates } from '../template'
import { faceKey } from './model'
import type { Face, Layer, Point, Project, Selection } from './model'
import { bound, end, isStroke } from './edit'
import type { Options, Tool } from './edit'
import { boxBetween, colorSelection, controlPoints, includes, surface } from './raster'

type Viewport = { zoom: number; x: number; y: number }
export type Frame = Viewport
export const fitFrame = { zoom: 1, x: 0, y: 0 }

export function StudioCanvas({ project, image, tool, options, selected, layer, region, showRegions, showSeams, frame, setFrame,
  setSelection, gesture, onDropPiece, chooseLayer }: {
  project: Project; image?: HTMLCanvasElement; tool: Tool; options: Options; selected?: Selection; layer?: Layer; region?: Face
  showRegions: boolean; showSeams: boolean; frame: Frame; setFrame: (frame: Frame) => void
  setSelection: (selection?: Selection) => void; gesture: (points: Point[], alt: boolean) => void
  onDropPiece: (id: string, face: Face) => void; chooseLayer: (layer: Layer) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const paper = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(585)
  const [trace, setTrace] = useState<Point[]>([])
  const track = useRef<{ points: Point[]; start: Point; frame: Frame; pan: boolean } | null>(null)
  const [hover, setHover] = useState<Face>()
  const space = useRef(false)
  const { width: w, height: h, regions, label } = templates[project.kind]
  const scale = width / w * frame.zoom

  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const watcher = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.min(w, entry.contentRect.width - 24, (entry.contentRect.height - 24) * w / h))))
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [w, h])

  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !(event.target instanceof HTMLElement) || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName)) return
      space.current = true
      event.preventDefault()
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false }
    const blur = () => { space.current = false }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const zoom = bound(frame.zoom * (event.deltaY < 0 ? 1.17 : .855), .25, 16)
      const rect = node.getBoundingClientRect()
      const px = event.clientX - rect.left - rect.width / 2
      const py = event.clientY - rect.top - rect.height / 2
      setFrame({ zoom, x: px + (frame.x - px) * zoom / frame.zoom, y: py + (frame.y - py) * zoom / frame.zoom })
    }
    node.addEventListener('wheel', wheel, { passive: false })
    node.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      node.removeEventListener('wheel', wheel)
      node.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [frame, setFrame])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (image) ctx.drawImage(image, 0, 0)
  }, [h, image, w])

  function point(event: PointerEvent | DragEvent, clamp = false) {
    const rect = paper.current!.getBoundingClientRect()
    const x = (event.clientX - rect.left) * w / rect.width
    const y = (event.clientY - rect.top) * h / rect.height
    return clamp ? { x: bound(x, 0, w - 1), y: bound(y, 0, h - 1) } : { x, y }
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    const pan = space.current || tool === 'hand' || event.button === 1
    const p = point(event)
    if (!pan && !includes({ x: 0, y: 0, w, h }, p)) return
    event.currentTarget.focus()
    if (!pan) {
      if (tool === 'zoom') {
        setFrame({ ...frame, zoom: bound(frame.zoom * (event.altKey ? .667 : 1.5), .25, 16) })
        return
      }
      if (tool === 'wand' || tool === 'object') {
        if (!image) return
        const ctx = surface(w, h)
        ctx.drawImage(image, 0, 0)
        setSelection(colorSelection(ctx, p, options.tolerance, tool === 'object'))
        return
      }
      if (tool === 'move' && (!layer || !includes(layer, p))) {
        const hit = [...project.layers].reverse().find((item) => !item.hidden && !item.locked && includes(item, p))
        if (hit) chooseLayer(hit)
        else return
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    track.current = { points: [p], frame, start: { x: event.clientX, y: event.clientY }, pan }
    if (!pan) setTrace([p])
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = track.current
    if (!active) return
    if (active.pan) {
      setFrame({ ...active.frame, x: active.frame.x + event.clientX - active.start.x, y: active.frame.y + event.clientY - active.start.y })
      return
    }
    active.points.push(point(event, !['move', 'warp', 'perspective'].includes(tool)))
    setTrace([...active.points])
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = track.current
    track.current = null
    setTrace([])
    if (!active || active.pan) return
    const points = [...active.points, point(event, !['move', 'warp', 'perspective'].includes(tool))]
    if (tool === 'rectangle' || tool === 'lasso') {
      const box = tool === 'rectangle' ? boxBetween(points[0], end(points))
        : boxBetween({ x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) },
          { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) })
      setSelection({ box, points: tool === 'lasso' && points.length > 2 ? points : undefined })
    } else gesture(points, event.altKey)
  }

  function dropFace(event: DragEvent) {
    return regions.find((face) => includes(face, point(event)))
  }

  return <div ref={viewport} className={`studio-viewport tool-${tool}`} tabIndex={0} aria-label="Studio canvas"
    onPointerDown={start} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={() => { track.current = null; setTrace([]) }}
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes('application/x-threadport-piece')) return
      event.preventDefault()
      setHover(dropFace(event))
    }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHover(undefined) }}
    onDrop={(event) => {
      event.preventDefault()
      const face = dropFace(event), piece = event.dataTransfer.getData('application/x-threadport-piece')
      if (face && piece) onDropPiece(piece, face)
      setHover(undefined)
    }}>
    <div ref={paper} className="checkerboard studio-paper" style={{ width: w * scale, height: h * scale,
      transform: `translate(calc(-50% + ${frame.x}px), calc(-50% + ${frame.y}px))` }}>
      <canvas aria-label={`${label} template canvas`} role="img" ref={canvas} width={w} height={h} />
      {scale >= 6 && <div className="studio-pixel-grid" aria-hidden="true" style={{ backgroundSize: `${scale}px ${scale}px` }} />}
      {regions.filter((face) => showRegions || face === region || face === hover || (showSeams && region?.part === face.part)).map((face) =>
        <div key={faceKey(face)} className={`region studio-region${face === region || face === hover ? ' studio-region-active' : ''}`}
          title={regionLabel(project.kind, face.part, face.face)}
          style={{ left: face.x * scale, top: face.y * scale, width: face.w * scale, height: face.h * scale }}>
          {regionLabel(project.kind, face.part, face.face)}
        </div>)}
      {region && <svg aria-hidden="true" className="studio-overlay studio-region-shade" viewBox={`0 0 ${w} ${h}`}>
        <path fill="#0008" fillRule="evenodd"
          d={`M0 0H${w}V${h}H0Z M${region.x} ${region.y}h${region.w}v${region.h}h-${region.w}Z`} />
      </svg>}
      {(selected || trace.length > 0 || layer && ['move', 'warp', 'perspective'].includes(tool)) && <svg aria-hidden="true"
        className="studio-overlay" viewBox={`0 0 ${w} ${h}`}>
        {layer && (tool === 'warp' || tool === 'perspective') && controlPoints(layer, tool === 'perspective').map(({ index, point }) =>
          <circle key={index} cx={point.x} cy={point.y} r={4 / scale} className="studio-control-point" />)}
        {selected && (selected.points
          ? <polygon points={selected.points.map((p) => `${p.x},${p.y}`).join(' ')} />
          : <rect x={selected.box.x} y={selected.box.y} width={selected.box.w} height={selected.box.h} />)}
        {layer && ['move', 'warp', 'perspective'].includes(tool) && (() => {
          const x = tool === 'move' && trace.length ? layer.x + end(trace).x - trace[0].x : layer.x
          const y = tool === 'move' && trace.length ? layer.y + end(trace).y - trace[0].y : layer.y
          return <rect x={x} y={y} width={layer.w} height={layer.h} />
        })()}
        {trace.length > 0 && (isStroke(tool) || tool === 'lasso' || tool === 'gradient'
          ? <polyline style={tool === 'brush' ? { stroke: options.color, strokeWidth: options.size * scale, opacity: .6 } : undefined}
            points={trace.map((p) => `${p.x},${p.y}`).join(' ')} />
          : ['shape', 'rectangle', 'crop'].includes(tool) && (() => {
            const box = boxBetween(trace[0], end(trace))
            return <rect x={box.x} y={box.y} width={box.w} height={box.h} />
          })())}
      </svg>}
    </div>
  </div>
}
