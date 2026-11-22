import { useEffect, useRef, useState } from 'react'
import { processPhotos } from '../photos'
import type { Mode, ProcessResult } from '../photos'
import { downloadResult } from '../resultImage'
import { templates } from '../template'
import { archiveName, downloadSet } from './artwork'

type Entry = { id: string; file: File; mode: Mode }
  & ({ state: 'queued' } | { state: 'working'; progress: number } | { state: 'ready'; result: ProcessResult }
    | { state: 'failed'; error: string })
export type ReadyEntry = Extract<Entry, { state: 'ready' }>

export function useBatch() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [running, setRunning] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  function update(id: string, next: (item: Entry) => Entry) {
    setEntries((items) => items.map((item) => item.id === id ? next(item) : item))
  }

  function add(files: FileList) {
    const added = Array.from(files, (file): Entry => ({ id: crypto.randomUUID(), file, mode: 'auto', state: 'queued' }))
    setEntries((items) => [...items, ...added])
  }

  async function run(ids?: string[]) {
    if (request.current) return
    const queue = entries.filter((item) => ids ? ids.includes(item.id) && item.state === 'failed' : item.state === 'queued')
    if (!queue.length) return
    const controller = new AbortController()
    request.current = controller
    setRunning(true)
    for (const entry of queue) {
      if (controller.signal.aborted) break
      update(entry.id, () => ({ ...entry, state: 'working', progress: 0 }))
      try {
        const result = await processPhotos({ front: entry.file, back: null, angles: [] }, entry.mode, controller.signal, ({ percent }) => {
          if (!controller.signal.aborted) update(entry.id, () => ({ ...entry, state: 'working', progress: percent }))
        })
        update(entry.id, () => controller.signal.aborted ? { ...entry, state: 'queued' } : { ...entry, state: 'ready', result })
      } catch (error) {
        update(entry.id, () => controller.signal.aborted ? { ...entry, state: 'queued' } : {
          ...entry, state: 'failed', error: error instanceof Error ? error.message : 'We couldn’t process this photo.',
        })
      }
    }
    if (request.current === controller) request.current = null
    setRunning(false)
  }

  function saveReview(entryId: string, png: string) {
    update(entryId, (entry) => {
      if (entry.state !== 'ready' || entry.result.template.png === png) return entry
      return { ...entry, result: { ...entry.result, template: { ...entry.result.template, png, alternate: undefined } } }
    })
  }

  return { entries, running, add, run, saveReview, stop: () => request.current?.abort(),
    remove: (id: string) => setEntries((items) => items.filter((item) => item.id !== id)),
    chooseMode: (id: string, mode: Mode) => update(id, (item) => ({ id: item.id, file: item.file, mode, state: 'queued' })),
  }
}

export function BatchMode({ batch, review }: { batch: ReturnType<typeof useBatch>; review: (entry: ReadyEntry) => void }) {
  const { entries, running, run, add, stop, chooseMode, remove } = batch
  const input = useRef<HTMLInputElement>(null)
  const [archiveError, setArchiveError] = useState('')
  const ready = entries.filter((entry) => entry.state === 'ready')
  const enabled = entries.some((entry) => entry.state === 'queued')
  const archive = () => {
    setArchiveError('')
    try {
      downloadSet(ready.map((entry) => ({
        name: `${archiveName(entry.file.name)}-${entry.result.template.mode}`,
        png: entry.result.template.png,
      })), 'threadport-batch.zip')
    } catch { setArchiveError('We couldn’t create the ZIP. Download the finished items individually.') }
  }
  return <section className="panel batch-panel" aria-labelledby="batch-title">
    <div className="panel-header"><h2 id="batch-title">Batch review queue</h2></div>
    <div className="batch-inner">
      <p>Add one main photo for each garment. Set the clothing type for each photo or leave it on Auto.</p>
      <div className="extra-toolbar">
        <button type="button" className="secondary-button" disabled={running} onClick={() => input.current?.click()}>Add batch photos</button>
        <input ref={input} aria-label="Batch photos" type="file" multiple hidden accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          onChange={(event) => { if (event.target.files) add(event.target.files); event.target.value = '' }} />
        {running
          ? <button type="button" className="secondary-button" onClick={stop}>Pause batch</button>
          : <button type="button" className="primary-button" disabled={!enabled} onClick={() => { void run() }}>Process batch</button>}
        <button type="button" className="secondary-button" disabled={!ready.length} onClick={archive}>Download batch ZIP</button>
      </div>
      {archiveError && <p className="extra-error" role="alert">{archiveError}</p>}
      {entries.length > 0 && <p role="status">{ready.length} of {entries.length} ready for review</p>}
      <ol className="batch-items">
        {entries.map((entry) => <li key={entry.id} className="batch-item">
          {entry.state === 'ready' && <img className="batch-thumb" src={`data:image/png;base64,${entry.result.template.png}`} alt="" />}
          <div className="batch-name">
            <strong>{entry.file.name}</strong>
            {entry.state === 'working' ? <progress aria-label={`Progress for ${entry.file.name}`} value={entry.progress} max={100} />
              : entry.state === 'failed' ? <span className="extra-error">{entry.error}</span>
                : <span>{entry.state === 'queued' ? 'Queued' : `Ready · ${templates[entry.result.template.mode].label}`}</span>}
          </div>
          <label className="batch-mode-label">Type <select aria-label={`Clothing type for ${entry.file.name}`}
            disabled={running || entry.state === 'ready'} value={entry.mode} onChange={(event) => chooseMode(entry.id, event.target.value as Mode)}>
            <option value="auto">Auto</option>
            {Object.entries(templates).map(([key, kind]) => <option key={key} value={key}>{kind.label}</option>)}
          </select></label>
          {entry.state === 'ready' && <>
            <button type="button" className="secondary-button" onClick={() => review(entry)}>Review result</button>
            <button type="button" className="secondary-button" onClick={() =>
              downloadResult(entry.result.template.png, `${archiveName(entry.file.name)}-${entry.result.template.mode}.png`)}>PNG</button>
          </>}
          {entry.state === 'failed' && <button type="button" className="secondary-button" disabled={running}
            onClick={() => { void run([entry.id]) }}>Retry</button>}
          <button type="button" className="text-button" aria-label={`Remove ${entry.file.name}`} disabled={running}
            onClick={() => remove(entry.id)}>Remove</button>
        </li>)}
      </ol>
    </div>
  </section>
}
