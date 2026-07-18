import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PetAction } from '../lib/pet-action'
import {
  MonkeySprite,
  actionAnimations,
  actionClasses,
  actionLabels,
  applySpriteFallback,
} from './MonkeySprite'

const allActions = [
  'normal',
  'happy',
  'sad',
  'hungry',
  'sleepy',
  'sleeping',
  'waving',
  'celebrating',
  'petting',
  'dragging',
  'dropping',
  'eating',
  'falling-asleep',
  'waking',
  'task-success',
  'task-error',
  'quota-low',
] as const satisfies readonly PetAction[]

const requiredAssets = [
  'normal.svg',
  'happy.svg',
  'sad.svg',
  'hungry.svg',
  'sleepy.svg',
  'sleeping.svg',
  'waving.svg',
  'petting.svg',
  'dragging.svg',
  'eating.svg',
] as const

const expectedAssets: Record<PetAction, string> = {
  normal: 'normal.svg',
  happy: 'happy.svg',
  sad: 'sad.svg',
  hungry: 'hungry.svg',
  sleepy: 'sleepy.svg',
  sleeping: 'sleeping.svg',
  waving: 'waving.svg',
  celebrating: 'happy.svg',
  petting: 'petting.svg',
  dragging: 'dragging.svg',
  dropping: 'normal.svg',
  eating: 'eating.svg',
  'falling-asleep': 'sleepy.svg',
  waking: 'happy.svg',
  'task-success': 'success.svg',
  'task-error': 'error.svg',
  'quota-low': 'quota-low.svg',
}

const assetFilename = (asset: string) => {
  const segments = asset.split('/')
  return segments[segments.length - 1]
}

describe('MonkeySprite action resources', () => {
  if (false) {
    // @ts-expect-error MonkeySprite requires an explicit production action.
    createElement(MonkeySprite, {})
  }

  it('exhaustively maps every pet action', () => {
    const expectedKeys = [...allActions].sort()

    expect(Object.keys(actionAnimations).sort()).toEqual(expectedKeys)
    expect(Object.keys(actionClasses).sort()).toEqual(expectedKeys)
    expect(Object.keys(actionLabels).sort()).toEqual(expectedKeys)
  })

  it('uses the expected dedicated and explicitly reused resources', () => {
    for (const action of allActions) {
      expect(assetFilename(actionAnimations[action])).toBe(expectedAssets[action])
    }
  })

  it('ships every mapped resource and every required new resource', () => {
    for (const asset of Object.values(actionAnimations)) {
      const filename = assetFilename(asset)
      expect(filename).toBeTruthy()
      expect(() => readFileSync(
        new URL(`../../public/assets/monkey/${filename}`, import.meta.url),
        'utf8',
      )).not.toThrow()
    }

    for (const filename of requiredAssets) {
      expect(() => readFileSync(
        new URL(`../../public/assets/monkey/${filename}`, import.meta.url),
        'utf8',
      )).not.toThrow()
    }
  })

  it('defines every action motion class', () => {
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

    for (const className of new Set(Object.values(actionClasses))) {
      expect(styles).toMatch(new RegExp(`\\.${className}(?:\\s|,|\\{)`))
    }
    expect(styles).toContain("img[data-sprite-fallback-applied='true']")
    expect(styles).toMatch(/data-sprite-fallback-applied[^}]+animation:\s*none\s*!important/s)
  })

  it('provides an explicit Chinese label for every action', () => {
    for (const label of Object.values(actionLabels)) {
      expect(label).toMatch(/^MonkeyCode 猴子[\u3400-\u9fff]/u)
    }
  })

  it('renders the selected action as a hidden non-draggable 140px image', () => {
    const markup = renderToStaticMarkup(createElement(MonkeySprite, { action: 'waving' }))

    expect(markup).toContain('class="pet-sprite pet-waving"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('waving.svg')
    expect(markup).toContain('width="140"')
    expect(markup).toContain('height="140"')
    expect(markup).toContain('draggable="false"')
  })

  it('replaces a broken action asset with the requested form fallback once', () => {
    const image = {
      src: 'https://app.test/assets/monkey/waving.svg',
      dataset: {} as Record<string, string | undefined>,
    }

    applySpriteFallback(image, 'happy')

    expect(image.src).toBe(actionAnimations.happy)
    expect(image.dataset.spriteFallbackApplied).toBe('true')

    const fallbackSource = image.src
    applySpriteFallback(image, 'happy')
    expect(image.src).toBe(fallbackSource)
  })

  it('leaves an already failing fallback asset unchanged', () => {
    const image = {
      src: 'https://app.test/assets/monkey/normal.svg',
      dataset: {} as Record<string, string | undefined>,
    }

    applySpriteFallback(image, 'normal')

    expect(image.src).toBe('https://app.test/assets/monkey/normal.svg')
    expect(image.dataset.spriteFallbackApplied).toBeUndefined()
  })

  it('keeps new SVGs self-contained and on the 160px canvas', () => {
    for (const filename of requiredAssets) {
      const svg = readFileSync(
        new URL(`../../public/assets/monkey/${filename}`, import.meta.url),
        'utf8',
      )

      expect(svg).toMatch(/<svg\b[^>]*viewBox=["']0 0 160 160["']/i)
      expect(svg).not.toMatch(/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<image\b/i)
      expect(svg).not.toMatch(/\son[a-z][\w:-]*\s*=/i)
      expect(svg).not.toMatch(/javascript\s*:/i)
      expect(svg).not.toMatch(/(?:href|xlink:href)\s*=/i)
      expect(svg).toContain('#8b5a3c')
      expect(svg).toContain('#563321')
      expect(svg).toContain('#151a27')
      expect(svg).toContain('#70e1f5')
    }
  })
})
