import type { PetAction } from '../lib/pet-action'
import type { PetForm } from '../lib/pet-life'

const monkeyAsset = (name: string) => `${import.meta.env.BASE_URL}assets/monkey/${name}.svg`

export const actionAnimations: Record<PetAction, string> = {
  normal: monkeyAsset('normal'),
  happy: monkeyAsset('happy'),
  sad: monkeyAsset('sad'),
  hungry: monkeyAsset('hungry'),
  sleepy: monkeyAsset('sleepy'),
  sleeping: monkeyAsset('sleeping'),
  waving: monkeyAsset('waving'),
  celebrating: monkeyAsset('happy'),
  petting: monkeyAsset('petting'),
  dragging: monkeyAsset('dragging'),
  dropping: monkeyAsset('normal'),
  eating: monkeyAsset('eating'),
  'falling-asleep': monkeyAsset('sleepy'),
  waking: monkeyAsset('happy'),
  'task-success': monkeyAsset('success'),
  'task-error': monkeyAsset('error'),
  'quota-low': monkeyAsset('quota-low'),
}

export const actionClasses: Record<PetAction, string> = {
  normal: 'pet-normal',
  happy: 'pet-happy',
  sad: 'pet-sad',
  hungry: 'pet-hungry',
  sleepy: 'pet-sleepy',
  sleeping: 'pet-sleeping',
  waving: 'pet-waving',
  celebrating: 'pet-celebrating',
  petting: 'pet-petting',
  dragging: 'pet-dragging',
  dropping: 'pet-dropping',
  eating: 'pet-eating',
  'falling-asleep': 'pet-falling-asleep',
  waking: 'pet-waking',
  'task-success': 'pet-success',
  'task-error': 'pet-error',
  'quota-low': 'pet-quota-low',
}

export const actionLabels: Record<PetAction, string> = {
  normal: 'MonkeyCode 猴子状态正常',
  happy: 'MonkeyCode 猴子心情开心',
  sad: 'MonkeyCode 猴子心情低落',
  hungry: 'MonkeyCode 猴子肚子饿了',
  sleepy: 'MonkeyCode 猴子感到困倦',
  sleeping: 'MonkeyCode 猴子正在睡觉',
  waving: 'MonkeyCode 猴子正在挥手',
  celebrating: 'MonkeyCode 猴子正在庆祝',
  petting: 'MonkeyCode 猴子正在享受抚摸',
  dragging: 'MonkeyCode 猴子正在被拖动',
  dropping: 'MonkeyCode 猴子刚刚落下',
  eating: 'MonkeyCode 猴子正在吃东西',
  'falling-asleep': 'MonkeyCode 猴子正在入睡',
  waking: 'MonkeyCode 猴子正在醒来',
  'task-success': 'MonkeyCode 猴子正在庆祝任务完成',
  'task-error': 'MonkeyCode 猴子提示任务失败',
  'quota-low': 'MonkeyCode 猴子提示今日额度偏低',
}

export const stateLabels = {
  IDLE: actionLabels.normal,
  WORKING: 'MonkeyCode 猴子正在处理任务',
  SUCCESS: actionLabels['task-success'],
  ERROR: actionLabels['task-error'],
  QUOTA_LOW: actionLabels['quota-low'],
}

interface MonkeySpriteProps {
  action: PetAction
  fallbackAction?: PetForm
}

interface SpriteFallbackTarget {
  src: string
  dataset: {
    spriteFallbackApplied?: string
  }
}

function assetFilename(asset: string): string | undefined {
  return asset.split(/[?#]/, 1)[0].split('/').pop()
}

export function applySpriteFallback(
  image: SpriteFallbackTarget,
  fallbackAction: PetForm = 'normal',
): void {
  const fallbackAsset = actionAnimations[fallbackAction]
  if (image.dataset.spriteFallbackApplied === 'true'
    || assetFilename(image.src) === assetFilename(fallbackAsset)) return

  image.dataset.spriteFallbackApplied = 'true'
  image.src = fallbackAsset
}

export function MonkeySprite({ action, fallbackAction = 'normal' }: MonkeySpriteProps) {
  return (
    <div
      className={`pet-sprite ${actionClasses[action]}`}
      aria-hidden="true"
    >
      <img
        key={`${action}:${fallbackAction}`}
        src={actionAnimations[action]}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={140}
        height={140}
        onError={(event) => applySpriteFallback(event.currentTarget, fallbackAction)}
      />
    </div>
  )
}
