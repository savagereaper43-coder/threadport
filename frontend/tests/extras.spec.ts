import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const shirtPhoto = fileURLToPath(new URL('../../samples/black shirt test.JPG', import.meta.url))
const pantsPhoto = fileURLToPath(new URL('../../samples/blue pants test.JPG', import.meta.url))
const shirtTemplate = fileURLToPath(new URL('../../samples/out/black-shirt-test.png', import.meta.url))

async function importShirt(page: Page) {
  await page.goto('/#auto-bash')
  await page.getByText('Restyle an existing Roblox template', { exact: true }).click()
  await page.getByLabel('Choose template to restyle').setInputFiles(shirtTemplate)
  await expect(page.getByRole('img', { name: 'Generated Shirt template' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeEnabled()
}

async function captureDownload(page: Page, click: () => Promise<unknown>) {
  const pending = page.waitForEvent('download')
  await click()
  const file = await pending
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }
}

function dimensions(bytes: Uint8Array) {
  const png = Buffer.from(bytes)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

test('restyles an existing template and downloads colorways, a matching garment and a before/after image', async ({ page }) => {
  await importShirt(page)
  await expect(page.getByRole('img', { name: 'Original Roblox template' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Re-run auto placement' })).toHaveCount(0)
  const pngButton = page.getByRole('button', { name: 'Download PNG', exact: true })
  const original = await captureDownload(page, () => pngButton.click())
  await page.getByRole('combobox', { name: 'Style' }).selectOption('vintage')
  await expect(pngButton).toBeEnabled()
  const restyled = await captureDownload(page, () => pngButton.click())
  expect(restyled.bytes.equals(original.bytes)).toBeFalsy()

  await page.getByRole('button', { name: 'Make matching pants' }).click()
  const matching = page.getByRole('dialog', { name: 'Matching pants' })
  const matchingPng = await captureDownload(page, () => matching.getByRole('button', { name: 'Download Matching pants PNG', exact: true }).click())
  expect(dimensions(matchingPng.bytes)).toEqual([585, 559])
  const fabricPeak = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    // The source's bright lettering must stay out of the dark pants fabric.
    const { data } = context.getImageData(320, 370, 30, 80)
    return data.reduce((peak, value, index) => index % 4 === 3 ? peak : Math.max(peak, value), 0)
  }, [...matchingPng.bytes])
  expect(fabricPeak).toBeLessThan(115)
  await matching.getByRole('button', { name: 'Close template tools' }).click()

  await page.getByRole('button', { name: 'Starter bases' }).click()
  const starters = page.getByRole('dialog', { name: 'Starter bases' })
  await starters.getByRole('combobox', { name: 'Garment' }).selectOption('jersey')
  const jersey = await captureDownload(page, () => starters.getByRole('button', { name: 'Download Jersey PNG' }).click())
  expect(dimensions(jersey.bytes)).toEqual([585, 559])
  const armAlpha = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return [context.getImageData(250, 385, 1, 1).data[3], context.getImageData(250, 444, 1, 1).data[3]]
  }, [...jersey.bytes])
  expect(armAlpha).toEqual([255, 0])
  await starters.getByRole('button', { name: 'Close template tools' }).click()

  await page.getByRole('button', { name: 'Colorways', exact: true }).click()
  const colorways = page.getByRole('dialog', { name: 'Colorways' })
  await expect(colorways.locator('.colorway-tile')).toHaveCount(6)
  await colorways.getByRole('button', { name: 'Add colorway', exact: true }).click()
  await expect(colorways.locator('.colorway-tile')).toHaveCount(7)
  await colorways.locator('.colorway-tile').filter({ hasText: 'Forest' }).click()
  const forest = await captureDownload(page, () => colorways.getByRole('button', { name: 'Download Forest PNG' }).click())
  expect(forest.bytes.equals(restyled.bytes)).toBeFalsy()
  await colorways.getByRole('button', { name: 'Use Forest' }).click()
  await expect(pngButton).toBeEnabled()
  expect((await captureDownload(page, () => pngButton.click())).bytes.equals(forest.bytes)).toBeTruthy()

  const archive = await captureDownload(page, () => page.getByRole('button', { name: 'Export set (ZIP)' }).click())
  expect(archive.name).toBe('threadport-set.zip')
  const parts = unzipSync(archive.bytes)
  expect(Object.keys(parts)).toHaveLength(10)
  expect(Buffer.from(parts['Matching-pants.png']).equals(matchingPng.bytes)).toBeTruthy()
  expect(Buffer.from(parts['Forest.png']).equals(forest.bytes)).toBeTruthy()
  for (const template of Object.values(parts)) expect(dimensions(template)).toEqual([585, 559])

  const share = await captureDownload(page, () => page.getByRole('button', { name: 'Before/after image' }).click())
  expect(share.name).toBe('threadport-before-after.png')
  expect(dimensions(share.bytes)).toEqual([1280, 728])
})

test('finds likely artwork and removes or replaces it with an original PNG', async ({ page }) => {
  await importShirt(page)
  const graphics = page.getByRole('region', { name: 'Logo and text check' })
  await expect(graphics.getByText(/Possible logo or text found/)).toBeVisible()
  await expect(graphics.getByRole('img', { name: 'Possible front artwork' })).toBeVisible()
  const pngButton = page.getByRole('button', { name: 'Download PNG', exact: true })
  const baseline = await captureDownload(page, () => pngButton.click())
  const removed = page.waitForResponse('**/api/quick-fix')
  await graphics.getByRole('button', { name: 'Remove front artwork' }).click()
  expect((await removed).ok()).toBeTruthy()
  await expect(graphics.getByText('Updating the artwork…')).toHaveCount(0)
  await expect(pngButton).toBeEnabled()
  expect((await captureDownload(page, () => pngButton.click())).bytes.equals(baseline.bytes)).toBeFalsy()

  await page.getByRole('button', { name: 'Back to upload' }).click()
  await page.getByText('Restyle an existing Roblox template', { exact: true }).click()
  await page.getByLabel('Choose template to restyle').setInputFiles(shirtTemplate)
  const graphic = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff00ed'
    context.fillRect(4, 4, 24, 24)
    return canvas.toDataURL().split(',')[1]
  })
  await graphics.getByLabel('Replace front artwork').setInputFiles({
    name: 'my-artwork.png', mimeType: 'image/png', buffer: Buffer.from(graphic, 'base64'),
  })
  await expect(graphics.getByText('Updating the artwork…')).toHaveCount(0)
  await expect(pngButton).toBeEnabled()
  const result = await captureDownload(page, () => pngButton.click())
  const pixels = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const context = new OffscreenCanvas(585, 559).getContext('2d')!
    context.drawImage(image, 0, 0)
    image.close()
    const { data } = context.getImageData(231, 74, 128, 128)
    return data.filter((value, index) => index % 4 === 0 && value > 245 && data[index + 1] < 10 && data[index + 2] > 220).length
  }, [...result.bytes])
  expect(pixels).toBeGreaterThan(100)
})

