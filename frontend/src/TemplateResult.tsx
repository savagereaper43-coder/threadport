import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as CanvasImage, Layer, Stage } from 'react-konva'
import { usePhotoUrl } from './PhotoUpload'
import { downloadResult, imagePixels, palette, useTemplateImage } from './resultImage'
import { CatalogChecklist, FixPanel, Mannequins } from './ResultTools'
import { GraphicsReview, ResultExtras } from './extras/ResultExtras'
import { useResultEdits } from './useResultEdits'
import type { Mode, PhotoSelection, PlacedTemplate, ProcessResult } from './photos'
import { regionLabel, templates } from './template'
import { id } from './studio/model'
import type { Project } from './studio/model'
import { fileUrl, importTemplate, pngUrl } from './studio/raster'

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

function GeneratedTemplate({ template, image, showRegions }: {
  template: PlacedTemplate
  image?: HTMLImageElement
  showRegions: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [previewWidth, setPreviewWidth] = useState(0)
  const [activeRegion, setActiveRegion] = useState('')
  const { label, width, height, regions } = templates[template.mode]

  useEffect(() => {
    const node = host.current
    if (!node) return
    const resize = new ResizeObserver(([entry]) => setPreviewWidth(entry.contentRect.width))
    resize.observe(node)
    return () => resize.disconnect()
  }, [])

  const scale = previewWidth / width
  const inspected = showRegions ? template.quality.regions[activeRegion] : undefined
  const [part, face] = activeRegion.split('.')
  return (
    <>
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
        {showRegions && regions.map(({ part, face, x, y, w, h }) => {
          const key = `${part}.${face}`
          const quality = template.quality.regions[key]
          const name = regionLabel(template.mode, part, face)
          const details = quality ? `${name} · ${quality.score}%${quality.note ? ` · ${quality.note}` : ''}` : name
          const low = quality && quality.score < 75
          return (
            <div
              key={key}
              className={low ? 'region low-confidence' : 'region'}
              title={details}
              tabIndex={quality ? 0 : undefined}
              aria-label={details}
              role={quality ? 'img' : undefined}
              onMouseEnter={quality ? () => setActiveRegion(key) : undefined}
              onFocus={quality ? () => setActiveRegion(key) : undefined}
              style={{
                left: `${100 * x / width}%`,
                top: `${100 * y / height}%`,
                width: `${100 * w / width}%`,
                height: `${100 * h / height}%`,
              }}
            >
              {name}
            </div>
          )
        })}
      </div>
      {inspected && (
        <p className="region-quality">
          {regionLabel(template.mode, part, face)} · {inspected.score}%{inspected.note && ` · ${inspected.note}`}
        </p>
      )}
    </>
  )
}

export default function TemplateResult({ original, selection, mode, result, onBack, openStudio, imported = false, backLabel = "Back to upload" }: {
  original: File
  selection: PhotoSelection
  mode: Mode
  result: ProcessResult
  onBack: (png: string) => void
  openStudio: (project: Project) => void
  imported?: boolean
  backLabel?: string
}) {
  const source = usePhotoUrl(original)
  const heading = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState(-1)
  const [showRegions, setShowRegions] = useState(false)
  const [openingStudio, setOpeningStudio] = useState(false)
  const [studioError, setStudioError] = useState('')
  const tools = useResultEdits(result, selection, mode)
  const { photos, template, png } = tools
  const baseImage = useTemplateImage(tools.base)
  const display = useTemplateImage(png)
  const displayPixels = useMemo(() => display.image && imagePixels(display.image), [display.image])
  const baseColors = useMemo(() => palette(baseImage.image && imagePixels(baseImage.image)), [baseImage.image])
  const displayColors = useMemo(() => palette(displayPixels), [displayPixels])
  const { label, width, height } = templates[template.mode]
  const cutout = photos[selected]
  const photoType = photoTypes[(cutout ?? photos[0])?.photo_type ?? ""]
  const firstAngle = photos.findIndex(({ role }) => role === 'angles')
  const settled = !tools.placing && !tools.editing && display.ready

  useEffect(() => { heading.current?.focus() }, [])

  async function editInStudio() {
    setOpeningStudio(true)
    setStudioError('')
    try {
      const sourceFiles = [selection.front, selection.back, ...selection.angles].filter((file): file is File => !!file)
      const tray = await Promise.all(photos.map(async (photo, i) => ({
        id: id(), name: sourceFiles[i]?.name ?? `Photo ${i + 1}`,
        src: sourceFiles[i] ? await fileUrl(sourceFiles[i]) : pngUrl(photo.png), cutout: pngUrl(photo.png),
      })))
      const project = await importTemplate(pngUrl(png), template.mode, `Auto Bash ${label}`, tray)
      openStudio({ ...project, profile: template.profile })
    } catch {
      setStudioError('We couldn’t open this result in Studio. Try again.')
      setOpeningStudio(false)
    }
  }

  return (
    <div className="result-page">
      <div className="page-heading">
        <h1 ref={heading} tabIndex={-1}>Template preview</h1>
      </div>
      <div className="result-grid">
        <section className="panel result-source" aria-labelledby="source-title">
          <div className="panel-header"><h2 id="source-title">{imported ? "Original template" : "Your photo"}</h2></div>
          <div className={cutout ? 'result-photo cutout-image' : 'result-photo'}>
            {cutout ? (
              <img src={`data:image/png;base64,${cutout.png}`} alt="Clothing with the background removed" />
            ) : source && <img src={source} alt={imported ? "Original Roblox template" : "Original clothing photo"} />}
          </div>
          {!imported && <label className="source-selector">
            Photo preview
            <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              <option value={-1}>Original photo</option>
              {photos.map(({ role }, index) => (
                <option key={index} value={index}>
                  {role === 'front' ? 'Main cutout' : role === 'back' ? 'Back cutout' : `Angle ${index + 1 - firstAngle} cutout`}
                </option>
              ))}
            </select>
          </label>}
          {!imported && <p className="source-type">Photo type guess: {photoType}</p>}
        </section>
        <div className="result-center">
          <section className="panel preview" aria-labelledby="placed-title">
            <div className="panel-header">
              <div>
                <h2 id="placed-title">Roblox template</h2>
                <p className="template-size">{label} · {profiles[template.profile]}</p>
              </div>
              <span className="template-size">{width} × {height} px</span>
            </div>
            <div className="preview-area">
              <GeneratedTemplate template={template} image={display.image} showRegions={showRegions} />
              {display.failed && <p role="alert">The template couldn’t open. Re-run auto placement to try again.</p>}
              <div className="preview-controls">
                {!imported && <span className="match-score" title="Estimated from automatic placement">
                  Estimated match {template.quality.score}%
                </span>}
                <label className="preview-region-toggle">
                  <input type="checkbox" checked={showRegions} onChange={(event) => setShowRegions(event.target.checked)} />
                  Show regions
                </label>
              </div>
              {showRegions && !imported && <p className="region-quality">Amber marks a region to check. Point to it or use Tab to read its estimate.</p>}
            </div>
            {display.image && <Mannequins image={display.image} mode={template.mode} />}
          </section>
          {display.ready && displayPixels && (
            <CatalogChecklist png={png} pixels={displayPixels} template={template} sleeves={tools.fixes.sleeves} colors={displayColors} />
          )}
          <GraphicsReview png={png} mode={template.mode} ready={settled} useArtwork={tools.replaceArtwork} />
        </div>
        <div className="result-actions">
          <FixPanel tools={tools} palette={baseColors} ready={settled} canPlace={!imported}
            download={() => downloadResult(png, `threadport-${template.mode}.png`)} />
          <button className="secondary-button edit-in-studio" type="button" disabled={!settled || openingStudio}
            onClick={() => { void editInStudio() }}>{openingStudio ? 'Opening Studio…' : 'Edit in Studio'}</button>
          {studioError && <p className="result-note" role="alert">{studioError}</p>}
          <ResultExtras png={png} mode={template.mode} original={original} imported={imported} ready={settled}
            fabricColor={displayColors[0]} useArtwork={tools.replaceArtwork} openStudio={openStudio} />
          {!imported && template.mode !== 't-shirt' && (
            <p className="result-note">
              {tools.fixes.plain_back || tools.fixes.back_version
                ? 'The torso back uses fabric from the sides.'
                : template.has_back
                  ? 'The torso back uses your back photo.'
                  : 'We guessed the torso back from your front photo.'}
            </p>
          )}
          {tools.alternate && (
            <button className="text-button" type="button" onClick={tools.toggleAlternate}>
              {tools.useAlternate ? 'Show recommended version' : 'Try another version'}
            </button>
          )}
          <button className="text-button" type="button" onClick={() => onBack(png)}>{backLabel}</button>
        </div>
      </div>
    </div>
  )
}
