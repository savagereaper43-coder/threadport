import { expect, test } from '@playwright/test'
import layout from '../../shared/templateLayout.json' with { type: 'json' }

test('each classic face uses its exact pixel rectangle', () => {
  const expected = {
    'torso.up': [231, 8, 128, 64],
    'torso.right': [165, 74, 64, 128],
    'torso.front': [231, 74, 128, 128],
    'torso.left': [361, 74, 64, 128],
    'torso.back': [427, 74, 128, 128],
    'torso.down': [231, 204, 128, 64],
    'rightLimb.up': [217, 289, 64, 64],
    'rightLimb.left': [19, 355, 64, 128],
    'rightLimb.back': [85, 355, 64, 128],
    'rightLimb.right': [151, 355, 64, 128],
    'rightLimb.front': [217, 355, 64, 128],
    'rightLimb.down': [217, 485, 64, 64],
    'leftLimb.up': [308, 289, 64, 64],
    'leftLimb.front': [308, 355, 64, 128],
    'leftLimb.left': [374, 355, 64, 128],
    'leftLimb.back': [440, 355, 64, 128],
    'leftLimb.right': [506, 355, 64, 128],
    'leftLimb.down': [308, 485, 64, 64],
  }

  expect(layout).toHaveLength(18)
  const actual = Object.fromEntries(
    layout.map(({ part, face, x, y, w, h }) => [`${part}.${face}`, [x, y, w, h]]),
  )
  expect(actual).toEqual(expected)
})