test('reviews a real batch, keeps edits in the ZIP and leaves failed photos retryable', async ({ page }) => {
  test.setTimeout(45_000)
  await page.goto('/#auto-bash')
  await page.getByRole('button', { name: 'Batch mode', exact: true }).click()
  await page.getByLabel('Batch photos').setInputFiles([
    { name: 'failed.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('unreadable') },
    { name: 'shirt.JPG', mimeType: 'image/jpeg', buffer: await readFile(shirtPhoto) },
    { name: 'pants.JPG', mimeType: 'image/jpeg', buffer: await readFile(pantsPhoto) },
  ])
  await page.getByRole('combobox', { name: 'Clothing type for shirt.JPG' }).selectOption('t-shirt')
  await page.getByRole('button', { name: 'Process batch' }).click()
  await expect(page.getByText('2 of 3 ready for review')).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('Use a readable JPG, PNG, or WebP photo.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()

  await page.locator('.batch-item').filter({ hasText: 'shirt.JPG' }).getByRole('button', { name: 'Review result' }).click()
  await expect(page.getByRole('img', { name: 'Generated T-Shirt template' })).toBeVisible()
  await page.getByRole('slider', { name: 'Brightness' }).fill('30')
  const download = page.getByRole('button', { name: 'Download PNG', exact: true })
  await expect(download).toBeEnabled()
  const edited = await captureDownload(page, () => download.click())
  await page.getByRole('button', { name: 'Back to batch' }).click()
  await expect(page.getByText('2 of 3 ready for review')).toBeVisible()
  const batch = await captureDownload(page, () => page.getByRole('button', { name: 'Download batch ZIP' }).click())
  const files = unzipSync(batch.bytes)
  expect(Object.keys(files)).toEqual(['shirt-t-shirt.png', 'pants-pants.png'])
  expect(Buffer.from(files['shirt-t-shirt.png']).equals(edited.bytes)).toBeTruthy()
  expect(dimensions(files['pants-pants.png'])).toEqual([585, 559])
})

test('opens the help center with visual examples and upload guidance on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/')
  await page.getByRole('link', { name: 'Help center', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Help center', exact: true })).toBeVisible()
  await expect(page.locator('.help-examples').getByRole('img')).toHaveCount(2)
  await page.getByText('Which file do I upload to Roblox?', { exact: true }).click()
  await expect(page.getByRole('link', { name: 'Roblox Classic Clothing guide' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
})

test('builds and opens a starter directly from a fabric photo', async ({ page }) => {
  await page.goto('/#auto-bash')
  await page.getByText('Build from a starter base', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Starter garment' }).selectOption('joggers')
  await page.getByLabel('Fabric photo for starter').setInputFiles(pantsPhoto)
  await page.getByRole('button', { name: 'Build starter' }).click()
  await expect(page.getByRole('img', { name: 'Joggers starter template' })).toBeVisible()
  const starter = await captureDownload(page, () => page.getByRole('button', { name: 'Download starter PNG' }).click())
  expect(dimensions(starter.bytes)).toEqual([585, 559])
  await page.getByRole('button', { name: 'Open starter in Studio' }).click()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Joggers')
  await expect(page.locator('.studio-layers .studio-layer')).toHaveCount(18)
})

test('pauses an active batch job and can process that photo again', async ({ page }) => {
  await page.goto('/#auto-bash')
  await page.getByRole('button', { name: 'Batch mode', exact: true }).click()
  await page.getByLabel('Batch photos').setInputFiles(shirtPhoto)
  await page.getByRole('combobox', { name: /Clothing type for black shirt/ }).selectOption('t-shirt')
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/process', async (route) => {
    await held
    await route.abort().catch(() => undefined)
  }, { times: 1 })
  const first = page.waitForRequest('**/api/process')
  try {
    await page.getByRole('button', { name: 'Process batch' }).click()
    await first
    await page.getByRole('button', { name: 'Pause batch' }).click()
    await expect(page.getByText('Queued', { exact: true })).toBeVisible()
  } finally {
    release()
  }
  await page.getByRole('button', { name: 'Process batch' }).click()
  await expect(page.getByText('1 of 1 ready for review')).toBeVisible()
})
