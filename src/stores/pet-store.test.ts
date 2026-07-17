import { describe, it, expect } from 'vitest';
import { usePetStore, PetState } from './pet-store';

describe('pet-store', () => {
  it('sets WORKING when task is processing', () => {
    const { updateFromAPI } = usePetStore.getState();
    updateFromAPI({
      wallet: { daily_token_balance: 500, daily_token_limit: 1000 },
      tasks: [{ id: '1', status: 'processing' }],
    });
    expect(usePetStore.getState().petState).toBe(PetState.WORKING);
  });

  it('sets QUOTA_LOW when balance is low', () => {
    const { updateFromAPI } = usePetStore.getState();
    updateFromAPI({
      wallet: { daily_token_balance: 5, daily_token_limit: 1000 },
      tasks: [],
    });
    expect(usePetStore.getState().petState).toBe(PetState.QUOTA_LOW);
  });
});
