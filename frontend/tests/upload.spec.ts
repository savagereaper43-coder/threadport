import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const shirt = fileURLToPath(new URL('../../samples/black shirt test.JPG', import.meta.url))
const pants = fileURLToPath(new URL('../../samples/blue pants test.JPG', import.meta.url))

test('renders a shirt with its back photo and rerenders it when Quick-Fix shading changes', async ({ page }) => {
  test.setTimeout(60_000)
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

  await expect(page.getByRole('heading', { name: 'Template preview' })).toBeVisible({ timeout: 25_000 })
  await expect(page.getByRole('list', { name: 'Auto Bash progress' }).locator('[aria-current=step]')).toHaveText(/Result/)
  const template = page.getByRole('img', { name: 'Generated Shirt template' })
  await expect(template).toBeVisible()
  await expect(page.getByText('The torso back uses your back photo.')).toBeVisible()
  await expect(page.getByText('585 × 559 px')).toBeVisible()
  // Inspect the rendered canvas so an empty or miswired preview fails.
  const canvas = template.locator('canvas')
  await expect.poll(async () => canvas.evaluate((node: HTMLCanvasElement) => {
    const alpha = node.getContext('2d')?.getImageData(
      Math.floor(node.width * 295 / 585),
      Math.floor(node.height * 138 / 559),
      1, 1,
    ).data[3]
    return alpha
  })).toBe(255)
  const color = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const pixel = node.getContext('2d')!.getImageData(
      Math.floor(node.width * 233 / 585), Math.floor(node.height * 190 / 559), 1, 1,
    )
    return Array.from(pixel.data)
  })
  const before = await color()
  const shading = page.getByRole('slider', { name: 'Shading strength' })
  await expect(shading).toHaveValue('100')
  const adjusted = page.waitForResponse('**/api/process', { timeout: 15_000 })
  await shading.fill('0')
  await expect(shading).toHaveValue('0')
  expect((await adjusted).ok()).toBeTruthy()
  await expect.poll(color, { timeout: 25_000 }).not.toEqual(before)
  await expect(page.getByText('The torso back uses your back photo.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show regions' }).check()
  await expect(page.getByTitle('Right arm front')).toBeVisible()
  await page.getByRole('combobox', { name: 'Photo preview' }).selectOption({ label: 'Angle 1 cutout' })
  await expect(page.getByRole('img', { name: 'Clothing with the background removed' })).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.getByText('Photo type guess: Laid flat')).toBeVisible()
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
  await examples.click()
  await dialog.getByRole('button', { name: 'Close examples' }).click()
  await expect(dialog).not.toBeVisible()

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
  await expect(page.getByRole('heading', { name: 'Preparing your template' })).toBeVisible()
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
    ['progress', 'removing', 60],
    ['progress', 'cutting', 60],
    ['progress', 'placing', 85],
    ['progress', 'filling', 87],
    ['progress', 'shading', 92],
    ['progress', 'checking', 97],
    ['result', undefined, 100],
  ])
  expect(events[3]).toMatchObject({ garment_type: 't_shirt', mode: 't-shirt', method: 'grabcut' })
  expect(Buffer.from(events[3].png, 'base64').subarray(1, 4).toString()).toBe('PNG')

  expect(events.at(-1).template).toMatchObject({ mode: 't-shirt', profile: 't_shirt', has_back: false })
  const template = Buffer.from(events.at(-1).template.png, 'base64')
  expect(template.subarray(1, 4).toString()).toBe('PNG')
  expect([template.readUInt32BE(16), template.readUInt32BE(20)]).toEqual([512, 512])

  const missing = await request.post('/api/process', {
    multipart: { back: { name: 'back.jpg', mimeType: 'image/jpeg', buffer: await readFile(shirt) } },
  })
  expect(missing.status()).toBe(422)
  expect(await missing.json()).toEqual({ detail: 'Add the main photo first.' })

  const invalid = await request.post('/api/process', {
    multipart: { front: { name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: await readFile(shirt) }, shading: 'NaN' },
  })
  expect(invalid.status()).toBe(422)
  expect(await invalid.json()).toEqual({ detail: 'Choose a shading strength from 0% to 100%.' })
})


test('a single flat-lay photo produces a pants preview on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.locator('.drop-zone input[type=file]').setInputFiles(pants)
  await page.getByRole('button', { name: 'Make my Roblox clothing' }).click()
  await expect(page.getByRole('img', { name: 'Generated Pants template' })).toBeVisible()
  await expect(page.getByText('We guessed the torso back from your front photo.')).toBeVisible()
  await expect(page.getByText(/Estimated match \d+%/)).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show regions' }).check()
  const waistBack = page.getByRole('img', { name: /Waist back.*guessed the back/ })
  await expect(waistBack).toHaveClass(/low-confidence/)
  await waistBack.focus()
  await expect(waistBack).toBeFocused()
  await expect(page.getByText(/Waist back · \d+% · We guessed the back/)).toBeVisible()
  const canvas = page.locator('.generated-template canvas')
  const backPixels = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext('2d')!
    return Array.from(context.getImageData(
      Math.floor(node.width * 480 / 585), Math.floor(node.height * 130 / 559), 3, 3,
    ).data)
  })
  await expect.poll(async () => (await backPixels())[3]).toBe(255)
  const recommended = await backPixels()
  await page.getByRole('button', { name: 'Try another version' }).click()
  await expect(page.getByRole('button', { name: 'Show recommended version' })).toBeVisible()
  await expect.poll(backPixels).not.toEqual(recommended)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
})
