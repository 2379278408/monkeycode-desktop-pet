import { DotLottie } from '@lottiefiles/dotlottie-react';
import { usePetStore, PetState } from '../stores/pet-store';

const stateAnimations: Record<PetState, string> = {
  [PetState.IDLE]: '/assets/monkey/idle.json',
  [PetState.WORKING]: '/assets/monkey/idle.json',
  [PetState.SUCCESS]: '/assets/monkey/idle.json',
  [PetState.ERROR]: '/assets/monkey/idle.json',
  [PetState.QUOTA_LOW]: '/assets/monkey/idle.json',
};

export function MonkeySprite() {
  const petState = usePetStore((s) => s.petState);
  const src = stateAnimations[petState];

  return (
    <div style={{ cursor: 'pointer', width: 120, height: 120 }}>
      <DotLottie src={src} loop autoplay style={{ width: 120, height: 120 }} />
    </div>
  );
}
