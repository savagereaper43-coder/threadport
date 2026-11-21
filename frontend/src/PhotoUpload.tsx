import { ArrowRight, Focus, ImagePlus, Layers2, Square, Sun, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import samplePhoto from '../../samples/black shirt test.JPG?url'
import type { Mode, PhotoRole, PhotoSelection } from './photos'

const accepted = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
const maxBytes = 10 * 1024 * 1024
const choices: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'shirt', label: 'Shirt' },
  { value: 'pants', label: 'Pants' },
  { value: 't-shirt', label: 'T-Shirt' },
]

export function usePhotoUrl(file: File | null) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file) {
      setUrl('')
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])
  return url
}

function PhotoExamples() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button className="examples-link" type="button" onClick={() => dialog.current?.showModal()}>
        See good vs bad photos
      </button>
      <dialog ref={dialog} className="panel examples-dialog" aria-labelledby="examples-title">
        <div className="dialog-heading">
          <h2 id="examples-title">Good vs bad photos</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close examples"
            onClick={() => dialog.current?.close()}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <div className="example-grid">
          <figure>
            <div className="example-image"><img src={samplePhoto} alt="A full shirt laid flat in even light" /></div>
            <figcaption><strong>Good</strong> The whole shirt is in frame.</figcaption>
          </figure>
          <figure>
            <div className="example-image cropped"><img src={samplePhoto} alt="A cropped photo with the sleeves and hem cut off" /></div>
            <figcaption><strong>Bad</strong> The sleeves and hem are cut off.</figcaption>
          </figure>
        </div>
      </dialog>
    </>
  )
}

type Props = {
  photos: PhotoSelection
  onPhotosChange: (photos: PhotoSelection) => void
  mode: Mode
  onModeChange: (mode: Mode) => void
  onSubmit: () => void
  error: string
  onError: (error: string) => void
}

export function PhotoUpload({ photos, onPhotosChange, mode, onModeChange, onSubmit, error, onError }: Props) {
  const [dragging, setDragging] = useState(false)
  const frontInput = useRef<HTMLInputElement>(null)
  const frontUrl = usePhotoUrl(photos.front)

  const addFiles = useCallback((role: PhotoRole, files: File[]) => {
    if (!files.length) return
    if (role === 'angles' && photos.angles.length + files.length > 3) {
      onError('Add up to three extra angles. Remove a photo to make room.')
      return
    }
    const selected = role === 'angles' ? files : files.slice(0, 1)
    for (const file of selected) {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && (file.type || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
        onError('Choose a JPG, PNG, or WebP photo.')
        return
      }
      if (file.size > maxBytes) {
        onError('Choose photos that are 10 MB or smaller.')
        return
      }
    }
    onError('')
    if (role === 'angles') onPhotosChange({ ...photos, angles: [...photos.angles, ...selected] })
    else onPhotosChange({ ...photos, [role]: selected[0] })
  }, [photos, onPhotosChange, onError])

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]')) return
      const clipboard = event.clipboardData
      if (!clipboard) return
      const files = Array.from(clipboard.files)
      if (!files.length) {
        for (const item of clipboard.items) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (!files.length) return
      event.preventDefault()
      addFiles('front', files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  function choose(role: PhotoRole, event: ChangeEvent<HTMLInputElement>) {
    addFiles(role, Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ''
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    addFiles('front', Array.from(event.dataTransfer.files))
  }

  function remove(role: PhotoRole, index = 0) {
    onError('')
    if (role === 'angles') onPhotosChange({ ...photos, angles: photos.angles.filter((_, i) => i !== index) })
    else onPhotosChange({ ...photos, [role]: null })
  }

  return (
    <form className="upload-form" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <section
        className="drop-zone"
        aria-labelledby="drop-zone-title"
        data-dragging={dragging}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDragging(false)
          }
        }}
        onDrop={drop}
      >
        {frontUrl ? (
          <img className="upload-preview" src={frontUrl} alt="Main clothing photo" />
        ) : (
          <div className="upload-icon"><Upload size={26} strokeWidth={1.65} aria-hidden="true" /></div>
        )}
        <div>
          <h2 id="drop-zone-title">Drop a photo of any clothing</h2>
          <p>Shirts, hoodies, jackets, pants, shorts — we do the rest</p>
        </div>
        <div className="browse-actions">
          <input ref={frontInput} type="file" hidden accept={accepted} onChange={(event) => choose('front', event)} />
          <button className="secondary-button" type="button" onClick={() => frontInput.current?.click()}>
            {photos.front ? 'Replace photo' : 'Browse files'}
          </button>
          {photos.front && (
            <button className="icon-button" type="button" aria-label="Remove main photo" onClick={() => remove('front')}>
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="upload-hint">{photos.front?.name ?? 'You can also paste a photo from your clipboard.'}</p>
      </section>

      <div className="photo-slots">
        {([
          { role: 'back', title: 'Add back photo (optional)', Icon: ImagePlus, files: photos.back ? [photos.back] : [] },
          { role: 'angles', title: 'Add more angles (optional)', Icon: Layers2, files: photos.angles },
        ] as const).map(({ role, title, Icon, files }) => (
          <div className="panel photo-slot" key={role}>
            <label className="slot-picker">
              <Icon size={19} aria-hidden="true" />
              <span>{title}</span>
              <input
                className="visually-hidden"
                type="file"
                accept={accepted}
                multiple={role === 'angles'}
                onChange={(event) => choose(role, event)}
              />
            </label>
            {files.length > 0 && (
              <ul className="selected-files">
                {files.map((file, index) => (
                  <li key={index}>
                    <span>{file.name}</span>
                    <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => remove(role, index)}>
                      <X size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="photo-tips">
        <ul aria-label="Photo tips">
          <li><Square size={16} aria-hidden="true" />Lay it flat</li>
          <li><Sun size={16} aria-hidden="true" />Good lighting</li>
          <li><Focus size={16} aria-hidden="true" />Whole item in frame</li>
        </ul>
        <PhotoExamples />
      </div>

      <div className="upload-footer">
        <fieldset>
          <legend>Clothing type</legend>
          <div className="type-options">
            {choices.map(({ value, label }) => (
              <label className="type-option" key={value}>
                <input type="radio" name="mode" checked={mode === value} onChange={() => onModeChange(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="primary-button" type="submit" disabled={!photos.front}>
          Make my Roblox clothing <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
      {error && <p className="photo-error" role="alert">{error}</p>}
    </form>
  )
}
