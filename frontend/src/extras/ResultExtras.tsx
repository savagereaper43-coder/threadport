import { Download, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { downloadResult } from '../resultImage'
import { importTemplate, loadImage, pngUrl } from '../studio/raster'
import type { Project } from '../studio/model'
import { templates } from '../template'
import type { TemplateKind } from '../template'
import { changeArtwork, checkGraphics, downloadSet, replaceGraphic, shareImage } from './artwork'
import type { GraphicMatch } from './artwork'
import { bases, generateBase } from './bases'
import type { Base, Generated } from './bases'

const colors = [
  { name: 'Slate', hex: '#424952' }, { name: 'Cobalt', hex: '#376095' },
  { name: 'Berry', hex: '#873e64' }, { name: 'Forest', hex: '#37604b' },
  { name: 'Rust', hex: '#a35436' }, { name: 'Sand', hex: '#b79873' },
]

type Pane = 'matching' | 'colorways' | 'starters'

export function ResultExtras({ png, mode, original, imported, ready, fabricColor, useArtwork, openStudio }: {
  png: string; mode: TemplateKind; original: File; imported: boolean; ready: boolean; fabricColor?: string
  useArtwork: (png: string) => void; openStudio: (project: Project) => void
}) {
  const modal = useRef<HTMLDialogElement>(null)
  const [pane, setPane] = useState<Pane>('matching')
  const [match, setMatch] = useState<Generated>()
  const [palette, setPalette] = useState<Generated[]>([])
  const [starter, setStarter] = useState<Generated>()
  const [starterType, setStarterType] = useState<Base>('hoodie')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [status, setStatus] = useState('')
  const kind = mode === 'pants' ? 'shirt' : 'pants'
  const [customColor, setCustomColor] = useState('#5e407c')
  const [shown, setShown] = useState<Generated>()
  const matchName = kind === 'pants' ? 'Matching pants' : 'Matching shirt'
  const title = { matching: matchName, colorways: 'Colorways', starters: 'Starter bases' }[pane]
  const generated = pane === 'matching' ? match : starter

  async function perform(work: () => Promise<void>) {
    setBusy(true)
    setFailure('')
    setStatus('')
    try { await work() }
    catch (error) { setFailure(error instanceof Error ? error.message : 'We couldn’t prepare this version.') }
    finally { setBusy(false) }
  }

  async function createColors() {
    if (!fabricColor) return
    const variants: Generated[] = []
    setPalette([])
    for (const color of colors) {
      variants.push({ name: color.name, mode, png: await changeArtwork(png, mode, { color: { source: fabricColor, target: color.hex } }) })
      setPalette([...variants])
    }
  }

  async function starterWithTemplate(key: Base, name?: string) {
    const [image, graphics] = await Promise.all([
      loadImage(pngUrl(png)), checkGraphics(png, mode).catch(() => ({ matches: [] })),
    ])
    return generateBase(key, image, mode, name, graphics.matches)
  }

  function show(next: Pane) {
    setPane(next)
    setFailure('')
    setStatus('')
    setShown(undefined)
    modal.current?.showModal()
    if (next === 'matching') {
      void perform(async () => setMatch(await starterWithTemplate(kind === 'pants' ? 'jeans' : 'hoodie', matchName)))
    } else if (next === 'colorways') {
      void perform(createColors)
    } else {
      void perform(async () => setStarter(await starterWithTemplate(starterType)))
    }
  }

  function exportSet() {
    try {
      downloadSet([{ name: `threadport-${mode}`, png }, ...(match ? [match] : []),
        ...(starter ? [starter] : []), ...palette], 'threadport-set.zip')
      setStatus('ZIP downloaded.')
    } catch { setFailure('We couldn’t create the ZIP. Try again.') }
  }

  function edit(generated: Generated) {
    void perform(async () => {
      const project = await importTemplate(pngUrl(generated.png), generated.mode, generated.name)
      if (generated.profile) {
        project.profile = generated.profile
      }
      openStudio(project)
    })
  }

  return <section className="result-extras" aria-label="More ways to use this template">
    <button className="secondary-button" type="button" disabled={!ready || busy} onClick={() => show('matching')}>Make {matchName.toLowerCase()}</button>
    <button className="secondary-button" type="button" disabled={!ready || busy || !fabricColor} onClick={() => show('colorways')}>Colorways</button>
    <button className="secondary-button" type="button" disabled={!ready || busy} onClick={() => show('starters')}>Starter bases</button>
    <button className="secondary-button" type="button" disabled={!ready || busy} onClick={exportSet}>Export set (ZIP)</button>
    <button className="secondary-button" type="button" disabled={!ready || busy}
      onClick={() => { void perform(async () => { await shareImage(original, png, imported); setStatus('Before and after image downloaded.') }) }}>Before/after image</button>
    {failure && <p className="extra-error" role="alert">{failure}</p>}
    {status && <p className="result-note" role="status">{status}</p>}
    <dialog ref={modal} className="panel extras-dialog" aria-labelledby="extras-title">
      <div className="dialog-heading">
        <h2 id="extras-title">{title}</h2>
        <button className="icon-button" type="button" aria-label="Close template tools" onClick={() => modal.current?.close()}><X size={18} /></button>
      </div>
      {pane === 'starters' && <div className="extra-toolbar">
        <label>Garment <select value={starterType} disabled={busy} onChange={(event) => {
          const selected = event.target.value as Base
          setStarterType(selected)
          void perform(async () => setStarter(await starterWithTemplate(selected)))
        }}>{Object.entries(bases).map(([key, base]) => <option key={key} value={key}>{base.name}</option>)}</select></label>
      </div>}
      {pane === 'colorways' && <div className="colorway-body">
        <div className="extra-toolbar">
          <label>Custom color <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /></label>
          <button className="secondary-button" type="button" disabled={busy || !fabricColor} onClick={() => void perform(async () => {
            if (!fabricColor) return
            const pngValue = await changeArtwork(png, mode, { color: { source: fabricColor, target: customColor } })
            setPalette((previous) => [...previous.filter((item) => item.name !== customColor), { name: customColor, mode, png: pngValue }])
          })}>Add colorway</button>
        </div>
        <div className="colorway-grid">
          {palette.map((item) => <button key={item.name} type="button" aria-pressed={shown === item} className="colorway-tile"
            onClick={() => setShown(item)}>
            <img src={pngUrl(item.png)} alt={`${item.name} template`} /><span>{item.name}</span>
          </button>)}
        </div>
        {shown && <div className="extra-toolbar">
          <button className="primary-button" type="button" onClick={() => { useArtwork(shown.png); modal.current?.close() }}>Use {shown.name}</button>
          <button className="secondary-button" type="button" onClick={() => downloadResult(shown.png, `threadport-${shown.name.replace('#', '')}.png`)}>Download {shown.name} PNG</button>
        </div>}
      </div>}
      {generated && pane !== 'colorways' && <figure className="extra-preview">
        <div className="checkerboard"><img src={pngUrl(generated.png)} alt={`${generated.name} template`} /></div>
        <figcaption className="extra-toolbar">
          <button className="primary-button" type="button" disabled={busy}
            onClick={() => downloadResult(generated.png, `threadport-${generated.name.toLowerCase().replace(' ', '-')}.png`)}><Download size={15} /> Download {generated.name} PNG</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => edit(generated)}>Open in Studio</button>
        </figcaption>
      </figure>}
      {busy && <p className="result-note" role="status">Preparing templates…</p>}
      {failure && <p className="extra-error" role="alert">{failure}</p>}
      {(generated || palette.length > 0) && <button className="secondary-button dialog-zip" type="button" disabled={busy} onClick={exportSet}>Download ZIP set</button>}
    </dialog>
  </section>
}

