import { Check, Copy, Download, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { inspectTemplate } from './resultImage'
import { templates } from './template'
import type { PlacedTemplate } from './photos'
import type { Fixes, useResultEdits } from './useResultEdits'

const recolors = [
  { name: 'Slate', value: '#555e73' },
  { name: 'Ocean', value: '#2763a3' },
  { name: 'Berry', value: '#903b63' },
  { name: 'Forest', value: '#37634b' },
  { name: 'Sand', value: '#b19a78' },
]

function Slider({ label, value, onChange, min = -100 }: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
}) {
  return (
    <label className="fix-slider">
      <span>{label}<output aria-hidden="true">{value}%</output></span>
      <input type="range" aria-label={label} min={min} max={100} value={value} step={1}
        onChange={(event) => onChange(event.target.valueAsNumber)} />
    </label>
  )
}

export function FixPanel({ tools, palette, download, ready }: {
  tools: ReturnType<typeof useResultEdits>
  palette: string[]
  download: () => void
  ready: boolean
}) {
  const { fixes, update, template } = tools
  const [colorSource, setColorSource] = useState<string>()
  const selected = fixes.color?.source ?? (colorSource && palette.includes(colorSource) ? colorSource : palette[0])
  const classic = template.mode !== 't-shirt'
  const error = tools.renderError || tools.editError
  return (
    <section className="panel controls result-details" aria-labelledby="quick-fix-title">
      <h2 id="quick-fix-title">Quick-Fix</h2>
      <div className="fix-group">
        {classic && <Slider label="Shading strength" value={tools.shading} onChange={tools.setShading} min={0} />}
        <Slider label="Sharpness" value={fixes.sharpness} onChange={(value) => update('sharpness', value)} />
        <Slider label="Brightness" value={fixes.brightness} onChange={(value) => update('brightness', value)} />
        <Slider label="Saturation" value={fixes.saturation} onChange={(value) => update('saturation', value)} />
      </div>
      {palette.length > 0 && (
        <fieldset className="fix-group recolor">
          <legend>Swap color</legend>
          <p>Pick a color from your template</p>
          <div className="swatches" role="group" aria-label="Template colors">
            {palette.map((swatch) => (
              <button key={swatch} type="button" className="swatch" style={{ background: swatch }}
                aria-label={`Select fabric color ${swatch}`} title={swatch}
                aria-pressed={selected === swatch} onClick={() => {
                  setColorSource(swatch)
                  if (fixes.color) update('color', { source: swatch, target: fixes.color.target })
                }} />
            ))}
          </div>
          <p>Choose a new color</p>
          <div className="swatches" role="group" aria-label="New fabric color">
            {recolors.map(({ name, value }) => (
              <button key={name} type="button" className="swatch" title={name} style={{ background: value }}
                aria-label={`Recolor to ${name}`} aria-pressed={fixes.color?.target === value}
                onClick={() => update('color', { source: selected, target: value })} />
            ))}
            <input type="color" aria-label="Custom fabric color" title="Custom fabric color"
              value={fixes.color?.target ?? '#555e73'} onChange={(event) =>
                update('color', { source: selected, target: event.target.value })} />
          </div>
        </fieldset>
      )}
      <div className="fix-group">
        <label className="fix-check">
          Remove logo <input type="checkbox" checked={fixes.remove_logo}
            onChange={(event) => update('remove_logo', event.target.checked)} />
        </label>
        {classic && (
          <>
            <label className="fix-check">
              Make back plain <input type="checkbox" checked={fixes.plain_back}
                onChange={(event) => update('plain_back', event.target.checked)} />
            </label>
            <button className="secondary-button fix-action" type="button" onClick={tools.regenerate}>Regenerate back</button>
          </>
        )}
        {template.mode === 'shirt' && (
          <label className="fix-select">Sleeves
            <select value={fixes.sleeves} onChange={(event) => update('sleeves', event.target.value as Fixes['sleeves'])}>
              <option value="auto">Auto</option><option value="short">Short</option>
              <option value="long">Long</option><option value="none">None</option>
            </select>
          </label>
        )}
        <label className="fix-select">Style
          <select value={fixes.style} onChange={(event) => update('style', event.target.value as Fixes['style'])}>
            <option value="realistic">Realistic</option><option value="clean">Clean</option>
            <option value="cartoon">Cartoon</option><option value="vintage">Vintage</option>
            <option value="grunge">Grunge</option>
          </select>
        </label>
      </div>
      <div className="fix-group">
        <button className="secondary-button fix-action" type="button" onClick={tools.rerun}>
          <RotateCcw size={14} aria-hidden="true" /> Re-run auto placement
        </button>
        <button className="text-button fix-action" type="button" onClick={tools.reset}>Reset adjustments</button>
        {error ? (
          <>
            <p className="fix-error" role="alert">{error}</p>
            <button className="secondary-button fix-action" type="button"
              onClick={tools.renderError ? tools.rerun : tools.retry}>Retry</button>
          </>
        ) : (tools.placing || tools.editing) && (
          <p role="status">{tools.placing ? 'Rendering the template…' : 'Applying Quick-Fix…'}</p>
        )}
        <button className="primary-button download-result" type="button" onClick={download} disabled={!ready}>
          <Download size={16} aria-hidden="true" /> Download PNG
        </button>
      </div>
    </section>
  )
}

const width = 144
const height = 176

