import { actionAnimations } from '../components/MonkeySprite'
import type { PetAction } from './pet-action'

export interface GalleryActionGroup {
  id: 'forms' | 'interactions' | 'life' | 'business'
  label: string
  description: string
  actions: readonly PetAction[]
}

export interface GalleryAsset {
  filename: `${string}.svg`
  auxiliary?: true
}

export const galleryActionGroups = [
  {
    id: 'forms',
    label: '生命形态',
    description: '由心情、饱食度、精力和睡眠状态决定',
    actions: ['normal', 'happy', 'sad', 'hungry', 'sleepy', 'sleeping'],
  },
  {
    id: 'interactions',
    label: '互动动作',
    description: '点击、双击、抚摸和拖动产生的即时反馈',
    actions: ['waving', 'celebrating', 'petting', 'dragging', 'dropping'],
  },
  {
    id: 'life',
    label: '生活动作',
    description: '喂食、入睡和唤醒过程',
    actions: ['eating', 'falling-asleep', 'waking'],
  },
  {
    id: 'business',
    label: '业务状态',
    description: '任务结果和额度提醒',
    actions: ['task-success', 'task-error', 'quota-low'],
  },
] as const satisfies readonly GalleryActionGroup[]

export const galleryAssets: readonly GalleryAsset[] = [
  { filename: 'normal.svg' },
  { filename: 'happy.svg' },
  { filename: 'sad.svg' },
  { filename: 'hungry.svg' },
  { filename: 'sleepy.svg' },
  { filename: 'sleeping.svg' },
  { filename: 'waving.svg' },
  { filename: 'petting.svg' },
  { filename: 'dragging.svg' },
  { filename: 'eating.svg' },
  { filename: 'success.svg' },
  { filename: 'error.svg' },
  { filename: 'quota-low.svg' },
  { filename: 'idle.svg', auxiliary: true },
  { filename: 'working.svg', auxiliary: true },
]

export function galleryAssetUrl(filename: string): string {
  return `${import.meta.env.BASE_URL}assets/monkey/${filename}`
}

export function galleryAssetReferences(filename: string): PetAction[] {
  return galleryActionGroups
    .flatMap((group) => group.actions)
    .filter((action) => actionAnimations[action].endsWith(`/${filename}`))
}
