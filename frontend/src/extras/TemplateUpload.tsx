import { useRef, useState } from 'react'
import type { ProcessResult } from '../photos'
import { imagePixels } from '../resultImage'
import { loadImage, pngUrl } from '../studio/raster'
import { importPreview } from './artwork'
import { templates } from '../template'

export function TemplateUpload({ ready }: { ready: (file: File, result: ProcessResult) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'shirt' | 'pants'>('shirt')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function open(file: File) {
    setError('')
    setBusy(true)
    try {
      const result = await importPreview(file, mode)
      const pixels = result.mode === 't-shirt' ? undefined : imagePixels(await loadImage(pngUrl(result.png)))
      const alpha = (x: number, y: number) => pixels ? pixels.data[(pixels.width * y + x) * 4 + 3] : 0
      const limbs = templates[result.mode].regions.filter((face) => face.part !== 'torso' && face.face === 'front')
      const covered = limbs.some(({ x, y, w, h }) => [0.25, 0.5, 0.75].some((step) => alpha(x + Math.floor(w * step), y + h - 12) > 16))
      const profile = result.mode === 'pants' ? (covered ? 'pants' : 'shorts')
        : result.mode === 'shirt' && covered ? 'long_sleeve' : 't_shirt'
      ready(file, { photos: [], template: { ...result, profile, has_back: false, quality: { score: 0, regions: {} } } })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We couldn’t open the template PNG.')
    } finally { setBusy(false) }
  }

  return <details className="panel template-upload">
    <summary>Restyle an existing Roblox template</summary>
    <p>Open a 585 × 559 Classic Clothing template or a 512 × 512 T-Shirt PNG.</p>
    <div className="extra-toolbar">
      <label>Classic clothing type <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
        <option value="shirt">Shirt</option><option value="pants">Pants</option>
      </select></label>
      <button className="secondary-button" type="button" onClick={() => input.current?.click()} disabled={busy}>Choose template PNG</button>
      <input aria-label="Choose template to restyle" type="file" accept=".png,image/png" ref={input} hidden
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void open(file); event.target.value = '' }} />
    </div>
    {busy && <p role="status">Opening the template…</p>}
    {error && <p className="extra-error" role="alert">{error}</p>}
  </details>
}
