import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PetState } from '../stores/pet-store'
import { stateAnimations, stateClasses, stateLabels } from './MonkeySprite'

describe('MonkeySprite state resources', () => {
  it('maps every pet state to a distinct SVG resource', () => {
    expect(Object.keys(stateAnimations).sort()).toEqual(Object.values(PetState).sort())
    expect(new Set(Object.values(stateAnimations)).size).toBe(5)
    expect(Object.values(stateAnimations).every((asset) => asset.endsWith('.svg'))).toBe(true)
  })

  it('maps every pet state to a distinct motion class', () => {
    expect(Object.keys(stateClasses).sort()).toEqual(Object.values(PetState).sort())
    expect(new Set(Object.values(stateClasses)).size).toBe(5)
    expect(Object.values(stateClasses).every((className) => className.startsWith('pet-'))).toBe(true)
  })

  it('ships every mapped SVG and defines every motion class', () => {
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

    for (const asset of Object.values(stateAnimations)) {
      const segments = asset.split('/')
      const filename = segments[segments.length - 1]
      expect(filename).toBeTruthy()
      expect(() => readFileSync(
        new URL(`../../public/assets/monkey/${filename}`, import.meta.url),
        'utf8',
      )).not.toThrow()
    }
    for (const className of Object.values(stateClasses)) {
      expect(styles).toContain(`.${className}`)
    }
  })

  it('provides a status label for every pet state', () => {
    expect(Object.keys(stateLabels).sort()).toEqual(Object.values(PetState).sort())
    expect(Object.values(stateLabels).every((label) => label.startsWith('MonkeyCode 猴子'))).toBe(true)
  })
})
