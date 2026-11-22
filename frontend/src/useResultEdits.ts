import { useEffect, useState } from 'react'
import { processPhotos } from './photos'
import type { Mode, PhotoSelection, ProcessResult } from './photos'

export type Fixes = {
  sharpness: number
  brightness: number
  saturation: number
  color: { source: string; target: string } | null
  remove_logo: boolean
  plain_back: boolean
  back_version: number
  sleeves: 'auto' | 'short' | 'long' | 'none'
  style: 'realistic' | 'clean' | 'cartoon' | 'vintage' | 'grunge'
}

const defaults: Fixes = {
  sharpness: 0, brightness: 0, saturation: 0, color: null, remove_logo: false,
  plain_back: false, back_version: 0, sleeves: 'auto', style: 'realistic',
}

export function useResultEdits(initial: ProcessResult, selection: PhotoSelection, mode: Mode) {
  const [placement, setPlacement] = useState({ result: initial, strength: 100, version: 0 })
  const [shading, setShading] = useState(100)
  const [placementRun, setPlacementRun] = useState(0)
  const [useAlternate, setAlternate] = useState(false)
  const [fixes, setFixes] = useState(defaults)
  const [edited, setEdited] = useState<{ base: string; settings: string; png: string }>()
  const [renderError, setRenderError] = useState('')
  const [editError, setEditError] = useState('')
  const [editRetry, setEditRetry] = useState(0)
  const { front, back, angles } = selection
  const { result } = placement
  const alternate = result.template.alternate
  const template = useAlternate && alternate ? { ...result.template, ...alternate } : result.template
  const base = template.png
  const kind = template.mode
  const settings = JSON.stringify(fixes)
  const isEdited = settings !== JSON.stringify(defaults)
  const placing = placementRun !== placement.version || shading !== placement.strength
  const editing = isEdited && (edited?.base !== base || edited.settings !== settings)

  useEffect(() => {
    if (!placing) return
    const rerun = placementRun !== placement.version
    if (!rerun && placementRun === 0 && shading === 100) {
      setPlacement({ result: initial, strength: 100, version: 0 })
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const next = await processPhotos({ front, back, angles: rerun ? angles : [] },
          rerun ? mode : kind, controller.signal, () => {}, shading / 100)
        if (!controller.signal.aborted) {
          setPlacement((previous) => ({
            result: rerun ? next : { ...previous.result, template: next.template },
            strength: shading,
            version: placementRun,
          }))
          if (rerun) setAlternate(false)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setRenderError(error instanceof Error ? error.message : 'Couldn’t rerender the template. Try again.')
        }
      }
    }, rerun ? 0 : 450)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [front, back, angles, mode, kind, initial, placing, shading, placementRun, placement.version])

  useEffect(() => {
    if (!editing || placing) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/quick-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ png: base, mode: kind, fixes: JSON.parse(settings) }),
        })
        const value = await response.json()
        if (!response.ok || typeof value.png !== 'string') {
          throw new Error(typeof value.detail === 'string' ? value.detail : 'Couldn’t apply Quick-Fix. Try again.')
        }
        if (!controller.signal.aborted) setEdited({ base, settings, png: value.png })
      } catch (error) {
        if (!controller.signal.aborted) {
          setEditError(error instanceof Error ? error.message : 'Couldn’t apply Quick-Fix. Try again.')
        }
      }
    }, 150)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [base, kind, editing, placing, settings, editRetry])

  function update<K extends keyof Fixes>(key: K, value: Fixes[K]) {
    setEditError('')
    setFixes((previous) => ({ ...previous, [key]: value }))
  }

  return {
    photos: result.photos, template, fixes, update, shading,
    setShading: (strength: number) => { setRenderError(''); setEditError(''); setShading(strength) },
    rerun: () => { setRenderError(''); setEditError(''); setPlacementRun((version) => version + 1) },
    retry: () => { setEditError(''); setEditRetry((count) => count + 1) },
    reset: () => {
      setEditError('')
      setRenderError('')
      setPlacementRun(placement.version)
      setFixes(defaults)
      setShading(100)
    },
    regenerate: () => {
      setEditError('')
      setFixes((previous) => ({ ...previous, plain_back: false, back_version: (previous.back_version % 12) + 1 }))
    },
    alternate, useAlternate,
    toggleAlternate: () => { setEditError(''); setAlternate(!useAlternate) },
    png: isEdited && edited?.base === base ? edited.png : base,
    placing, editing, renderError, editError,
  }
}
