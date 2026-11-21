import { useEffect, useRef, useState } from 'react'
import { Image as CanvasImage, Layer, Stage } from 'react-konva'
import { usePhotoUrl } from './PhotoUpload'
import type { PlacedTemplate, ProcessResult } from './photos'
import { regionLabel, templates } from './template'

const photoTypes: Record<string, string> = {
  flat_lay: 'Laid flat',
  hanger_product: 'Hanger or product photo',
  ghost_mannequin: 'Invisible mannequin',
  worn: 'Worn by a person',
  folded: 'Folded',
}

const profiles = {
  t_shirt: 'Short-sleeve top',
  long_sleeve: 'Long-sleeve top',
  hoodie: 'Hoodie',
  pants: 'Pants',
  shorts: 'Shorts',
}

function GeneratedTemplate({ template, showRegions }: { template: PlacedTemplate; showRegions: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState<HTMLImageElement>()
  const [previewWidth, setPreviewWidth] = useState(0)
  const { label, width, height, regions } = templates[template.mode]

  useEffect(() => {
    const next = new Image()
    next.onload = () => setImage(next)
    next.src = `data:image/png;base64,${template.png}`
    return () => { next.onload = null }
  }, [template.png])

  useEffect(() => {
    const node = host.current
    if (!node) return
    const resize = new ResizeObserver(([entry]) => setPreviewWidth(entry.contentRect.width))
    resize.observe(node)
    return () => resize.disconnect()
  }, [])

  const scale = previewWidth / width
  return (
    <div
      ref={host}
      className="checkerboard generated-template"
      style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}
      role={showRegions ? 'group' : 'img'}
      aria-label={`Generated ${label} template`}
    >
      {previewWidth > 0 && (
        <Stage width={previewWidth} height={height * scale} listening={false}>
          <Layer><CanvasImage image={image} width={previewWidth} height={height * scale} /></Layer>
        </Stage>
      )}
      {showRegions && regions.map(({ part, face, x, y, w, h }) => (
        <div
          key={`${part}.${face}`}
          className="region"
          title={regionLabel(template.mode, part, face)}
          style={{
            left: `${100 * x / width}%`,
            top: `${100 * y / height}%`,
            width: `${100 * w / width}%`,
            height: `${100 * h / height}%`,
          }}
        >
          {regionLabel(template.mode, part, face)}
        </div>
      ))}
    </div>
  )
}

export default function TemplateResult({ original, result, onBack }: {
  original: File
  result: ProcessResult
  onBack: () => void
}) {
  const source = usePhotoUrl(original)
  const heading = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState(-1)
  const [showRegions, setShowRegions] = useState(false)
  const { photos, template } = result
  const { label, width, height } = templates[template.mode]
  const cutout = photos[selected]
  const photoType = photoTypes[(cutout ?? photos[0]).photo_type]
  const firstAngle = photos.findIndex(({ role }) => role === 'angles')

  useEffect(() => { heading.current?.focus() }, [])

  return (
    <div className="result-page">
      <div className="page-heading">
        <h1 ref={heading} tabIndex={-1}>Template preview</h1>
        <p>Clothing from your photo is now placed on the Roblox template.</p>
      </div>
      <div className="result-grid">
        <section className="panel result-source" aria-labelledby="source-title">
          <div className="panel-header"><h2 id="source-title">Your photo</h2></div>
          <div className={cutout ? 'result-photo cutout-image' : 'result-photo'}>
            {cutout ? (
              <img src={`data:image/png;base64,${cutout.png}`} alt="Clothing with the background removed" />
            ) : source && <img src={source} alt="Original clothing photo" />}
          </div>
          <label className="source-selector">
            Photo preview
            <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              <option value={-1}>Original photo</option>
              {photos.map(({ role }, index) => (
                <option key={index} value={index}>
                  {role === 'front' ? 'Main cutout' : role === 'back' ? 'Back cutout' : `Angle ${index + 1 - firstAngle} cutout`}
                </option>
              ))}
            </select>
          </label>
          <p className="source-type">Photo type guess: {photoType}</p>
        </section>
        <section className="panel preview" aria-labelledby="placed-title">
          <div className="panel-header">
            <h2 id="placed-title">Roblox template</h2>
            <span className="template-size">{width} × {height} px</span>
          </div>
          <div className="preview-area"><GeneratedTemplate template={template} showRegions={showRegions} /></div>
        </section>
        <section className="panel controls result-details" aria-labelledby="placed-details">
          <h2 id="placed-details">Template details</h2>
          <dl className="photo-details">
            <div><dt>Template type</dt><dd>{label}</dd></div>
            <div><dt>Clothing guess</dt><dd>{profiles[template.profile]}</dd></div>
          </dl>
          {template.mode !== 't-shirt' && (
            <p className="result-note">
              {template.has_back
                ? 'The torso back uses your back photo.'
                : 'Add a back photo to fill the torso back. The arms or legs wrap using fabric from your photo.'}
            </p>
          )}
          <label className="guide-control">
            <span>Show regions</span>
            <input type="checkbox" checked={showRegions} onChange={(event) => setShowRegions(event.target.checked)} />
          </label>
          <button className="text-button" type="button" onClick={onBack}>Back to upload</button>
        </section>
      </div>
    </div>
  )
}
