import classicRegions from '../../shared/templateLayout.json'

export type TemplateKind = 'shirt' | 'pants' | 't-shirt'

export const templates = {
  shirt: { label: 'Shirt', width: 585, height: 559, regions: classicRegions },
  pants: { label: 'Pants', width: 585, height: 559, regions: classicRegions },
  't-shirt': {
    label: 'T-Shirt',
    width: 512,
    height: 512,
    regions: [{ part: 'torso', face: 'front', x: 0, y: 0, w: 512, h: 512 }],
  },
} as const

export function regionLabel(kind: TemplateKind, part: string, face: string) {
  const limb = kind === 'pants' ? 'leg' : 'arm'
  const names: Record<string, string> = {
    torso: kind === 'pants' ? 'Waist' : 'Torso',
    leftLimb: `Left ${limb}`,
    rightLimb: `Right ${limb}`,
  }
  return `${names[part]} ${face}`
}

// A PNG sRGB chunk with perceptual rendering intent (0) and its CRC.
const srgbChunk = new Uint8Array([0, 0, 0, 1, 115, 82, 71, 66, 0, 0xae, 0xce, 0x1c, 0xe9])

async function tagSrgb(png: Blob) {
  const bytes = new Uint8Array(await png.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const afterHeader = 33 // Eight-byte signature and 25-byte IHDR chunk.

  for (let offset = afterHeader; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'sRGB' || type === 'iCCP' || type === 'cICP') return png
    if (type === 'IDAT') break
    offset += length + 12
  }

  return new Blob(
    [bytes.subarray(0, afterHeader), srgbChunk, bytes.subarray(afterHeader)],
    { type: 'image/png' },
  )
}

export async function exportTemplatePng(kind: TemplateKind, pixels?: ImageData): Promise<Blob> {
  const { width, height, regions } = templates[kind]
  if (pixels && (pixels.width !== width || pixels.height !== height)) {
    throw new Error(`Use artwork that is exactly ${width} × ${height} pixels.`)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
  if (!context) throw new Error('The PNG could not be created.')

  if (pixels) {
    for (const { x, y, w, h } of regions) {
      context.putImageData(pixels, 0, 0, x, y, w, h)
    }
  }

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The PNG could not be created.'))
    }, 'image/png')
  })
  return tagSrgb(png)
}
