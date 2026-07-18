import { describe, expect, it } from 'vitest'
import { PetState } from '../stores/pet-store'
import {
  selectPetAction,
  type PetAction,
  type PetInteractionAction,
  type PetLifeAction,
} from './pet-action'

describe('selectPetAction', () => {
  it('exposes the complete action union', () => {
    const actions: Record<PetAction, true> = {
      normal: true,
      happy: true,
      sad: true,
      hungry: true,
      sleepy: true,
      sleeping: true,
      waving: true,
      celebrating: true,
      petting: true,
      dragging: true,
      dropping: true,
      eating: true,
      'falling-asleep': true,
      waking: true,
      'task-success': true,
      'task-error': true,
      'quota-low': true,
    }

    expect(Object.keys(actions)).toHaveLength(17)
  })

  it('prioritizes interaction, life, business, quota, then form', () => {
    const interaction: PetInteractionAction = 'petting'
    const lifeAction: PetLifeAction = 'eating'

    expect(selectPetAction({ interaction, lifeAction, business: PetState.ERROR, form: 'hungry' }))
      .toBe('petting')
    expect(selectPetAction({ interaction: null, lifeAction, business: PetState.ERROR, form: 'hungry' }))
      .toBe('eating')
    expect(selectPetAction({ interaction: null, lifeAction: null, business: PetState.SUCCESS, form: 'hungry' }))
      .toBe('task-success')
    expect(selectPetAction({ interaction: null, lifeAction: null, business: PetState.ERROR, form: 'hungry' }))
      .toBe('task-error')
    expect(selectPetAction({ interaction: null, lifeAction: null, business: PetState.QUOTA_LOW, form: 'hungry' }))
      .toBe('quota-low')
    expect(selectPetAction({ interaction: null, lifeAction: null, business: null, form: 'sleepy' }))
      .toBe('sleepy')
  })

  it.each([
    [PetState.SUCCESS, 'task-success'],
    [PetState.ERROR, 'task-error'],
    [PetState.QUOTA_LOW, 'quota-low'],
    ['success', 'task-success'],
    ['error', 'task-error'],
    ['quota-low', 'quota-low'],
  ] as const)('maps business state %s to %s', (business, expected) => {
    expect(selectPetAction({ interaction: null, lifeAction: null, business, form: 'normal' }))
      .toBe(expected)
  })

  it('accepts PetState values through its string-literal business contract', () => {
    expect(selectPetAction({
      interaction: null,
      lifeAction: null,
      business: PetState.SUCCESS,
      form: 'normal',
    })).toBe('task-success')
  })

  it.each([PetState.IDLE, PetState.WORKING] as const)(
    'treats %s as having no temporary business action',
    (business) => {
      expect(selectPetAction({ interaction: null, lifeAction: null, business, form: 'happy' }))
        .toBe('happy')
    },
  )

  it('does not mutate its input', () => {
    const input = {
      interaction: null,
      lifeAction: null,
      business: PetState.SUCCESS,
      form: 'normal' as const,
    }
    const before = { ...input }

    selectPetAction(input)

    expect(input).toEqual(before)
  })
})
