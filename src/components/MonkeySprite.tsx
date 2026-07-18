import { usePetStore, PetState } from '../stores/pet-store';

const idleAnimation = `${import.meta.env.BASE_URL}assets/monkey/idle.svg`;

const stateAnimations: Record<PetState, string> = {
  [PetState.IDLE]: idleAnimation,
  [PetState.WORKING]: idleAnimation,
  [PetState.SUCCESS]: idleAnimation,
  [PetState.ERROR]: idleAnimation,
  [PetState.QUOTA_LOW]: idleAnimation,
};

export function MonkeySprite() {
  const petState = usePetStore((s) => s.petState);
  const src = stateAnimations[petState];

  return (
    <div
      style={{
        cursor: 'pointer',
        width: 140,
        height: 140,
        animation: 'monkey-float 2.6s ease-in-out infinite',
      }}
    >
      <img
        src={src}
        alt="MonkeyCode monkey"
        draggable={false}
        style={{ width: 140, height: 140, display: 'block' }}
      />
    </div>
  );
}