export function GraphicsReview({ png, mode, ready, useArtwork }: {
  png: string; mode: TemplateKind; ready: boolean; useArtwork: (png: string) => void
}) {
  const activePng = useRef(png)
  activePng.current = png
  const [scan, setScan] = useState<{ png: string; matches: GraphicMatch[] }>()
  const [scanError, setScanError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    if (!ready) return
    const request = new AbortController()
    const timer = window.setTimeout(() => {
      setScanError(false)
      void checkGraphics(png, mode, request.signal)
        .then(({ matches }) => { if (!request.signal.aborted) setScan({ png, matches }) })
        .catch(() => { if (!request.signal.aborted) setScanError(true) })
    }, 300)
    return () => { window.clearTimeout(timer); request.abort() }
  }, [png, mode, ready, retry])

  async function edit(match: GraphicMatch, graphic?: File) {
    setBusy(true)
    setFailure('')
    try {
      const next = graphic ? await replaceGraphic(png, mode, match, graphic)
        : await changeArtwork(png, mode, { remove_logo: true, logo_face: match.side })
      if (activePng.current === png) useArtwork(next)
    } catch (error) { setFailure(error instanceof Error ? error.message : 'We couldn’t edit the artwork.') }
    finally { setBusy(false) }
  }

  const matches = scan?.png === png ? scan.matches : undefined
  const { width, height } = templates[mode]
  return <section className="panel graphics-review" aria-labelledby="graphic-title">
    <h2 id="graphic-title">Logo and text check</h2>
    {scanError ? <p>We couldn’t check this image. <button className="text-button" type="button" onClick={() => setRetry(retry + 1)}>Retry check</button></p>
      : ready && matches ? (matches.length > 0
        ? <>
          <p className="catalog-warning">Possible logo or text found. Roblox may remove a listing if you use artwork without permission.</p>
          {matches.map((match) => <div className="graphic-row" key={match.side}>
            <span>{match.side === 'front' ? 'Front artwork' : 'Back artwork'}</span>
            <div className="graphic-sample" style={{ aspectRatio: match.w / match.h, width: 66 * Math.min(1, match.w / match.h) }}>
              <img src={pngUrl(png)} alt={`Possible ${match.side} artwork`}
                style={{ width: `${width / match.w * 100}%`, height: `${height / match.h * 100}%`,
                  left: `${-match.x / match.w * 100}%`, top: `${-match.y / match.h * 100}%` }} />
            </div>
            <button className="secondary-button" type="button" disabled={busy || !ready} onClick={() => { void edit(match) }}>Remove {match.side} artwork</button>
            <label className="secondary-button graphic-upload">
              Replace {match.side} artwork
              <input type="file" aria-label={`Replace ${match.side} artwork`} accept="image/png" disabled={busy || !ready}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void edit(match, file); event.target.value = '' }} />
            </label>
          </div>)}
        </>
        : <p>No strong logo or text candidates found.</p>) : <p>Checking the current template…</p>}
    {busy && <p role="status">Updating the artwork…</p>}
    {failure && <p className="extra-error" role="alert">{failure}</p>}
  </section>
}
