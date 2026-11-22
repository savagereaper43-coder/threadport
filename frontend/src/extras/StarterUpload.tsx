import { useRef, useState } from 'react'
import { downloadResult } from '../resultImage'
import type { Project } from '../studio/model'
import { removeBackground } from '../studio/PhotoTray'
import { fileUrl, importTemplate, loadImage, pngUrl } from '../studio/raster'
import { bases, generateBase } from './bases'
import type { Base, Generated } from './bases'

export function StarterUpload({ openStudio }: { openStudio: (project: Project) => void }) {
  const [kind, setKind] = useState<Base>('hoodie')
  const [cutout, setCutout] = useState(true)
  const [file, setFile] = useState<File>()
  const [result, setResult] = useState<Generated>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function create() {
    if (!file) return
    setBusy(true)
    setResult(undefined)
    setError('')
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo up to 10 MB.')
      if (!/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, or WebP photo.')
      const source = await loadImage(cutout ? await removeBackground(file) : await fileUrl(file))
      if (source.width * source.height > 20_000_000) throw new Error('Choose a photo up to 20 megapixels.')
      setResult(await generateBase(kind, source))
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'We couldn’t prepare a starter from this photo.'
      setError(cutout ? `${message} For a fabric close-up, turn off background removal and try again.` : message)
    } finally { setBusy(false) }
  }

  async function openResult() {
    if (!result) return
    setBusy(true)
    setError('')
    try {
      const project = await importTemplate(pngUrl(result.png), result.mode, result.name)
      openStudio({ ...project, profile: result.profile })
    } catch { setError('We couldn’t open the starter in Studio.') }
    finally { setBusy(false) }
  }

  return <details className="panel template-upload">
    <summary>Build from a starter base</summary>
    <p>Use a clothing photo or fabric close-up to add its colors and texture to a built-in garment.</p>
    <div className="extra-toolbar">
      <label>Starter garment <select value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as Base); setResult(undefined) }}>
        {Object.entries(bases).map(([key, base]) => <option value={key} key={key}>{base.name}</option>)}
      </select></label>
      <label><input type="checkbox" checked={cutout} disabled={busy} onChange={(event) => { setCutout(event.target.checked); setResult(undefined) }} /> Remove the background first</label>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>Choose fabric photo</button>
      <input ref={input} type="file" hidden aria-label="Fabric photo for starter" accept="image/jpeg,image/png,image/webp"
        onChange={(event) => { setFile(event.target.files?.[0]); setResult(undefined); setError(''); event.target.value = '' }} />
      {file && <span className="starter-filename">{file.name}</span>}
      <button type="button" className="primary-button" disabled={!file || busy} onClick={() => { void create() }}>Build starter</button>
    </div>
    {busy && <p role="status">Preparing your starter…</p>}
    {error && <p className="extra-error" role="alert">{error}</p>}
    {result && <figure className="extra-preview">
      <div className="checkerboard"><img src={pngUrl(result.png)} alt={`${result.name} starter template`} /></div>
      <figcaption className="extra-toolbar">
        <button className="primary-button" type="button" onClick={() => downloadResult(result.png, `threadport-${result.name.toLowerCase()}.png`)}>Download starter PNG</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { void openResult() }}>Open starter in Studio</button>
      </figcaption>
    </figure>}
  </details>
}
