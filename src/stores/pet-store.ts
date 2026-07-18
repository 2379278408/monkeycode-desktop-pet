import { create } from 'zustand';

export enum PetState {
  IDLE = 'IDLE',
  WORKING = 'WORKING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  QUOTA_LOW = 'QUOTA_LOW',
}

export interface Task {
  id: string;
  title?: string;
  status?: 'processing' | 'pending' | 'finished' | 'error' | string;
  created_at?: number;
}

export interface Wallet {
  balance?: number;
  daily_token_balance?: number;
  daily_token_limit?: number;
}

export interface TaskTerminalEvent {
  task_id: string;
  title?: string;
  status: 'finished' | 'error';
  occurred_at: number;
}

interface PetStoreUpdate {
  wallet?: Wallet | null;
  tasks?: Task[];
  online?: boolean;
  error?: string | null;
  checked_in?: boolean | null;
  task_event?: TaskTerminalEvent | null;
}

export interface PetStoreState {
  wallet: Wallet | null;
  tasks: Task[];
  petState: PetState;
  online: boolean;
  error: string | null;
  checkedIn: boolean | null;
  recentTaskEvent: TaskTerminalEvent | null;
  updateFromAPI: (data: PetStoreUpdate) => void;
  clearTaskEvent: () => void;
  reset: () => void;
}

const TASK_EVENT_DURATION_MS = 8_000;
let taskEventTimer: ReturnType<typeof setTimeout> | null = null;
let lastHandledTaskEventKey: string | null = null;

function clearTaskEventTimer(): void {
  if (taskEventTimer !== null) {
    clearTimeout(taskEventTimer);
    taskEventTimer = null;
  }
}

function taskEventKey(event: TaskTerminalEvent): string {
  return JSON.stringify([event.task_id, event.status, event.occurred_at]);
}

export function deriveBasePetState(
  wallet: Wallet | null,
  tasks: Task[],
  online: boolean,
): PetState {
  void online;

  if (tasks.some((task) => task.status === 'pending' || task.status === 'processing')) {
    return PetState.WORKING;
  }

  const limit = wallet?.daily_token_limit ?? 0;
  if (limit > 0 && (wallet?.daily_token_balance ?? 0) / limit < 0.1) {
    return PetState.QUOTA_LOW;
  }

  return PetState.IDLE;
}

export const usePetStore = create<PetStoreState>((set, get) => ({
  wallet: null,
  tasks: [],
  petState: PetState.IDLE,
  online: true,
  error: null,
  checkedIn: null,
  recentTaskEvent: null,

  updateFromAPI: (data) => {
    const current = get();
    const wallet = data.wallet !== undefined ? data.wallet : current.wallet;
    const tasks = data.tasks !== undefined ? data.tasks : current.tasks;
    const online = data.online !== undefined ? data.online : current.online;
    const error = data.error !== undefined ? data.error : current.error;
    const checkedIn = data.checked_in !== undefined ? data.checked_in : current.checkedIn;
    const nextEvent = data.task_event;
    const nextEventKey = nextEvent ? taskEventKey(nextEvent) : null;

    if (nextEvent && nextEventKey !== lastHandledTaskEventKey) {
      clearTaskEventTimer();
      lastHandledTaskEventKey = nextEventKey;
      const timer = setTimeout(() => {
        if (taskEventTimer !== timer || lastHandledTaskEventKey !== nextEventKey) return;
        get().clearTaskEvent();
      }, TASK_EVENT_DURATION_MS);
      taskEventTimer = timer;
      set({
        wallet,
        tasks,
        online,
        error,
        checkedIn,
        recentTaskEvent: nextEvent,
        petState: nextEvent.status === 'finished' ? PetState.SUCCESS : PetState.ERROR,
      });
      return;
    }

    set({
      wallet,
      tasks,
      online,
      error,
      checkedIn,
      petState: current.recentTaskEvent
        ? current.petState
        : deriveBasePetState(wallet, tasks, online),
    });
  },
  clearTaskEvent: () => {
    clearTaskEventTimer();
    const { wallet, tasks, online } = get();
    set({
      recentTaskEvent: null,
      petState: deriveBasePetState(wallet, tasks, online),
    });
  },
  reset: () => {
    clearTaskEventTimer();
    lastHandledTaskEventKey = null;
    set({
      wallet: null,
      tasks: [],
      petState: PetState.IDLE,
      online: true,
      error: null,
      checkedIn: null,
      recentTaskEvent: null,
    });
  },
}));
