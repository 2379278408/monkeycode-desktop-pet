import type { PetForm } from './pet-life'

export type PetInteractionAction =
  | 'waving'
  | 'celebrating'
  | 'petting'
  | 'dragging'
  | 'dropping'

export type PetLifeAction = 'eating' | 'falling-asleep' | 'waking'
export type PetBusinessAction = 'task-success' | 'task-error' | 'quota-low'
export type PetBusinessState =
  | 'SUCCESS'
  | 'ERROR'
  | 'QUOTA_LOW'
  | 'IDLE'
  | 'WORKING'
  | 'success'
  | 'error'
  | 'quota-low'

export type PetAction =
  | PetForm
  | PetInteractionAction
  | PetLifeAction
  | PetBusinessAction

export interface PetActionInputs {
  interaction: PetInteractionAction | null
  lifeAction: PetLifeAction | null
  business: PetBusinessState | null
  form: PetForm
}

function selectBusinessAction(
  business: PetActionInputs['business'],
): PetBusinessAction | null {
  switch (business) {
    case 'SUCCESS':
    case 'success':
      return 'task-success'
    case 'ERROR':
    case 'error':
      return 'task-error'
    case 'QUOTA_LOW':
    case 'quota-low':
      return 'quota-low'
    case 'IDLE':
    case 'WORKING':
    case null:
      return null
  }

  return assertNever(business)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled business state: ${String(value)}`)
}

const INTERACTION_PRIORITIES: Record<PetInteractionAction, 'high' | 'ordinary'> = {
  waving: 'ordinary',
  celebrating: 'ordinary',
  petting: 'high',
  dragging: 'high',
  dropping: 'high',
}

function isHighPriorityInteraction(
  action: PetInteractionAction | null,
): action is Extract<PetInteractionAction, 'dragging' | 'petting' | 'dropping'> {
  return action !== null && INTERACTION_PRIORITIES[action] === 'high'
}

export function selectPetAction(inputs: PetActionInputs): PetAction {
  if (isHighPriorityInteraction(inputs.interaction)) return inputs.interaction

  return inputs.lifeAction
    ?? inputs.interaction
    ?? selectBusinessAction(inputs.business)
    ?? inputs.form
}
