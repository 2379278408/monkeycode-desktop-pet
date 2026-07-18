import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PetState } from '../stores/pet-store'
import { PetShell } from './PetShell'

const storeHarness = vi.hoisted(() => ({ petState: 'IDLE' }))

vi.mock('../stores/pet-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/pet-store')>()
  return {
    ...actual,
    usePetStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
      petState: storeHarness.petState,
      updateFromAPI: () => {},
    }),
  }
})

const expectedAssetByState: Record<PetState, string> = {
  [PetState.IDLE]: 'normal.svg',
  [PetState.WORKING]: 'normal.svg',
  [PetState.SUCCESS]: 'success.svg',
  [PetState.ERROR]: 'error.svg',
  [PetState.QUOTA_LOW]: 'quota-low.svg',
}

describe('PetShell sprite compatibility', () => {
  it.each(Object.values(PetState))('maps %s through the production action selector', (petState) => {
    storeHarness.petState = petState

    const markup = renderToStaticMarkup(createElement(PetShell, {
      onLogout: async () => {},
    }))

    expect(markup).toContain(`/assets/monkey/${expectedAssetByState[petState]}`)
  })
})
