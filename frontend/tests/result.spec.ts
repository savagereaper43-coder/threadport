import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const shirt = fileURLToPath(new URL('../../samples/black shirt test.JPG', import.meta.url))

test('edits a real shirt, previews both sides, copies catalog text and exports the exact edited PNG', async ({ page, context }) => {
  test.setTimeout(60_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.locator('.drop-zone input[type=file]').setInputFiles(shirt)
  await page.getByRole('button', { name: 'Make my Roblox clothing' }).click()

  const front = page.getByRole('img', { name: 'Flat front mannequin preview' })
  const back = page.getByRole('img', { name: 'Flat back mannequin preview' })
  const download = page.getByRole('button', { name: 'Download PNG' })
  await expect(download).toBeEnabled({ timeout: 25_000 })
  const figure = (side: typeof front) => side.evaluate((node: HTMLCanvasElement) => node.toDataURL())
  const originalFront = await figure(front)
  const originalBack = await figure(back)
  expect(originalFront).not.toBe(originalBack)
  const pixel = (x: number, y: number) => front.evaluate((node: HTMLCanvasElement, at) =>
    Array.from(node.getContext('2d')!.getImageData(at.x, at.y, 1, 1).data), { x, y })
  expect(await pixel(72, 78)).not.toEqual([86, 89, 98, 255])

  await page.getByRole('slider', { name: 'Sharpness' }).fill('60')
  await page.getByRole('slider', { name: 'Brightness' }).fill('30')
  await page.getByRole('slider', { name: 'Saturation' }).fill('-30')
  await page.getByRole('button', { name: 'Recolor to Berry' }).click()
  await page.getByRole('checkbox', { name: 'Remove logo' }).check()
  await page.getByRole('combobox', { name: 'Style' }).selectOption('vintage')
  await page.getByRole('combobox', { name: 'Sleeves' }).selectOption('long')
  await expect(download).toBeEnabled({ timeout: 10_000 })
  expect(await figure(front)).not.toBe(originalFront)
  expect(await pixel(16, 98)).not.toEqual([104, 107, 116, 255])

  await page.getByRole('combobox', { name: 'Sleeves' }).selectOption('none')
  await expect(download).toBeEnabled()
  expect(await pixel(16, 98)).toEqual([104, 107, 116, 255])

  const beforeBack = await figure(back)
  const beforeFront = await figure(front)
  await page.getByRole('checkbox', { name: 'Make back plain' }).check()
  await expect(download).toBeEnabled()
  expect(await figure(back)).not.toBe(beforeBack)
  expect(await figure(front)).toBe(beforeFront)
  const regenerated = page.waitForResponse('**/api/quick-fix')
  await page.getByRole('button', { name: 'Regenerate back' }).click()
  const response = await regenerated
  expect(response.ok()).toBeTruthy()
  const edited = Buffer.from((await response.json()).png, 'base64')
  await expect(download).toBeEnabled()

  const catalog = page.getByRole('region', { name: 'Catalog checklist' })
  await expect(catalog.locator('.check-pass')).toHaveCount(4)
  for (const label of ['Name', 'Description', 'Tags']) {
    const entry = catalog.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })
    await entry.getByRole('button', { name: `Copy ${label.toLowerCase()}` }).click()
    await expect(catalog.getByRole('status')).toHaveText(`${label} copied.`)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await entry.locator('dd').innerText())
  }
  await expect(catalog.getByRole('link', { name: 'Roblox Creator Hub' })).toHaveAttribute('href', /create\.roblox\.com/)

  const downloadEvent = page.waitForEvent('download')
  await download.click()
  const file = await downloadEvent
  expect(file.suggestedFilename()).toBe('threadport-shirt.png')
  const exported = await readFile((await file.path())!)
  expect(exported.equals(edited)).toBe(true)
  expect([exported.readUInt32BE(16), exported.readUInt32BE(20), exported[25]]).toEqual([585, 559, 6])

  const unready = await page.evaluate(async (png) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 585
    canvas.height = 559
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    ctx.clearRect(231, 204, 128, 64)
    ctx.fillRect(0, 0, 4, 4)
    return canvas.toDataURL('image/png').split(',')[1]
  }, exported.toString('base64'))
  await page.route('**/api/quick-fix', (route) => route.fulfill({ json: { png: unready } }), { times: 1 })
  await page.getByRole('combobox', { name: 'Style' }).selectOption('clean')
  await expect(catalog.locator('.check-fail')).toHaveText(['Transparency', 'Required regions filled'])
  await expect(catalog.getByText('Empty regions: Torso down.')).toBeVisible()

  await page.getByRole('button', { name: 'Reset adjustments' }).click()
  await expect(download).toBeEnabled()
  expect(await figure(front)).toBe(originalFront)
  expect(await figure(back)).toBe(originalBack)

  const rerun = page.waitForResponse('**/api/process')
  await page.getByRole('button', { name: 'Re-run auto placement' }).click()
  expect((await rerun).ok()).toBeTruthy()
  await expect(download).toBeEnabled({ timeout: 25_000 })
  await expect(page.getByRole('heading', { name: 'Template preview' })).toBeVisible()
})

test('retries a failed edit of a square T-Shirt and exports its 512 px graphic', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'T-Shirt', exact: true }).check()
  await page.locator('.drop-zone input[type=file]').setInputFiles(shirt)
  await page.getByRole('button', { name: 'Make my Roblox clothing' }).click()
  const download = page.getByRole('button', { name: 'Download PNG' })
  await expect(download).toBeEnabled()
  await expect(page.getByRole('slider', { name: 'Shading strength' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Sleeves' })).toHaveCount(0)
  await page.route('**/api/quick-fix', (route) => route.fulfill({
    status: 503, json: { detail: 'Rendering is temporarily unavailable.' },
  }), { times: 1 })
  await page.getByRole('slider', { name: 'Brightness' }).fill('35')
  await expect(page.getByRole('alert')).toHaveText('Rendering is temporarily unavailable.')
  await expect(download).toBeDisabled()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(download).toBeEnabled()

  const nextDownload = page.waitForEvent('download')
  await download.click()
  const file = await nextDownload
  const exported = await readFile((await file.path())!)
  expect([exported.readUInt32BE(16), exported.readUInt32BE(20), exported[25]]).toEqual([512, 512, 6])

  const invalid = await request.post('/api/quick-fix', {
    data: { png: exported.toString('base64'), mode: 't-shirt', fixes: { brightness: 101 } },
  })
  expect(invalid.status()).toBe(422)
})
