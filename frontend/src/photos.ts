import type { TemplateKind } from './template'

export type Mode = 'auto' | TemplateKind

export type PhotoSelection = {
  front: File | null
  back: File | null
  angles: File[]
}

export type PhotoRole = keyof PhotoSelection

export type Cutout = {
  role: PhotoRole
  png: string
  garment_type: string
  photo_type: string
  mode: TemplateKind
}

export type Progress = {
  step: 'finding' | 'removing' | 'cutting' | 'placing' | 'filling' | 'shading' | 'checking'
  percent: number
}

type TemplateQuality = {
  score: number
  regions: Record<string, { score: number; note?: string }>
}

type TemplateVariant = {
  png: string
  quality: TemplateQuality
}

export type PlacedTemplate = TemplateVariant & {
  alternate?: TemplateVariant
  mode: TemplateKind
  profile: 't_shirt' | 'long_sleeve' | 'sleeveless' | 'hoodie' | 'pants' | 'shorts' | 'skirt'
  has_back: boolean
}

export type ProcessResult = { photos: Cutout[]; template: PlacedTemplate }

type ProcessingEvent =
  | ({ type: 'progress' } & Progress)
  | ({ type: 'photo' } & Cutout)
  | { type: 'error'; message: string }
  | { type: 'result'; percent: 100; template: PlacedTemplate }

const unavailable = 'We couldn’t reach the photo service. Make sure it’s running and try again.'

export async function processPhotos(
  { front, back, angles }: PhotoSelection,
  mode: Mode,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
  shading = 1,
): Promise<ProcessResult> {
  if (!front) throw new Error('Add the main photo first.')
  const body = new FormData()
  body.set('front', front)
  if (back) body.set('back', back)
  for (const angle of angles) body.append('angles', angle)
  body.set('mode', mode)
  body.set('shading', String(shading))

  let response: Response
  try {
    response = await fetch('/api/process', { method: 'POST', body, signal })
  } catch {
    throw new Error(unavailable)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(typeof data?.detail === 'string' ? data.detail : unavailable)
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    throw new Error(unavailable)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const photos: Cutout[] = []
  const pending: string[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = value.split('\n')
      if (lines.length === 1) {
        pending.push(value)
        continue
      }
      pending.push(lines[0])
      lines[0] = pending.join('')
      pending.length = 0
      pending.push(lines.pop()!)
      for (const line of lines) {
        const message = JSON.parse(line) as ProcessingEvent
        if (message.type === 'error') throw new Error(message.message)
        if (message.type === 'progress') onProgress(message)
        if (message.type === 'photo') photos.push(message)
        if (message.type === 'result' && message.template && photos.length === 1 + Number(Boolean(back)) + angles.length) {
          return { photos, template: message.template }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  throw new Error('Photo preparation ended early. Try again.')
}
