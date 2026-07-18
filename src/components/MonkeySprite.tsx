import { PetState, usePetStore } from '../stores/pet-store'

const monkeyAsset = (name: string) => `${import.meta.env.BASE_URL}assets/monkey/${name}.svg`

export const stateAnimations: Record<PetState, string> = {
  [PetState.IDLE]: monkeyAsset('idle'),
  [PetState.WORKING]: monkeyAsset('working'),
  [PetState.SUCCESS]: monkeyAsset('success'),
  [PetState.ERROR]: monkeyAsset('error'),
  [PetState.QUOTA_LOW]: monkeyAsset('quota-low'),
}

export const stateClasses: Record<PetState, string> = {
  [PetState.IDLE]: 'pet-idle',
  [PetState.WORKING]: 'pet-working',
  [PetState.SUCCESS]: 'pet-success',
  [PetState.ERROR]: 'pet-error',
  [PetState.QUOTA_LOW]: 'pet-quota-low',
}

export const stateLabels: Record<PetState, string> = {
  [PetState.IDLE]: 'MonkeyCode 猴子当前空闲',
  [PetState.WORKING]: 'MonkeyCode 猴子正在处理任务',
  [PetState.SUCCESS]: 'MonkeyCode 猴子正在庆祝任务完成',
  [PetState.ERROR]: 'MonkeyCode 猴子提示任务失败',
  [PetState.QUOTA_LOW]: 'MonkeyCode 猴子提示今日额度偏低',
}

export function MonkeySprite() {
  const petState = usePetStore((state) => state.petState)

  return (
    <div
      className={`pet-sprite ${stateClasses[petState]}`}
      aria-hidden="true"
    >
      <img
        src={stateAnimations[petState]}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={140}
        height={140}
      />
    </div>
  )
}
