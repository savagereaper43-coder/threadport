import { ImagePlus, Scissors, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Photo, Piece, Point, Selection } from './model'
import { id } from './model'
import { applySelection, colorSelection, crop, fileUrl, loadImage, pngUrl, surface } from './raster'

export async function removeBackground(file: File) {
  const form = new FormData()
  form.set('front', file)
  const response = await fetch('/api/cutout', { method: 'POST', body: form })
  const value = await response.json()
  if (!response.ok || !value.png) throw new Error(value.detail || 'We couldn’t remove the background.')
  return pngUrl(value.png)
}

async function photoSource(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Photos can be up to 10 MB.')
  const original = await loadImage(await fileUrl(file))
  if (original.width * original.height > 20_000_000) throw new Error('Choose a photo up to 20 megapixels.')
  const scale = Math.min(1, 1280 / Math.max(original.width, original.height))
  const ctx = surface(original.width * scale, original.height * scale)
  ctx.drawImage(original, 0, 0, ctx.canvas.width, ctx.canvas.height)
  return ctx.canvas.toDataURL()
}

export function PieceItem({ piece, active, choose }: { piece: Piece; active: boolean; choose: () => void }) {
  return <button type="button" className="studio-item" aria-pressed={active} onClick={choose}
    draggable onDragStart={(event) => {
      event.dataTransfer.setData('application/x-threadport-piece', piece.id)
      event.dataTransfer.effectAllowed = 'copy'
      choose()
    }}>
    <img src={piece.src} alt="" draggable={false} /><span>{piece.name}</span>
  </button>
}

