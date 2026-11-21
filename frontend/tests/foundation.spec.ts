import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('switches modes, edits the Studio title and opens the projects placeholder', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Auto Bash', exact: true })).toBeVisible()
  await expect(page.getByText('Upload', { exact: true })).toHaveAttribute('aria-current', 'step')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Studio', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const title = page.getByRole('textbox', { name: 'Project name' })
  await title.fill('  My shirt  ')
  await title.press('Enter')
  await expect(title).toHaveValue('My shirt')
  await page.getByRole('button', { name: 'My Projects' }).click()
  await expect(page.getByRole('heading', { name: 'My Projects' })).toBeVisible()
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(title).toHaveValue('My shirt')
  await page.getByRole('button', { name: 'Auto Bash', exact: true }).click()
  await expect(page.getByText('Upload', { exact: true })).toBeVisible()
})

test('the hidden guides use the avatar’s right and left in both classic layouts', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  const toggle = page.getByRole('checkbox', { name: 'Show regions' })
  await expect(toggle).not.toBeChecked()
  await expect(page.getByTitle('Right arm front')).toHaveCount(0)
  await toggle.focus()
  await page.keyboard.press('Space')
  const rightArm = page.getByTitle('Right arm front')
  const leftArm = page.getByTitle('Left arm front')
  await expect(rightArm).toBeVisible()
  await expect(leftArm).toBeVisible()
  expect((await rightArm.boundingBox())!.x).toBeLessThan((await leftArm.boundingBox())!.x)
  await page.getByText('Pants', { exact: true }).click()
  const rightLeg = page.getByTitle('Right leg front')
  const leftLeg = page.getByTitle('Left leg front')
  await expect(page.getByTitle('Waist front')).toBeVisible()
  expect((await rightLeg.boundingBox())!.x).toBeLessThan((await leftLeg.boundingBox())!.x)
  await toggle.uncheck()
  await expect(rightLeg).toHaveCount(0)
})

for (const template of [
  { label: 'Shirt', filename: 'shirt', width: 585, height: 559 },
  { label: 'Pants', filename: 'pants', width: 585, height: 559 },
  { label: 'T-Shirt', filename: 't-shirt', width: 512, height: 512 },
]) {
  test(`downloads a transparent ${template.label} PNG at its native dimensions with guides on`, async ({ page }) => {
    await page.goto('/')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
    await page.getByText(template.label, { exact: true }).click()
    await page.getByRole('checkbox', { name: 'Show regions' }).check()
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PNG' }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe(`threadport-${template.filename}-template.png`)

    const bytes = await readFile(await download.path())
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const chunks: string[] = []
    for (let offset = 8; offset < bytes.length;) {
      chunks.push(bytes.toString('ascii', offset + 4, offset + 8))
      offset += bytes.readUInt32BE(offset) + 12
    }
    expect(chunks).toContain('sRGB')
    const image = await page.evaluate(async (png) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
      const { width, height } = bitmap
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const { data } = context.getImageData(0, 0, width, height)
      return { width, height, transparent: data.every((value) => value === 0) }
    }, [...bytes])
    expect(image).toEqual({ width: template.width, height: template.height, transparent: true })
  })
}

test('the export keeps artwork at its original coordinates and clears unused pixels', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  const result = await page.evaluate(async () => {
    const modulePath = '/src/template.ts'
    const { exportTemplatePng } = await import(modulePath) as typeof import('../src/template')
    const pixels = new ImageData(585, 559)
    pixels.data.fill(255)
    pixels.data.set([53, 125, 233, 255], (355 * 585 + 217) * 4)
    pixels.data.set([219, 73, 32, 255], (355 * 585 + 308) * 4)

    const bitmap = await createImageBitmap(await exportTemplatePng('pants', pixels))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()

    const sample = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data]
    return {
      rightLeg: sample(217, 355),
      leftLeg: sample(308, 355),
      gutter: sample(281, 355),
      outside: sample(0, 0),
    }
  })
  expect(result).toEqual({
    rightLeg: [53, 125, 233, 255],
    leftLeg: [219, 73, 32, 255],
    gutter: [0, 0, 0, 0],
    outside: [0, 0, 0, 0],
  })
})

test('the shell fits a narrow phone without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('button', { name: 'My Projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download PNG' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})
