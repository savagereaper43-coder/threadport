import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const shirt = fileURLToPath(new URL('../../samples/black shirt test.JPG', import.meta.url))
const pants = fileURLToPath(new URL('../../samples/blue pants test.JPG', import.meta.url))

test('uploads a main photo, back and angle, then shows the actual cutouts and classifications', async ({ page }) => {
  await page.goto('/')
  const submit = page.getByRole('button', { name: 'Make my Roblox clothing' })
  await expect(submit).toBeDisabled()
  await expect(page.getByRole('radio', { name: 'Auto' })).toBeChecked()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Browse files' }).click()
  await (await chooser).setFiles(shirt)
  await page.getByLabel('Add back photo (optional)').setInputFiles(shirt)
  await page.getByLabel('Add more angles (optional)').setInputFiles(pants)
  await expect(page.getByRole('img', { name: 'Main clothing photo' })).toBeVisible()
  await submit.click()

  await expect(page.getByRole('heading', { name: 'Photos prepared' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Auto Bash progress' }).locator('[aria-current=step]')).toHaveText(/Processing/)
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '100')
  await expect(page.locator('.process-checklist [aria-label=Complete]')).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Clothing with the background removed' })).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.locator('dd', { hasText: 'Laid flat' })).toBeVisible()
  await expect(page.locator('dd').last()).toHaveText('Shirt')
  await page.getByRole('combobox', { name: 'Preview photo' }).selectOption({ label: 'Angle 1' })
  await expect(page.locator('dd').last()).toHaveText('Pants')
  await page.getByRole('button', { name: 'Back to upload' }).click()
  await expect(page.getByRole('button', { name: 'Replace photo' })).toBeVisible()
  await expect(submit).toBeEnabled()
})

test('supports keyboard dismissal of photo tips, drag-and-drop and clipboard paste', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const examples = page.getByRole('button', { name: 'See good vs bad photos' })
  await examples.click()
  const dialog = page.getByRole('dialog', { name: 'Good vs bad photos' })
  await expect(dialog.getByRole('img')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(examples).toBeFocused()

  const files = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.jpg', { type: 'image/jpeg' }))
    return transfer
  }, [...await readFile(shirt)])
  const dropZone = page.getByRole('region', { name: 'Drop a photo of any clothing' })
  await dropZone.dispatchEvent('drop', { dataTransfer: files })
  await expect(dropZone.getByText('dropped.jpg')).toBeVisible()
  await page.getByRole('button', { name: 'Remove main photo' }).click()
  await expect(page.getByRole('button', { name: 'Make my Roblox clothing' })).toBeDisabled()
  await page.evaluate((clipboardData) => {
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }))
  }, files)
  await expect(dropZone.getByText('dropped.jpg')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
})

test('cancels an in-flight request and returns to the selected upload', async ({ page }) => {
  await page.goto('/')
  await page.locator('.drop-zone input[type=file]').setInputFiles(shirt)
  let unblock!: () => void
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  await page.route('/api/process', async (route) => {
    await blocked
    await route.abort().catch(() => undefined)
  })

  const request = page.waitForRequest('**/api/process')
  await page.getByRole('button', { name: 'Make my Roblox clothing' }).click()
  await request
  await expect(page.getByRole('heading', { name: 'Preparing your photos' })).toBeVisible()
  const failed = page.waitForEvent('requestfailed', (event) => event.url().endsWith('/api/process'))
  try {
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Auto Bash' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Main clothing photo' })).toBeVisible()
    expect((await failed).failure()?.errorText).toContain('ERR_ABORTED')
  } finally {
    unblock()
  }
})

test('reports unreadable photos in plain language and leaves the upload ready to retry', async ({ page }) => {
  await page.goto('/')
  await page.locator('.drop-zone input[type=file]').setInputFiles({
    name: 'corrupted.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image'),
  })
  await page.getByRole('button', { name: 'Make my Roblox clothing' }).click()
  await expect(page.getByRole('alert')).toHaveText('Use a readable JPG, PNG, or WebP photo.')
  await expect(page.getByRole('button', { name: 'Replace photo' })).toBeVisible()
})

test('the live endpoint streams ordered progress and returns the requested template mode', async ({ request }) => {
  const response = await request.post('/api/process', {
    multipart: { front: { name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: await readFile(shirt) }, mode: 't-shirt' },
  })
  expect(response.ok()).toBeTruthy()
  expect(response.headers()['content-type']).toContain('application/x-ndjson')
  const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
  expect(events.map(({ type, step, percent }) => [type, step, percent])).toEqual([
    ['progress', 'finding', 0],
    ['progress', 'finding', 20],
    ['progress', 'removing', 20],
    ['photo', undefined, undefined],
    ['progress', 'removing', 99],
    ['result', undefined, 100],
  ])
  expect(events[3]).toMatchObject({ garment_type: 't_shirt', mode: 't-shirt', method: 'grabcut' })
  expect(Buffer.from(events[3].png, 'base64').subarray(1, 4).toString()).toBe('PNG')

  const missing = await request.post('/api/process', {
    multipart: { back: { name: 'back.jpg', mimeType: 'image/jpeg', buffer: await readFile(shirt) } },
  })
  expect(missing.status()).toBe(422)
  expect(await missing.json()).toEqual({ detail: 'Add the main photo first.' })
})
