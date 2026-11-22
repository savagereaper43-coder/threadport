import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('home, upload, Studio and Help pass the WCAG A and AA browser checks', async ({ page }) => {
  test.setTimeout(45_000)
  for (const [route, title] of [['/', 'Turn any clothes photo into Roblox clothing'], ['/#auto-bash', 'Auto Bash'],
    ['/#studio', 'Studio'], ['/#help', 'Help center']]) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), route).toEqual([])
  }
})

test('can skip navigation and paint and select on the Studio canvas using the keyboard', async ({ page }) => {
  await page.goto('/#studio')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  const canvas = page.getByRole('group', { name: 'Studio canvas' })
  await canvas.focus()
  await page.keyboard.press('b')
  await page.keyboard.press('Enter')
  await expect.poll(async () => page.getByRole('img', { name: 'Shirt template canvas' }).evaluate((element: HTMLCanvasElement) =>
    element.getContext('2d')!.getImageData(295, 138, 1, 1).data[3])).toBe(255)
  await page.keyboard.press('m')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Deselect' })).toBeVisible()
})

test('imported Result and the colorways dialog pass the WCAG browser checks', async ({ page }) => {
  await page.goto('/#auto-bash')
  await page.getByText('Restyle an existing Roblox template', { exact: true }).click()
  const template = fileURLToPath(new URL('../../samples/out/black-shirt-test.png', import.meta.url))
  await page.getByLabel('Choose template to restyle').setInputFiles(template)
  await expect(page.getByRole('heading', { name: 'Template preview', exact: true })).toBeVisible()
  const audit = async () => {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([])
  }
  await audit()
  await page.getByRole('button', { name: 'Colorways', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Colorways' })).toBeVisible()
  await audit()
})
