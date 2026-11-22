import { Check, Circle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PhotoUpload, usePhotoUrl } from './PhotoUpload'
import { processPhotos } from './photos'
import type { Mode, PhotoSelection, ProcessResult, Progress } from './photos'
import type { Project } from './studio/model'
import { BatchMode, useBatch } from './extras/BatchMode'
import type { ReadyEntry } from './extras/BatchMode'
import { TemplateUpload } from './extras/TemplateUpload'
import { StarterUpload } from './extras/StarterUpload'

const TemplateResult = lazy(() => import('./TemplateResult'))
const noAngles: File[] = []

const checklist = [
  'Finding the clothing…',
  'Removing background…',
  'Cutting out sleeves / legs…',
  'Placing pieces on the template…',
  'Filling the back and sides…',
  'Adding shading…',
  'Checking quality…',
]
const stepIndex = { finding: 0, removing: 1, cutting: 2, placing: 3, filling: 4, shading: 5, checking: 6 }

function Processing({ front, progress, onCancel }: {
  front: File
  progress: Progress
  onCancel: () => void
}) {
  const original = usePhotoUrl(front)
  const heading = useRef<HTMLHeadingElement>(null)
  const reduceMotion = useReducedMotion()
  const activeIndex = stepIndex[progress.step]

  useEffect(() => { heading.current?.focus() }, [])

  return (
    <div className="process-page">
      <div className="page-heading">
        <h1 tabIndex={-1} ref={heading}>Preparing your template</h1>
      </div>
      <div className="process-grid">
        <section className="panel process-preview" aria-labelledby="photo-preview-title">
          <div className="panel-header"><h2 id="photo-preview-title">Original photo</h2></div>
          <div className="process-image">
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
          </div>
        </section>
        <section className="panel process-details" aria-labelledby="progress-title">
          <h2 id="progress-title">Processing progress</h2>
          <ol className="process-checklist">
            {checklist.map((label, index) => {
              const done = index < activeIndex
              const active = index === activeIndex
              return (
                <li key={label} className={active ? 'active-step' : undefined} aria-current={active ? 'step' : undefined}>
                  {done ? <Check size={17} aria-label="Complete" /> : <Circle size={13} aria-hidden="true" />}
                  {label}
                </li>
              )
            })}
          </ol>
          <div className="progress-row">
            <progress aria-label="Template preparation progress" value={progress.percent} max={100} />
            <span>{progress.percent}%</span>
          </div>
          <button className="text-button" type="button" onClick={onCancel}>Cancel</button>
        </section>
      </div>
    </div>
  )
}

export type AutoBashStep = 'Upload' | 'Processing' | 'Result'

export function AutoBash({ onStepChange, openStudio }: { onStepChange: (step: AutoBashStep) => void; openStudio: (project: Project) => void }) {
  const [photos, setPhotos] = useState<PhotoSelection>({ front: null, back: null, angles: [] })
  const [mode, setMode] = useState<Mode>('auto')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const job = useRef<AbortController | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [review, setReview] = useState<ReadyEntry>()
  const [imported, setImported] = useState<{ file: File; result: ProcessResult }>()
  const batch = useBatch()

  useEffect(() => () => job.current?.abort(), [])

  function returnToUpload() {
    job.current?.abort()
    job.current = null
    setProgress(null)
    setResult(null)
    onStepChange('Upload')
  }

  async function submit() {
    if (!photos.front || job.current) return
    const controller = new AbortController()
    job.current = controller
    setError('')
    setProgress({ step: 'finding', percent: 0 })
    onStepChange('Processing')
    try {
      const output = await processPhotos(photos, mode, controller.signal, (update) => {
        if (!controller.signal.aborted) setProgress(update)
      })
      if (!controller.signal.aborted) {
        setResult(output)
        onStepChange('Result')
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof SyntaxError || !(failure instanceof Error)
          ? 'We couldn’t prepare this photo. Try again.'
          : failure.message)
        returnToUpload()
      }
    } finally {
      if (job.current === controller) job.current = null
    }
  }

  if (review || imported) {
    const current = (review ?? imported)!
    return (
      <Suspense fallback={<p role="status">Opening template preview…</p>}>
        <TemplateResult original={current.file} selection={{ front: current.file, back: null, angles: noAngles }}
          mode={review?.mode ?? current.result.template.mode} result={current.result} imported={!!imported}
          backLabel={review ? 'Back to batch' : 'Back to upload'} openStudio={openStudio}
          onBack={(png) => {
            if (review) batch.saveReview(review.id, png)
            setReview(undefined)
            setImported(undefined)
            onStepChange('Upload')
          }} />
      </Suspense>
    )
  }

  if (result && photos.front) {
    return (
      <Suspense fallback={<p role="status">Opening template preview…</p>}>
        <TemplateResult original={photos.front} selection={photos} mode={mode} result={result} onBack={returnToUpload} openStudio={openStudio} />
      </Suspense>
    )
  }
  if (progress && photos.front) {
    return <Processing front={photos.front} progress={progress} onCancel={returnToUpload} />
  }

  return (
    <div className="upload-page">
      <div className="page-heading upload-heading">
        <h1>Auto Bash</h1>
        <button className="secondary-button" type="button" aria-pressed={batchMode}
          onClick={() => setBatchMode(!batchMode)}>{batchMode ? 'Single photo' : 'Batch mode'}</button>
      </div>
      {batchMode ? <BatchMode batch={batch} review={(entry) => { setReview(entry); onStepChange('Result') }} /> : <>
        <PhotoUpload
          photos={photos}
          onPhotosChange={setPhotos}
          mode={mode}
          onModeChange={setMode}
          onSubmit={submit}
          error={error}
          onError={setError}
        />
        <TemplateUpload ready={(file, preview) => { setImported({ file, result: preview }); onStepChange('Result') }} />
        <StarterUpload openStudio={openStudio} />
      </>}
    </div>
  )
}
