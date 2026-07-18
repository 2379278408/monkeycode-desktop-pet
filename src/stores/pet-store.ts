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

export interface PetStoreState {
  wallet: Wallet | null;
  tasks: Task[];
  petState: PetState;
  online: boolean;
  error: string | null;
  updateFromAPI: (data: {
    wallet?: Wallet | null;
    tasks?: Task[];
    online?: boolean;
    error?: string | null;
  }) => void;
  reset: () => void;
}

export const usePetStore = create<PetStoreState>((set) => ({
  wallet: null,
  tasks: [],
  petState: PetState.IDLE,
  online: true,
  error: null,

  updateFromAPI: (data) => {
    const wallet = data.wallet ?? null;
    const tasks = data.tasks ?? [];

    let petState = PetState.IDLE;

    const hasProcessing = tasks.some((t) => t.status === 'processing');
    const hasError = tasks.some((t) => t.status === 'error');
    const hasFinished = tasks.some((t) => t.status === 'finished');

    if (hasProcessing) {
      petState = PetState.WORKING;
    } else if (hasError) {
      petState = PetState.ERROR;
    } else if (hasFinished) {
      petState = PetState.SUCCESS;
    } else if (
      wallet &&
      (wallet.daily_token_limit ?? 0) > 0 &&
      (wallet.daily_token_balance ?? 0) / (wallet.daily_token_limit ?? 1) < 0.1
    ) {
      petState = PetState.QUOTA_LOW;
    }

    set({
      wallet,
      tasks,
      petState,
      online: data.online ?? true,
      error: data.error ?? null,
    });
  },
  reset: () => set({
    wallet: null,
    tasks: [],
    petState: PetState.IDLE,
    online: true,
    error: null,
  }),
}));
