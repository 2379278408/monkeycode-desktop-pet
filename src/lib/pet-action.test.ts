import { describe, expect, it } from 'vitest'
import { PetState } from '../stores/pet-store'
import {
  selectPetAction,
  type PetAction,
  type PetActionInputs,
} from './pet-action'

function expectedPetAction(inputs: PetActionInputs): PetAction {
  switch (inputs.interaction) {
    case 'dragging':
    case 'petting':
    case 'dropping':
      return inputs.interaction
    case 'waving':
    case 'celebrating':
    case null:
      break
  }

  if (inputs.lifeAction) return inputs.lifeAction
  if (inputs.interaction) return inputs.interaction

  switch (inputs.business) {
    case PetState.SUCCESS:
    case 'success':
      return 'task-success'
    case PetState.ERROR:
    case 'error':
      return 'task-error'
    case PetState.QUOTA_LOW:
    case 'quota-low':
      return 'quota-low'
    case PetState.IDLE:
    case PetState.WORKING:
    case null:
      return inputs.form
  }

  throw new Error(`Unhandled test business state: ${String(inputs.business)}`)
}

describe('selectPetAction', () => {
  const highPriorityInteractions = ['dragging', 'petting', 'dropping'] as const
  const ordinaryInteractions = ['waving', 'celebrating'] as const
  const lifeActions = ['eating', 'falling-asleep', 'waking'] as const
  const interactions = [null, ...ordinaryInteractions, ...highPriorityInteractions] as const
  const lifeActionOptions = [null, ...lifeActions] as const
  const businessOptions = [
    null,
    PetState.SUCCESS,
    PetState.ERROR,
    PetState.QUOTA_LOW,
    PetState.IDLE,
    PetState.WORKING,
    'success',
    'error',
    'quota-low',
  ] as const
  const forms = ['normal', 'happy', 'sad', 'hungry', 'sleepy', 'sleeping'] as const
  const actionMatrix = interactions.flatMap((interaction) => (
    lifeActionOptions.flatMap((lifeAction) => (
      businessOptions.flatMap((business) => (
        forms.map((form) => ({ interaction, lifeAction, business, form }))
      ))
    ))
  ))

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

  it.each(highPriorityInteractions.flatMap((interaction) => (
    lifeActions.map((lifeAction) => [interaction, lifeAction] as const)
  )))(
    'keeps high-priority interaction %s above life action %s',
    (interaction, lifeAction) => {
      expect(selectPetAction({
        interaction,
        lifeAction,
        business: PetState.ERROR,
        form: 'hungry',
      })).toBe(interaction)
    },
  )

  it.each(lifeActions)(
    'selects life action %s when interaction is null',
    (lifeAction) => {
      expect(selectPetAction({
        interaction: null,
        lifeAction,
        business: PetState.ERROR,
        form: 'hungry',
      })).toBe(lifeAction)
    },
  )

  it.each(highPriorityInteractions)(
    'selects high-priority interaction %s when life action is null',
    (interaction) => {
      expect(selectPetAction({
        interaction,
        lifeAction: null,
        business: PetState.ERROR,
        form: 'hungry',
      })).toBe(interaction)
    },
  )

  it.each(ordinaryInteractions.flatMap((interaction) => (
    lifeActions.map((lifeAction) => [lifeAction, interaction] as const)
  )))(
    'keeps life action %s above ordinary interaction %s',
    (lifeAction, interaction) => {
      expect(selectPetAction({
        interaction,
        lifeAction,
        business: PetState.ERROR,
        form: 'hungry',
      })).toBe(lifeAction)
    },
  )

  it.each(ordinaryInteractions.flatMap((interaction) => (
    [PetState.SUCCESS, PetState.ERROR, PetState.QUOTA_LOW]
      .map((business) => [interaction, business] as const)
  )))(
    'keeps ordinary interaction %s above business state %s',
    (interaction, business) => {
      expect(selectPetAction({
        interaction,
        lifeAction: null,
        business,
        form: 'hungry',
      })).toBe(interaction)
    },
  )

  it('uses the life form when no temporary action is active', () => {
    expect(selectPetAction({
      interaction: null,
      lifeAction: null,
      business: null,
      form: 'sleepy',
    })).toBe('sleepy')
  })

  it.each([null, PetState.IDLE, PetState.WORKING].flatMap((business) => (
    forms.map((form) => [form, business] as const)
  )))(
    'selects form %s for inactive business state %s',
    (form, business) => {
      expect(selectPetAction({
        interaction: null,
        lifeAction: null,
        business,
        form,
      })).toBe(form)
    },
  )

  it('covers every action input combination', () => {
    expect(actionMatrix).toHaveLength(1_296)
  })

  it.each(actionMatrix)(
    'selects the five-layer priority for %o',
    (inputs) => {
      expect(selectPetAction(inputs)).toBe(expectedPetAction(inputs))
    },
  )

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
