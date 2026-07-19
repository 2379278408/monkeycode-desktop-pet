import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { actionAnimations } from '../components/MonkeySprite'
import {
  galleryActionGroups,
  galleryAssetReferences,
  galleryAssets,
} from './pet-action-gallery'

describe('pet action gallery catalog', () => {
  it('contains every production action exactly once in four groups', () => {
    const actions = galleryActionGroups.flatMap((group) => group.actions)

    expect(galleryActionGroups).toHaveLength(4)
    expect(actions).toHaveLength(17)
    expect(new Set(actions).size).toBe(17)
    expect([...actions].sort()).toEqual(Object.keys(actionAnimations).sort())
  })

  it('inventories all 15 packaged SVG assets', () => {
    const assetDirectory = new URL('../../public/assets/monkey/', import.meta.url)
    const packagedAssets = readdirSync(assetDirectory)
      .filter((filename) => filename.endsWith('.svg'))
      .sort()

    expect(galleryAssets).toHaveLength(15)
    expect(new Set(galleryAssets.map((asset) => asset.filename)).size).toBe(15)
    expect(galleryAssets.map((asset) => asset.filename).sort()).toEqual(packagedAssets)

    for (const asset of galleryAssets) {
      expect(() => readFileSync(
        new URL(asset.filename, assetDirectory),
        'utf8',
      )).not.toThrow()
    }
  })

  it('marks idle and working as packaged auxiliary assets', () => {
    expect(galleryAssets.filter((asset) => asset.auxiliary).map((asset) => asset.filename))
      .toEqual(['idle.svg', 'working.svg'])
    expect(galleryAssetReferences('idle.svg')).toEqual([])
    expect(galleryAssetReferences('working.svg')).toEqual([])
  })

  it('reports shared production resource references', () => {
    expect(galleryAssetReferences('happy.svg'))
      .toEqual(['happy', 'celebrating', 'waking'])
    expect(galleryAssetReferences('normal.svg')).toEqual(['normal', 'dropping'])
    expect(galleryAssetReferences('sleepy.svg')).toEqual(['sleepy', 'falling-asleep'])
  })
})