function FlatFigure({ image, mode, view }: {
  image: HTMLImageElement
  mode: PlacedTemplate['mode']
  view: 'front' | 'back'
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#73757d'
    context.fillRect(49, 4, 46, 39)
    context.fillStyle = '#565962'
    context.fillRect(40, 46, 64, 64)
    context.fillStyle = '#686b74'
    context.fillRect(8, 46, 32, 64)
    context.fillRect(104, 46, 32, 64)
    context.fillStyle = '#454851'
    context.fillRect(40, 110, 31, 64)
    context.fillRect(73, 110, 31, 64)
    if (mode === 't-shirt') {
      if (view === 'front') context.drawImage(image, 48, 51, 48, 48)
      return
    }

    const regions = templates[mode].regions
    const draw = (part: string, x: number, y: number, w: number, h: number) => {
      const face = regions.find((region) => region.part === part && region.face === view)
      if (face) context.drawImage(image, face.x, face.y, face.w, face.h, x, y, w, h)
    }
    const viewerLeft = view === 'front' ? 'rightLimb' : 'leftLimb'
    const viewerRight = view === 'front' ? 'leftLimb' : 'rightLimb'
    if (mode === 'shirt') {
      draw('torso', 40, 46, 64, 64)
      draw(viewerLeft, 8, 46, 32, 64)
      draw(viewerRight, 104, 46, 32, 64)
    } else {
      draw('torso', 40, 82, 64, 28)
      draw(viewerLeft, 40, 110, 31, 64)
      draw(viewerRight, 73, 110, 31, 64)
    }
  }, [image, mode, view])

  return (
    <figure>
      <canvas ref={canvas} width={width} height={height} role="img"
        aria-label={`Flat ${view} mannequin preview`} />
      <figcaption>{view === 'front' ? 'Front' : 'Back'}</figcaption>
    </figure>
  )
}

export function Mannequins({ image, mode }: { image: HTMLImageElement; mode: PlacedTemplate['mode'] }) {
  return (
    <section className="result-flat" aria-labelledby="flat-preview-title">
      <h2 id="flat-preview-title">Avatar preview</h2>
      <div className="flat-figures">
        <FlatFigure image={image} mode={mode} view="front" />
        <FlatFigure image={image} mode={mode} view="back" />
      </div>
    </section>
  )
}

function describeColor(value?: string): string {
  if (!value) return ''
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16))
  const high = Math.max(r, g, b)
  if (high < 54) return 'Black'
  if (high - Math.min(r, g, b) < 24) return high > 208 ? 'White' : 'Gray'
  return high === b ? high < 105 ? 'Navy' : 'Blue' : high === g ? 'Green' : g > b + 28 ? 'Warm' : 'Red'
}

export function CatalogChecklist({ png, pixels, template, sleeves, colors }: {
  png: string
  pixels: ImageData
  template: Pick<PlacedTemplate, 'mode' | 'profile'>
  sleeves: Fixes['sleeves']
  colors: string[]
}) {
  const [copyStatus, setCopyStatus] = useState('')
  const { mode, profile } = template
  const check = useMemo(() => inspectTemplate(png, pixels, mode, profile, sleeves), [png, pixels, mode, profile, sleeves])
  const { width, height, label } = templates[template.mode]
  const color = describeColor(colors[0])
  const item = template.mode === 't-shirt' ? 'T-Shirt' : `Classic ${label}`
  const name = [color, item].filter(Boolean).join(' ')
  const tags = [color.toLowerCase(), label.toLowerCase(), 'classic clothing'].filter(Boolean).join(', ')
  const listing = [
    { label: 'Name', value: name },
    { label: 'Description', value: `A ${name.toLowerCase()} for your Roblox avatar.` },
    { label: 'Tags', value: tags },
  ]
  const checks = [
    { pass: check.exactSize, label: `Template size · ${width} × ${height}` },
    { pass: check.isPng, label: 'PNG format' },
    { pass: check.transparency, label: 'Transparency' },
    { pass: check.visible && !check.emptyRegions.length, label: 'Required regions filled' },
  ]

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(`${label} copied.`)
    } catch {
      setCopyStatus(`Couldn’t copy ${label.toLowerCase()}. Select the text to copy it.`)
    }
  }

  return (
    <section className="panel catalog-checklist" aria-labelledby="catalog-title">
      <h2 id="catalog-title">Catalog checklist</h2>
      <ul className="catalog-checks">
        {checks.map(({ pass, label }) => (
          <li key={label} className={pass ? 'check-pass' : 'check-fail'}>
            {pass ? <Check size={16} aria-label="Pass" /> : <X size={16} aria-label="Needs attention" />}
            {label}
          </li>
        ))}
      </ul>
      {check.emptyRegions.length > 0 && (
        <p className="result-note">Empty regions: {check.emptyRegions.join(', ')}.</p>
      )}
      <p className="catalog-warning">Check that you have permission to use any logos or artwork in this design.</p>
      <dl className="catalog-listing">
        {listing.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <button className="secondary-button" type="button" aria-label={`Copy ${label.toLowerCase()}`}
              onClick={() => { void copy(label, value) }}>
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
          </div>
        ))}
      </dl>
      {copyStatus && <p className="result-note" role="status">{copyStatus}</p>}
      <p className="result-note">Check current upload fees and Marketplace rules before uploading.{' '}
        <a href="https://create.roblox.com/docs/marketplace/publish-to-marketplace" target="_blank" rel="noreferrer">
          Roblox Creator Hub
        </a>
      </p>
    </section>
  )
}
