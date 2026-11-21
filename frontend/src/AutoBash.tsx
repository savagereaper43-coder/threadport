import { Check, Circle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { PhotoUpload, usePhotoUrl } from './PhotoUpload'
import { processPhotos } from './photos'
import type { Cutout, Mode, PhotoSelection, Progress } from './photos'
import { templates } from './template'

const checklist = [
  'Finding the clothing…',
  'Removing background…',
  'Cutting out sleeves / legs…',
  'Placing pieces on the template…',
  'Filling the back and sides…',
  'Adding shading…',
  'Checking quality…',
]
const photoTypes: Record<string, string> = {
  flat_lay: 'Laid flat',
  hanger_product: 'Hanger or product photo',
  ghost_mannequin: 'Invisible mannequin',
  worn: 'Worn by a person',
  folded: 'Folded',
}
const garmentTypes: Record<string, string> = {
  pants: 'Pants',
  shorts: 'Shorts',
  t_shirt: 'T-shirt',
  long_sleeve: 'Long-sleeve top',
  top: 'Top',
}

function Processing({ front, progress, cutouts, onClose }: {
  front: File
  progress: Progress
  cutouts: Cutout[] | null
  onClose: () => void
}) {
  const original = usePhotoUrl(front)
  const heading = useRef<HTMLHeadingElement>(null)
  const reduceMotion = useReducedMotion()
  const [photoIndex, setPhotoIndex] = useState(0)
  const cutout = cutouts?.[photoIndex]
  const firstAngle = cutouts?.findIndex(({ role }) => role === 'angles') ?? 0
  const percent = cutouts ? 100 : progress.percent
  const completed = cutouts ? 2 : Number(progress.step === 'removing')

  useEffect(() => { heading.current?.focus() }, [cutouts])

  return (
    <div className="process-page">
      <div className="page-heading">
        <h1 tabIndex={-1} ref={heading}>{cutouts ? 'Photos prepared' : 'Preparing your photos'}</h1>
        {cutouts && <p>Your photos are ready for the next step, placing the clothing on the template.</p>}
      </div>
      <div className="process-grid">
        <section className="panel process-preview" aria-labelledby="photo-preview-title">
          <div className="panel-header">
            <h2 id="photo-preview-title">{cutout ? 'Clothing cutout' : 'Original photo'}</h2>
            {cutouts && cutouts.length > 1 && (
              <select
                aria-label="Preview photo"
                value={photoIndex}
                onChange={(event) => setPhotoIndex(Number(event.target.value))}
              >
                {cutouts.map(({ role }, index) => (
                  <option key={index} value={index}>
                    {role === 'front' ? 'Main photo' : role === 'back' ? 'Back photo' : `Angle ${index + 1 - firstAngle}`}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className={cutout ? 'process-image cutout-image' : 'process-image'}>
            {cutout ? (
              <img src={`data:image/png;base64,${cutout.png}`} alt="Clothing with the background removed" />
            ) : (
              <>
                {original && <img src={original} alt="Original clothing photo" />}
                {!reduceMotion && (
                  <motion.span
                    className="scan-line"
                    aria-hidden="true"
                    initial={{ top: '4%' }}
                    animate={{ top: ['4%', '96%', '4%'] }}
                    transition={{ duration: 2.8, ease: 'easeInOut', repeat: Infinity }}
                  />
                )}
              </>
            )}
          </div>
        </section>
        <section className="panel process-details" aria-labelledby="progress-title">
          <h2 id="progress-title">Processing progress</h2>
          <ol className="process-checklist">
            {checklist.map((label, index) => {
              const done = index < completed
              const active = !cutouts && index === completed
              return (
                <li key={label} className={active ? 'active-step' : undefined} aria-current={active ? 'step' : undefined}>
                  {done ? <Check size={17} aria-label="Complete" /> : <Circle size={13} aria-hidden="true" />}
                  {label}
                </li>
              )
            })}
          </ol>
          <div className="progress-row">
            <progress aria-label="Photo preparation progress" value={percent} max={100} />
            <span>{percent}%</span>
          </div>
          {cutout && (
            <dl className="photo-details">
              <div><dt>Clothing guess</dt><dd>{garmentTypes[cutout.garment_type]}</dd></div>
              <div><dt>Photo type guess</dt><dd>{photoTypes[cutout.photo_type]}</dd></div>
              <div><dt>Template type</dt><dd>{templates[cutout.mode].label}</dd></div>
            </dl>
          )}
          <button className="text-button" type="button" onClick={onClose}>
            {cutouts ? 'Back to upload' : 'Cancel'}
          </button>
        </section>
      </div>
    </div>
  )
}

export function AutoBash({ onProcessingChange }: { onProcessingChange: (processing: boolean) => void }) {
  const [photos, setPhotos] = useState<PhotoSelection>({ front: null, back: null, angles: [] })
  const [mode, setMode] = useState<Mode>('auto')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [cutouts, setCutouts] = useState<Cutout[] | null>(null)
  const job = useRef<AbortController | null>(null)

  useEffect(() => () => job.current?.abort(), [])

  function closeProcessing() {
    job.current?.abort()
    job.current = null
    setProgress(null)
    setCutouts(null)
    onProcessingChange(false)
  }

  async function submit() {
    if (!photos.front || job.current) return
    const controller = new AbortController()
    job.current = controller
    setError('')
    setProgress({ step: 'finding', percent: 0 })
    onProcessingChange(true)
    try {
      const output = await processPhotos(photos, mode, controller.signal, (update) => {
        if (!controller.signal.aborted) setProgress(update)
      })
      if (!controller.signal.aborted) setCutouts(output)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof SyntaxError || !(failure instanceof Error)
          ? 'We couldn’t prepare this photo. Try again.'
          : failure.message)
        closeProcessing()
      }
    } finally {
      if (job.current === controller) job.current = null
    }
  }

  if (progress && photos.front) {
    return <Processing front={photos.front} progress={progress} cutouts={cutouts} onClose={closeProcessing} />
  }

  return (
    <div className="upload-page">
      <div className="page-heading"><h1>Auto Bash</h1></div>
      <PhotoUpload
        photos={photos}
        onPhotosChange={setPhotos}
        mode={mode}
        onModeChange={setMode}
        onSubmit={submit}
        error={error}
        onError={setError}
      />
    </div>
  )
}
