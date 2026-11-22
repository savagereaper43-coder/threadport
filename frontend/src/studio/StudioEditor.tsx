import { Download, Image, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CatalogChecklist, Mannequins } from '../ResultTools'
import { importPreview } from '../extras/artwork'
import { imagePixels, palette } from '../resultImage'
import { exportTemplatePng, templates } from '../template'
import type { TemplateKind } from '../template'
import { assetImage, shadingImage } from './assets'
import type { Asset } from './assets'
import { bound, defaults, editPixels, end, tools } from './edit'
import type { Options, Tool } from './edit'
import { artwork, id, newLayer } from './model'
import type { Artwork, Face, Layer, Point, Project, Selection } from './model'
import { PhotoTray } from './PhotoTray'
import { StudioCanvas, fitFrame } from './StudioCanvas'
import { StudioPanels, ToolOptions } from './StudioPanels'
import {
  applySelection, composite, controlPoints, crop, download, fitPiece, importTemplate, loadImage, localOffset, mapToLayer, pngUrl,
  surface, wrapPiece,
} from './raster'

type ChangeProject = (update: (project: Project) => Project) => void

const instructions = [
  'Add a photo then use the photo cutter to select and cut fabric.',
  'Drag the body piece onto Torso front.',
  'Select a sleeve or leg region and use Wrap around limb.',
  'Copy the front to the back or place another photo piece on the back.',
  'Open Assets and choose Add shading.',
  'Check the result and download the PNG.',
]

async function quickFix(png: string, mode: TemplateKind, fixes: Record<string, boolean | number>) {
  const response = await fetch('/api/quick-fix', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ png: png.split(',')[1], mode, fixes }),
  })
  const value = await response.json()
  if (!response.ok || typeof value.png !== 'string') throw new Error(value.detail ?? 'Quick-Fix couldn’t finish.')
  return loadImage(pngUrl(value.png))
}

async function eraseLogo(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas
  const preview = surface(512, 512)
  const scale = Math.min(1, 512 / width, 512 / height)
  preview.drawImage(ctx.canvas, 0, 0, width * scale, height * scale)
  const edited = await quickFix(preview.canvas.toDataURL(), 't-shirt', { remove_logo: true })
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(edited, 0, 0, width * scale, height * scale, 0, 0, width, height)
}

