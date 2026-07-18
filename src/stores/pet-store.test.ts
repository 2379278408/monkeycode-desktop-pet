import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveBasePetState, PetState, usePetStore } from './pet-store';

const finishedEvent = {
  task_id: 'task-1',
  title: 'Finished task',
  status: 'finished' as const,
  occurred_at: 1,
};

const errorEvent = {
  task_id: 'task-2',
  title: 'Failed task',
  status: 'error' as const,
  occurred_at: 2,
};

describe('pet-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePetStore.getState().reset();
  });

  afterEach(() => {
    usePetStore.getState().reset();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows SUCCESS for eight seconds then restores WORKING', () => {
    usePetStore.getState().updateFromAPI({
      tasks: [{ id: 'active', status: 'processing' }],
      task_event: finishedEvent,
    });

    expect(usePetStore.getState().petState).toBe(PetState.SUCCESS);
    vi.advanceTimersByTime(8_000);
    expect(usePetStore.getState().petState).toBe(PetState.WORKING);
    expect(usePetStore.getState().recentTaskEvent).toBeNull();
  });

  it('shows ERROR for eight seconds then restores the base state', () => {
    usePetStore.getState().updateFromAPI({ task_event: errorEvent });

    expect(usePetStore.getState().petState).toBe(PetState.ERROR);
    vi.advanceTimersByTime(8_000);
    expect(usePetStore.getState().petState).toBe(PetState.IDLE);
  });

  it('restores QUOTA_LOW after a terminal event', () => {
    usePetStore.getState().updateFromAPI({
      wallet: { daily_token_balance: 9, daily_token_limit: 100 },
      task_event: finishedEvent,
    });

    vi.advanceTimersByTime(8_000);
    expect(usePetStore.getState().petState).toBe(PetState.QUOTA_LOW);
  });

  it('does not reset the timer for a duplicate event', () => {
    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });
    vi.advanceTimersByTime(4_000);

    usePetStore.getState().updateFromAPI({
      task_event: { ...finishedEvent, title: 'Updated title' },
    });
    vi.advanceTimersByTime(4_000);

    expect(usePetStore.getState().petState).toBe(PetState.IDLE);
    expect(usePetStore.getState().recentTaskEvent).toBeNull();
  });

  it('replaces the current event and restarts the timer for a new event', () => {
    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });
    vi.advanceTimersByTime(4_000);

    usePetStore.getState().updateFromAPI({ task_event: errorEvent });
    vi.advanceTimersByTime(4_000);

    expect(usePetStore.getState().petState).toBe(PetState.ERROR);
    expect(usePetStore.getState().recentTaskEvent).toEqual(errorEvent);

    vi.advanceTimersByTime(4_000);
    expect(usePetStore.getState().petState).toBe(PetState.IDLE);
  });

  it('keeps one timer and gives a reentrant replacement event a full eight seconds', () => {
    let injectedReplacement = false;
    const unsubscribe = usePetStore.subscribe((state) => {
      if (!injectedReplacement && state.recentTaskEvent?.task_id === finishedEvent.task_id) {
        injectedReplacement = true;
        vi.advanceTimersByTime(4_000);
        usePetStore.getState().updateFromAPI({ task_event: errorEvent });
      }
    });

    try {
      usePetStore.getState().updateFromAPI({ task_event: finishedEvent });

      expect(injectedReplacement).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
      expect(usePetStore.getState().recentTaskEvent).toEqual(errorEvent);
      expect(usePetStore.getState().petState).toBe(PetState.ERROR);

      vi.advanceTimersByTime(4_000);
      expect(usePetStore.getState().petState).toBe(PetState.ERROR);

      vi.advanceTimersByTime(3_999);
      expect(usePetStore.getState().petState).toBe(PetState.ERROR);

      vi.advanceTimersByTime(1);
      expect(usePetStore.getState().petState).toBe(PetState.IDLE);
      expect(usePetStore.getState().recentTaskEvent).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('does not replay the last handled event after its transient state expires', () => {
    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });
    vi.advanceTimersByTime(8_000);

    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });

    expect(usePetStore.getState().petState).toBe(PetState.IDLE);
    expect(usePetStore.getState().recentTaskEvent).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows the last handled event to trigger again after reset', () => {
    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });
    vi.advanceTimersByTime(8_000);
    usePetStore.getState().reset();

    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });

    expect(usePetStore.getState().petState).toBe(PetState.SUCCESS);
    expect(usePetStore.getState().recentTaskEvent).toEqual(finishedEvent);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps the transient state through ordinary updates and restores from latest data', () => {
    usePetStore.getState().updateFromAPI({ task_event: finishedEvent });
    vi.advanceTimersByTime(4_000);

    usePetStore.getState().updateFromAPI({
      wallet: { daily_token_balance: 1, daily_token_limit: 100 },
      tasks: [{ id: 'active', status: 'pending' }],
      online: false,
      error: 'offline cache',
      checked_in: true,
      task_event: null,
    });

    expect(usePetStore.getState().petState).toBe(PetState.SUCCESS);
    expect(usePetStore.getState().recentTaskEvent).toEqual(finishedEvent);

    vi.advanceTimersByTime(4_000);
    expect(usePetStore.getState()).toMatchObject({
      petState: PetState.WORKING,
      online: false,
      error: 'offline cache',
      checkedIn: true,
    });
  });

  it('treats pending tasks as WORKING', () => {
    usePetStore.getState().updateFromAPI({
      tasks: [{ id: 'pending', status: 'pending' }],
    });

    expect(usePetStore.getState().petState).toBe(PetState.WORKING);
  });

  it('does not let offline status override the business state', () => {
    expect(deriveBasePetState(null, [], false)).toBe(PetState.IDLE);
    expect(deriveBasePetState(null, [{ id: 'active', status: 'processing' }], false))
      .toBe(PetState.WORKING);
  });

  it('clears the timer and restores all initial fields on reset', () => {
    usePetStore.getState().updateFromAPI({
      wallet: { daily_token_balance: 1, daily_token_limit: 100 },
      tasks: [{ id: 'active', status: 'processing' }],
      online: false,
      error: 'failed',
      checked_in: true,
      task_event: finishedEvent,
    });
    expect(vi.getTimerCount()).toBe(1);

    usePetStore.getState().reset();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(8_000);

    expect(usePetStore.getState()).toMatchObject({
      wallet: null,
      tasks: [],
      petState: PetState.IDLE,
      online: true,
      error: null,
      checkedIn: null,
      recentTaskEvent: null,
    });
  });

  it('clearTaskEvent clears the timer and immediately restores base state', () => {
    usePetStore.getState().updateFromAPI({
      tasks: [{ id: 'active', status: 'processing' }],
      task_event: errorEvent,
    });

    usePetStore.getState().clearTaskEvent();
    expect(vi.getTimerCount()).toBe(0);
    expect(usePetStore.getState().petState).toBe(PetState.WORKING);
    expect(usePetStore.getState().recentTaskEvent).toBeNull();

    usePetStore.getState().updateFromAPI({ task_event: errorEvent });
    expect(vi.getTimerCount()).toBe(0);
    expect(usePetStore.getState().petState).toBe(PetState.WORKING);

    usePetStore.getState().updateFromAPI({ tasks: [] });
    vi.advanceTimersByTime(8_000);
    expect(usePetStore.getState().petState).toBe(PetState.IDLE);
  });

  it('updates checkedIn and applies an explicit null', () => {
    usePetStore.getState().updateFromAPI({ checked_in: true });
    expect(usePetStore.getState().checkedIn).toBe(true);

    usePetStore.getState().updateFromAPI({ checked_in: null });
    expect(usePetStore.getState().checkedIn).toBeNull();
  });

  it('does not classify the exact ten-percent boundary as QUOTA_LOW', () => {
    expect(deriveBasePetState(
      { daily_token_balance: 10, daily_token_limit: 100 },
      [],
      true,
    )).toBe(PetState.IDLE);
  });

  it('preserves omitted fields and applies explicit nullable fields', () => {
    const { updateFromAPI } = usePetStore.getState();
    updateFromAPI({
      wallet: { daily_token_balance: 500, daily_token_limit: 1000 },
      tasks: [{ id: '1', status: 'processing' }],
      online: false,
      error: 'previous error',
      checked_in: true,
    });

    updateFromAPI({});
    expect(usePetStore.getState()).toMatchObject({
      wallet: { daily_token_balance: 500, daily_token_limit: 1000 },
      tasks: [{ id: '1', status: 'processing' }],
      online: false,
      error: 'previous error',
      checkedIn: true,
    });

    updateFromAPI({ wallet: null, error: null, checked_in: null, task_event: null });
    expect(usePetStore.getState()).toMatchObject({
      wallet: null,
      error: null,
      checkedIn: null,
      recentTaskEvent: null,
    });
  });
});