export function PhotoTray({ photos, pieces, selected, choose, addPhoto, updatePhoto, addPiece }: {
  photos: Photo[]; pieces: Piece[]; selected: string; choose: (id: string) => void
  addPhoto: (photo: Photo) => void; updatePhoto: (photo: Photo) => void; addPiece: (piece: Piece) => void
}) {
  const [open, setOpen] = useState('')
  const [method, setMethod] = useState<'object' | 'lasso'>('object')
  const [useCutout, setUseCutout] = useState(true)
  const [selection, setSelection] = useState<Selection>()
  const [trace, setTrace] = useState<Point[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const photo = photos.find((item) => item.id === open)
  const src = (useCutout && photo?.cutout) || photo?.src
  const work = useRef<HTMLImageElement>(null)
  const drawing = useRef<Point[]>([])

  async function importPhotos(files: FileList | File[]) {
    setError('')
    setLoading(true)
    for (const file of Array.from(files)) {
      try {
        if (!/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, or WebP photo.')
        const added = { id: id(), name: file.name, src: await photoSource(file) }
        addPhoto(added)
        setOpen(added.id)
        setSelection(undefined)
        try {
          updatePhoto({ ...added, cutout: await removeBackground(file) })
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Try a different photo for background removal.')
          setMethod('lasso')
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Choose a readable photo.')
      }
    }
    setLoading(false)
  }

  function getPoint(event: PointerEvent<HTMLImageElement>) {
    const image = event.currentTarget
    const bounds = image.getBoundingClientRect()
    return { x: Math.max(0, Math.min(image.naturalWidth - 1, (event.clientX - bounds.left) * image.naturalWidth / bounds.width)),
      y: Math.max(0, Math.min(image.naturalHeight - 1, (event.clientY - bounds.top) * image.naturalHeight / bounds.height)) }
  }

  function start(event: PointerEvent<HTMLImageElement>) {
    const p = getPoint(event)
    if (method === 'object') {
      const image = event.currentTarget
      const ctx = surface(image.naturalWidth, image.naturalHeight)
      ctx.drawImage(image, 0, 0)
      setSelection(colorSelection(ctx, p, 35, !!(useCutout && photo?.cutout)))
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = [p]
    setSelection(undefined)
    setTrace([p])
  }

  function move(event: PointerEvent<HTMLImageElement>) {
    if (!drawing.current.length) return
    drawing.current.push(getPoint(event))
    setTrace([...drawing.current])
  }

  function finish() {
    const points = drawing.current
    drawing.current = []
    if (points.length < 3) { setTrace([]); return }
    const x = Math.floor(Math.min(...points.map((p) => p.x)))
    const y = Math.floor(Math.min(...points.map((p) => p.y)))
    const w = Math.ceil(Math.max(...points.map((p) => p.x)) - x) + 1
    const h = Math.ceil(Math.max(...points.map((p) => p.y)) - y) + 1
    setSelection({ box: { x, y, w, h }, points })
    setTrace([])
  }

  function selectVisiblePhoto() {
    const image = work.current
    if (!image) return
    const { naturalWidth: width, naturalHeight: height } = image
    if (!width || !height) return
    const ctx = surface(width, height)
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, width, height)
    let left = width, top = height, right = -1, bottom = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!data[(y * width + x) * 4 + 3]) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
    if (right >= left) setSelection({ box: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } })
  }

  function cut() {
    const image = work.current
    if (!image || !photo || !selection) return
    const ctx = surface(image.naturalWidth, image.naturalHeight)
    ctx.drawImage(image, 0, 0)
    applySelection(ctx, selection, true)
    addPiece({ id: id(), name: `${photo.name.replace(/\.[^.]+$/, '')} piece ${pieces.filter((p) => p.photo === photo.id).length + 1}`,
      src: crop(ctx.canvas, selection.box).canvas.toDataURL(), photo: photo.id })
    setSelection(undefined)
    setOpen('')
  }

  const image = work.current
  const box = selection?.box
  const points = trace.length ? trace : selection?.points
  return <section className="studio-tray" aria-label="Photo tray"
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
    onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void importPhotos(event.dataTransfer.files) } }}>
    <div className="studio-tray-header">
      <h2>Photo tray</h2>
      <button type="button" className="secondary-button" onClick={() => input.current?.click()} disabled={loading}><ImagePlus size={15} /> Add photos</button>
      <input ref={input} aria-label="Import photos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={(event) => { if (event.target.files) void importPhotos(event.target.files); event.target.value = '' }} />
      {loading && <span role="status">Removing the background…</span>}
      {error && <span role="alert">{error}</span>}
    </div>
    {!!photos.length && <div className="studio-tray-items">
      {photos.map((item) => <button key={item.id} type="button" className="studio-item" aria-pressed={open === item.id}
        onClick={() => { setOpen(item.id); setSelection(undefined) }}><img src={item.cutout ?? item.src} alt="" /><span>{item.name}</span></button>)}
    </div>}
    {photo && src && <div className="studio-cutter">
      <div className="studio-tray-header">
        <h2>Photo cutter</h2>
        <button type="button" className="secondary-button" aria-pressed={method === 'object'}
          onClick={() => { setMethod('object'); setSelection(undefined) }}>Select object</button>
        <button type="button" className="secondary-button" aria-pressed={method === 'lasso'}
          onClick={() => { setMethod('lasso'); setSelection(undefined) }}>Lasso</button>
        {photo.cutout && <label><input type="checkbox" checked={useCutout}
          onChange={(event) => { setUseCutout(event.target.checked); setSelection(undefined) }} /> Show cutout</label>}
        <button className="secondary-button" type="button" onClick={selectVisiblePhoto}>Select whole photo</button>
        <button className="secondary-button" type="button" disabled={!selection} onClick={cut}><Scissors size={14} /> Cut selected piece</button>
        <button className="secondary-button" aria-label="Close photo cutter" type="button" onClick={() => setOpen('')}><X size={16} /></button>
      </div>
      <div className="studio-cut-image">
        <img key={src} ref={work} src={src} alt="Photo to cut" draggable={false} onPointerDown={start} onPointerMove={move}
          onPointerUp={finish} onPointerCancel={() => { drawing.current = []; setTrace([]) }} />
        {image && image.naturalWidth > 0 && (box || points?.length) && <svg aria-hidden="true" viewBox={`0 0 ${image.naturalWidth} ${image.naturalHeight}`}>
          {points?.length ? <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} />
            : box && <rect x={box.x} y={box.y} width={box.w} height={box.h} />}
        </svg>}
      </div>
    </div>}
    {!!pieces.length && <>
      <h3>Pieces</h3>
      <div className="studio-tray-items">
        {pieces.map((piece) => <PieceItem key={piece.id} piece={piece} active={selected === piece.id} choose={() => choose(piece.id)} />)}
      </div>
    </>}
  </section>
}
