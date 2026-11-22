import type { TemplateKind } from '../template'

export type Point = { x: number; y: number }
export type Box = Point & { w: number; h: number }
export type Face = Box & { part: string; face: string }
export type Settings = {
  brightness: number; contrast: number; hue: number; saturation: number
  black: number; white: number; gamma: number
  red: number; green: number; blue: number; tint: string; tintAmount: number
}
export const neutral: Settings = {
  brightness: 0, contrast: 0, hue: 0, saturation: 0, black: 0, white: 255, gamma: 1,
  red: 0, green: 0, blue: 0, tint: '#ffffff', tintAmount: 0,
}
export const mesh = [
  { x: 0, y: 0 }, { x: .5, y: 0 }, { x: 1, y: 0 },
  { x: 0, y: .5 }, { x: .5, y: .5 }, { x: 1, y: .5 },
  { x: 0, y: 1 }, { x: .5, y: 1 }, { x: 1, y: 1 },
]
export type Layer = Box & {
  id: string; name: string; src: string; opacity: number; blend: GlobalCompositeOperation
  hidden?: boolean; locked?: boolean; group?: string; mask?: string; clip?: Box
  angle?: number; flip?: boolean; warp?: Record<number, Point>; settings?: Settings
}
export type Piece = { id: string; name: string; src: string; photo?: string }
export type Photo = Piece & { cutout?: string }
export type Artwork = { kind: TemplateKind; layers: Layer[]; pieces: Piece[]; photos: Photo[]; groups: { id: string; name: string }[] }
export type Project = Artwork & {
  id: string; name: string; folder: string; updated: number; thumbnail?: string
  profile?: 't_shirt' | 'long_sleeve' | 'hoodie' | 'pants' | 'shorts'
  snapshots: { name: string; artwork: Artwork }[]
}
export type Selection = { box: Box; points?: Point[]; mask?: Uint8ClampedArray }

export const id = () => crypto.randomUUID()
export function newProject(kind: TemplateKind = 'shirt', name = 'Untitled project'): Project {
  return { id: id(), name, kind, folder: '', updated: Date.now(), layers: [], pieces: [], photos: [], groups: [], snapshots: [] }
}

export function newLayer(name: string, src: string, box: Box): Layer {
  return { id: id(), name, src, ...box, opacity: 1, blend: 'source-over' }
}

export function artwork({ kind, layers, pieces, photos, groups }: Project): Artwork {
  return { kind, layers, pieces, photos, groups }
}

export const faceKey = (face: Face) => `${face.part}.${face.face}`

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('threadport-studio', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('projects', mode)
    const request = action(tx.objectStore('projects'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(tx.error ?? request.error)
  })
}

export const loadProjects = () => transaction('readonly', (store) => store.getAll() as IDBRequest<Project[]>)
export const saveProject = (project: Project) => transaction('readwrite', (store) => store.put(project))
export const deleteProject = (key: string) => transaction('readwrite', (store) => store.delete(key))