export default function StudioEditor({ project, change, openProject, createProject, saving }: {
  project: Project; change: ChangeProject; openProject: (project: Project) => void
  createProject: (kind: TemplateKind) => void; saving: string
}) {
  const previous = useRef<Artwork[]>([])
  const next = useRef<Artwork[]>([])
  const currentLayer = useRef('')
  const [layerId, setLayerId] = useState('')
  const [pieceId, setPieceId] = useState('')
  const [tool, setTool] = useState<Tool>('move')
  const [options, setOptions] = useState(defaults)
  const [recent, setRecent] = useState<string[]>([])
  const [selection, setSelection] = useState<Selection>()
  const [region, setRegion] = useState<Face>()
  const [showRegions, setShowRegions] = useState(false)
  const [showSeams, setShowSeams] = useState(false)
  const [frame, setFrame] = useState(fitFrame)
  const [mask, setMask] = useState(false)
  const [cloneSource, setCloneSource] = useState<Point>()
  const [image, setImage] = useState<HTMLCanvasElement>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const executing = useRef(false)
  const [avatar, setAvatar] = useState(false)
  const [preview, setPreview] = useState<HTMLImageElement>()
  const [catalog, setCatalog] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [readyThumbnail, setReadyThumbnail] = useState<{ layers: Layer[]; src: string }>()
  const backVersion = useRef(0)
  const importInput = useRef<HTMLInputElement>(null)
  const layer = project.layers.find((candidate) => candidate.id === layerId)
  const piece = project.pieces.find((candidate) => candidate.id === pieceId)
  const { width, height, regions } = templates[project.kind]
  const front = regions.find((face) => face.part === 'torso' && face.face === 'front')!
  const back = regions.find((face) => face.part === 'torso' && face.face === 'back')
  const title = project.name.trim() || 'Untitled project'

  function apply(update: (project: Project) => Project) {
    change((current) => {
      const result = update(current)
      if (result === current) return current
      previous.current = [...previous.current.slice(-119), artwork(current)]
      next.current = []
      return result
    })
  }

  function restore(redo: boolean) {
    const source = redo ? next : previous
    const target = redo ? previous : next
    const entry = source.current.pop()
    if (!entry) return
    change((current) => {
      target.current.push(artwork(current))
      return { ...current, ...entry }
    })
    setRegion(undefined)
    setFrame(fitFrame)
    setSelection(undefined)
  }

  function setOption<K extends keyof Options>(key: K, value: Options[K]) {
    setOptions((old) => ({ ...old, [key]: value }))
  }

  function chooseColor(color: string) {
    setOption('color', color)
    setRecent((old) => [color, ...old.filter((value) => value !== color)].slice(0, 8))
  }

  function chooseLayer(value: Layer) {
    currentLayer.current = value.id
    setLayerId(value.id)
    setMask(false)
  }

  function append(layers: Layer[]) {
    if (!layers.length) return
    apply((current) => ({ ...current, layers: [...current.layers, ...layers] }))
    chooseLayer(layers.at(-1)!)
  }

  function updateLayer(value: Layer) {
    apply((current) => ({ ...current, layers: current.layers.map((item) => item.id === value.id ? value : item) }))
  }

  function transform(value: Layer) {
    if (!value.locked) updateLayer(value)
  }

  function duplicate() {
    if (layer) append([{ ...layer, locked: false, id: id(), name: `${layer.name} copy` }])
  }

  async function perform(action: () => Promise<void>) {
    if (executing.current) return
    executing.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We couldn’t finish that edit.')
    } finally {
      executing.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    composite({ kind: project.kind, layers: project.layers }).then((canvas) => {
      if (cancelled) return
      setImage(canvas)
      const miniature = surface(230, Math.round(230 * canvas.height / canvas.width))
      miniature.drawImage(canvas, 0, 0, miniature.canvas.width, miniature.canvas.height)
      setReadyThumbnail({ layers: project.layers, src: miniature.canvas.toDataURL() })
    }).catch(() => { if (!cancelled) setError('We couldn’t draw one of the layers.') })
    return () => { cancelled = true }
  }, [project.kind, project.layers])

  useEffect(() => {
    if (!readyThumbnail || !project.layers.length || readyThumbnail.src === project.thumbnail) return
    const timeout = window.setTimeout(() => change((current) => current.layers === readyThumbnail.layers
      ? { ...current, thumbnail: readyThumbnail.src, updated: current.updated } : current), 250)
    return () => window.clearTimeout(timeout)
  }, [change, project.layers, project.thumbnail, readyThumbnail])

  useEffect(() => {
    if (!image || (!avatar && !catalog)) return
    let cancelled = false
    loadImage(image.toDataURL()).then((loaded) => { if (!cancelled) setPreview(loaded) })
      .catch(() => { if (!cancelled) setError('We couldn’t open the preview.') })
    return () => { cancelled = true }
  }, [image, avatar, catalog])

  async function clearSelected() {
    if (!layer || layer.locked || !selection) return
    await perform(async () => {
      const world = surface(width, height)
      world.fillRect(0, 0, width, height)
      applySelection(world, selection, true)
      const source = await loadImage(layer.src)
      const ctx = surface(source.width, source.height)
      ctx.drawImage(source, 0, 0)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(mapToLayer(world.canvas, layer, source.width, source.height), 0, 0)
      transform({ ...layer, src: ctx.canvas.toDataURL() })
    })
  }

  function gesture(points: Point[], alt: boolean) {
    if (!image) return
    const active = project.layers.find((candidate) => candidate.id === currentLayer.current)
    const origin = points[0]
    const last = end(points)
    const dx = Math.round(last.x - origin.x), dy = Math.round(last.y - origin.y)
    if (tool === 'move' || tool === 'warp' || tool === 'perspective') {
      if (!active || active.locked || (!dx && !dy)) return
      if (tool === 'move') transform({ ...active, x: active.x + dx, y: active.y + dy,
        clip: active.clip && { ...active.clip, x: active.clip.x + dx, y: active.clip.y + dy } })
      else {
        const points = controlPoints(active, tool === 'perspective')
        const { index } = points.reduce((best, candidate) => Math.hypot(candidate.point.x - origin.x, candidate.point.y - origin.y)
          < Math.hypot(best.point.x - origin.x, best.point.y - origin.y) ? candidate : best)
        const shift = localOffset(active, dx, dy)
        const base = active.warp?.[index] ?? { x: 0, y: 0 }
        transform({ ...active, warp: { ...active.warp, [index]: { x: bound(base.x + shift.x, -active.w * .8, active.w),
          y: bound(base.y + shift.y, -active.h * .8, active.h) } } })
      }
      return
    }
    if (tool === 'eyedropper') {
      const rgb = image.getContext('2d')!.getImageData(Math.floor(origin.x), Math.floor(origin.y), 1, 1).data
      if (rgb[3]) chooseColor('#' + [...rgb.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join(''))
      return
    }
    if (tool === 'clone' && (alt || !cloneSource)) {
      setCloneSource(origin)
      return
    }
    if (active?.locked && ['crop', 'eraser'].includes(tool)) return
    void perform(async () => {
      const edited = await editPixels({ project, layer: active, tool, points, options, donor: image,
        region, selection, cloneSource, mask })
      if (!edited) return
      if (edited.id === active?.id) updateLayer(edited)
      else append([edited])
      if (tool === 'crop') setSelection(undefined)
    })
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return
      const key = event.key.toLowerCase()
      if (event.metaKey || event.ctrlKey) {
        if (key === 'z' || key === 'y') {
          event.preventDefault()
          restore(event.shiftKey || key === 'y')
        } else if (key === 'j') {
          event.preventDefault()
          duplicate()
        }
        return
      }
      if (event.altKey) return
      if (key === 'escape') { setSelection(undefined); focusRegion(); return }
      if (key === 'delete' && selection) { void clearSelected(); return }
      if (key === '[' || key === ']') {
        setOptions((value) => ({ ...value, size: bound(value.size + (key === '[' ? -4 : 4), 1, 160) }))
        return
      }
      const match = tools.find((item) => 'key' in item && item.key.toLowerCase() === key)
      if (match) setTool(match.id)
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  })

  function focusRegion(face?: Face) {
    setRegion(face)
    if (!face) { setFrame(fitFrame); return }
    const zoom = 2.4
    const viewport = document.querySelector('.studio-viewport')
    const baseWidth = viewport ? Math.min(width, viewport.clientWidth - 24, (viewport.clientHeight - 24) * width / height) : width
    const scale = baseWidth / width * zoom
    setFrame({ zoom, x: (width / 2 - face.x - face.w / 2) * scale, y: (height / 2 - face.y - face.h / 2) * scale })
  }

  function place(mode: 'fit' | 'wrap' | 'tile' | 'tile-all', key = pieceId, face = region) {
    const item = project.pieces.find((candidate) => candidate.id === key)
    if (!item || (!face && mode !== 'tile-all')) return
    void perform(async () => {
      const source = await loadImage(item.src)
      if (mode === 'wrap' && face) {
        const order = ['front', 'left', 'back', 'right']
        const band = order.flatMap((name) => regions.filter((r) => r.part === face.part && r.face === name))
        if (band.length === 4) append(wrapPiece(source, band, item.name))
      } else {
        const targets = mode === 'tile-all' ? regions : [face!]
        append(targets.map((target) => fitPiece(source, target, item.name, mode !== 'fit')))
      }
    })
  }

  function addAsset(asset: Asset) {
    void perform(async () => {
      const source = await loadImage(assetImage(asset, options.color))
      const target = region ?? front
      if (['Cotton', 'Pinstripe', 'Denim'].includes(asset)) append([fitPiece(source, target, asset, true)])
      else {
        const size = Math.min(target.w, target.h) * .7
        append([newLayer(asset, source.src, { x: target.x + (target.w - size) / 2, y: target.y + (target.h - size) / 2, w: size, h: size })])
      }
    })
  }

  function shade(strength: number, color: string) {
    if (!image || !strength) return
    void perform(async () => {
      const ctx = surface(width, height)
      for (const face of region ? [region] : regions) {
        ctx.drawImage(await loadImage(shadingImage(face, color)), face.x, face.y)
        if (project.kind === 'pants' && ['front', 'back', 'left', 'right'].includes(face.face)) {
          const name = face.part === 'torso' ? 'pants-waist' : project.profile === 'shorts' ? 'shorts-leg' : 'pants-leg'
          ctx.drawImage(await loadImage(`/shading/${name}.png`), face.x, face.y, face.w, face.h)
        }
      }
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(image, 0, 0)
      append([{ ...newLayer('Shading overlay', ctx.canvas.toDataURL(), { x: 0, y: 0, w: width, h: height }),
        blend: 'soft-light', opacity: strength / 100 }])
    })
  }

  function mirror(mode: 'limb' | 'back', removeLogo: boolean) {
    if (!image) return
    void perform(async () => {
      const pairs = mode === 'back' ? (back ? [[front, back]] : [])
        : regions.filter((face) => face.part === 'leftLimb').flatMap((from) => {
          const face = from.face === 'left' ? 'right' : from.face === 'right' ? 'left' : from.face
          const to = regions.find((candidate) => candidate.part === 'rightLimb' && candidate.face === face)
          return to ? [[from, to]] : []
        })
      const layers = []
      for (const [from, to] of pairs) {
        const tile = crop(image, from)
        if (removeLogo) await eraseLogo(tile)
        layers.push({ ...newLayer(mode === 'back' ? 'Front copy' : `Left limb copy · ${from.face}`, tile.canvas.toDataURL(), to),
          flip: mode === 'limb' })
      }
      append(layers)
    })
  }

  function quick(mode: 'logo' | 'plain' | 'regenerate', scope: 'layer' | 'region') {
    if (!image || (scope === 'layer' && (!layer || layer.locked))) return
    void perform(async () => {
      if (mode === 'logo') {
        if (scope === 'layer' && layer) {
          const source = await loadImage(layer.src)
          const ctx = surface(source.width, source.height)
          ctx.drawImage(source, 0, 0)
          await eraseLogo(ctx)
          transform({ ...layer, src: ctx.canvas.toDataURL() })
        } else if (region) {
          const tile = crop(image, region)
          await eraseLogo(tile)
          append([newLayer('Logo cleanup', tile.canvas.toDataURL(), region)])
        }
        return
      }
      const target = scope === 'region' ? region : back
      if (!target || !back) return
      const ctx = surface(width, height)
      ctx.drawImage(image, 0, 0)
      if (scope === 'layer' && layer) {
        const source = await loadImage(layer.src)
        ctx.clearRect(0, 0, width, height)
        for (const side of regions.filter((face) => face.part === 'torso' && ['front', 'left', 'right'].includes(face.face))) {
          const fitted = fitPiece(source, side, layer.name)
          ctx.drawImage(await loadImage(fitted.src), side.x, side.y)
        }
      }
      backVersion.current = backVersion.current % 12 + 1
      const output = await quickFix(ctx.canvas.toDataURL(), project.kind,
        mode === 'plain' ? { plain_back: true } : { back_version: backVersion.current })
      const generated = crop(output, back)
      const result = await loadImage(generated.canvas.toDataURL())
      append([fitPiece(result, target, mode === 'plain' ? 'Plain back' : 'Regenerated back')])
    })
  }

  function addLayer() {
    const ctx = surface(width, height)
    append([newLayer('Layer', ctx.canvas.toDataURL(), { x: 0, y: 0, w: width, h: height })])
  }

  function importPng(file: File) {
    void perform(async () => {
      const { png, mode } = await importPreview(file, project.kind === 'pants' ? 'pants' : 'shirt')
      openProject(await importTemplate(pngUrl(png), mode, file.name.replace(/\.png$/i, '')))
    })
  }

  function exportPng() {
    void perform(async () => {
      const canvas = await composite(project)
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height)
      download(await exportTemplatePng(project.kind, pixels), `threadport-${project.kind}-template.png`)
      setCatalog(true)
    })
  }

  function saveSnapshot() {
    if (!snapshotName.trim()) return
    change((current) => ({ ...current, snapshots: [...current.snapshots, { name: snapshotName.trim(), artwork: artwork(current) }] }))
    setSnapshotName('')
  }

  return <div className="studio-editor">
    <div className="studio-command">
      <h1>Studio</h1>
      <div className="studio-row">
        <label className="studio-field">New template <select aria-label="New template" value={project.kind}
          onChange={(event) => { createProject(event.target.value as TemplateKind) }}>
          {Object.entries(templates).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select></label>
        <button type="button" className="secondary-button" onClick={() => createProject(project.kind)}>New blank</button>
        <button type="button" className="secondary-button" onClick={() => importInput.current?.click()}><Image size={14} /> Import PNG</button>
        <input aria-label="Import template PNG" ref={importInput} type="file" accept="image/png" hidden
          onChange={(event) => { const file = event.target.files?.[0]; if (file) importPng(file); event.target.value = '' }} />
      </div>
      <div className="studio-row studio-command-actions">
        <button type="button" className="secondary-button" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" disabled={!previous.current.length} onClick={() => restore(false)}><Undo2 size={16} /></button>
        <button type="button" className="secondary-button" aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)" disabled={!next.current.length} onClick={() => restore(true)}><Redo2 size={16} /></button>
        <button type="button" className="secondary-button" aria-pressed={avatar} onClick={() => setAvatar(!avatar)}>Avatar preview</button>
        <button type="button" className="primary-button studio-download" disabled={busy} onClick={exportPng}><Download size={16} /> Download PNG</button>
      </div>
    </div>
    {(saving || error) && <div className="studio-status">
      {saving && <span role="status">{saving}</span>}
      {error && <span role="alert">{error}</span>}
    </div>}
    <ToolOptions tool={tool} options={options} set={setOption} chooseColor={chooseColor} hasSelection={!!selection}
      clearSelection={() => setSelection(undefined)} eraseSelection={() => { void clearSelected() }} selected={layer} transform={transform} />
    <div className="studio-work">
      <aside className="studio-rail" aria-label="Studio tools">
        {tools.map((item) => {
          const Icon = item.icon
          const hint = 'key' in item ? `${item.label} (${item.key})` : item.label
          return <button type="button" key={item.id} title={hint} aria-label={item.label} aria-pressed={tool === item.id}
            onClick={() => setTool(item.id)}><Icon size={19} /></button>
        })}
      </aside>
      <section className="studio-stage" aria-label="Template editor">
        <div className="studio-canvas-bar">
          <label className="studio-field"><input type="checkbox" checked={showRegions}
            onChange={(event) => setShowRegions(event.target.checked)} /> Show regions</label>
          <span className="template-size">{width} × {height} px</span>
          <div className="studio-row">
            <button type="button" aria-label="Zoom out" onClick={() => setFrame({ ...frame, zoom: bound(frame.zoom / 1.4, .25, 16) })}>−</button>
            <button type="button" aria-label="Fit canvas" onClick={() => { setFrame(fitFrame); setRegion(undefined) }}>{Math.round(frame.zoom * 100)}%</button>
            <button type="button" aria-label="Zoom in" onClick={() => setFrame({ ...frame, zoom: bound(frame.zoom * 1.4, .25, 16) })}>+</button>
          </div>
        </div>
        <StudioCanvas project={project} image={image} tool={tool} options={options} selected={selection} layer={layer}
          region={region} showRegions={showRegions} showSeams={showSeams} frame={frame} setFrame={setFrame}
          setSelection={setSelection} gesture={gesture} onDropPiece={(key, face) => place('fit', key, face)} chooseLayer={chooseLayer} />
        {avatar && preview && <div className="studio-avatar"><Mannequins image={preview} mode={project.kind} /></div>}
      </section>
      <StudioPanels project={project} selected={layer} region={region} showSeams={showSeams} mask={mask} image={image}
        selectLayer={chooseLayer} updateLayer={updateLayer} addLayer={addLayer}
        deleteLayer={(item) => apply((current) => ({ ...current, layers: current.layers.filter((candidate) => candidate.id !== item.id) }))}
        duplicateLayer={duplicate} addGroup={() => apply((current) => {
          const group = { id: id(), name: `Group ${current.groups.length + 1}` }
          return { ...current, groups: [...current.groups, group], layers: current.layers.map((item) => item.id === layerId ? { ...item, group: group.id } : item) }
        })} moveLayer={(item, direction) => apply((current) => {
          const layers = [...current.layers]
          const from = layers.findIndex((candidate) => candidate.id === item.id)
          if (from < 0 || !layers[from + direction]) return current
          ;[layers[from], layers[from + direction]] = [layers[from + direction], layers[from]]
          return { ...current, layers }
        })}
        renameGroup={(key, name) => apply((current) => ({ ...current,
          groups: current.groups.map((group) => group.id === key ? { ...group, name } : group) }))}
        flipGroup={(key, hidden) => apply((current) => ({ ...current,
          layers: current.layers.map((item) => item.group === key ? { ...item, hidden } : item) }))}
        selectRegion={focusRegion} toggleSeams={setShowSeams}
        toggleMask={(value) => { setMask(value); if (value) setTool('eraser') }}
        color={options.color} colors={recent} chooseColor={chooseColor} stampAsset={addAsset} shade={shade}
        place={place} hasPiece={!!piece} mirror={mirror} quick={quick} />
    </div>
    <PhotoTray photos={project.photos} pieces={project.pieces} selected={pieceId} choose={setPieceId}
      addPhoto={(photo) => apply((current) => ({ ...current, photos: [...current.photos, photo] }))}
      updatePhoto={(photo) => change((current) => ({ ...current, photos: current.photos.map((item) => item.id === photo.id ? photo : item) }))}
      addPiece={(item) => { apply((current) => ({ ...current, pieces: [...current.pieces, item] })); setPieceId(item.id) }} />
    <div className="studio-bottom">
      <details className="panel studio-disclosure">
        <summary>Guided tips</summary>
        <ol>{instructions.map((tip) => <li key={tip}>{tip}</li>)}</ol>
      </details>
      <details className="panel studio-disclosure">
        <summary>Named snapshots</summary>
        <form className="studio-row" onSubmit={(event) => { event.preventDefault(); saveSnapshot() }}>
          <input aria-label="Snapshot name" value={snapshotName} maxLength={80}
            onChange={(event) => setSnapshotName(event.target.value)} placeholder={`${title} version`} />
          <button type="submit" className="secondary-button" disabled={!snapshotName.trim()}>Save snapshot</button>
        </form>
        {project.snapshots.map((item, index) => <button type="button" className="secondary-button" key={index}
          onClick={() => { apply((current) => ({ ...current, ...item.artwork })); setSelection(undefined); focusRegion() }}>Restore {item.name}</button>)}
      </details>
      <button className="secondary-button" type="button" aria-pressed={catalog} onClick={() => setCatalog(!catalog)}>Catalog checklist</button>
    </div>
    {catalog && preview && <CatalogChecklist png={preview.src.split(',')[1]} pixels={imagePixels(preview)}
      template={{ mode: project.kind, profile: project.profile ?? (project.kind === 'pants' ? 'pants' : project.kind === 'shirt' ? 'long_sleeve' : 't_shirt') }}
      sleeves="auto" colors={palette(imagePixels(preview))} />}
  </div>
}
