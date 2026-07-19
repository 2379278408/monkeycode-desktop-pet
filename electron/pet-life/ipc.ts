import type { PetLifeStore } from './store'
import { assertPetLifeSnapshotPayload } from './validation'

export function savePetLifePayload(
  store: Pick<PetLifeStore, 'save'>,
  value: unknown,
): void {
  store.save(assertPetLifeSnapshotPayload(value))
}
