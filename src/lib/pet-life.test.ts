import { describe, expect, it } from 'vitest'
import {
  applyPetEvent,
  derivePetForm,
  settlePetLife,
  type PetForm,
  type PetLifeSnapshot,
} from './pet-life'

const HOUR_MS = 3_600_000

const base: PetLifeSnapshot = {
  mood: 50,
  satiety: 50,
  energy: 50,
  sleeping: false,
  lastCalculatedAt: 0,
  lastInteractionAt: 0,
}

describe('settlePetLife', () => {
  it('settles one awake hour', () => {
    expect(settlePetLife(base, HOUR_MS)).toMatchObject({ satiety: 48, energy: 48.5 })
  })

  it('restores energy without reducing satiety while sleeping', () => {
    expect(settlePetLife({ ...base, sleeping: true }, HOUR_MS)).toMatchObject({
      satiety: 50,
      energy: 58,
    })
  })

  it('reduces mood only after six hours without interaction', () => {
    expect(settlePetLife(base, 6 * HOUR_MS).mood).toBe(50)
    expect(settlePetLife(base, 8 * HOUR_MS).mood).toBe(48)
  })

  it('caps offline settlement at exactly 72 hours', () => {
    const settled = settlePetLife({ ...base, mood: 100 }, 100 * HOUR_MS)

    expect(settled).toMatchObject({
      mood: 28,
      satiety: 0,
      energy: 0,
      lastCalculatedAt: 100 * HOUR_MS,
    })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'ignores a non-finite current time: %s',
    (now) => {
      expect(settlePetLife(base, now)).toEqual(base)
    },
  )

  it('ignores a backwards clock', () => {
    expect(settlePetLife({ ...base, lastCalculatedAt: 10_000 }, 5_000)).toEqual({
      ...base,
      lastCalculatedAt: 10_000,
    })
  })

  it('is idempotent when settling repeatedly at the same time', () => {
    const settled = settlePetLife(base, 8 * HOUR_MS)

    expect(settlePetLife(settled, 8 * HOUR_MS)).toEqual(settled)
  })
})

describe('derivePetForm', () => {
  it.each<[PetForm, Partial<PetLifeSnapshot>]>([
    ['normal', {}],
    ['happy', { mood: 70 }],
    ['sad', { mood: 30 }],
    ['hungry', { satiety: 25 }],
    ['sleepy', { energy: 20 }],
    ['sleeping', { sleeping: true }],
  ])('derives the %s form', (form, values) => {
    expect(derivePetForm({ ...base, ...values }, 'normal')).toBe(form)
  })

  it('prioritizes sleeping, hungry, sleepy, sad, then happy', () => {
    const critical = { ...base, mood: 80, satiety: 10, energy: 10 }

    expect(derivePetForm({ ...critical, sleeping: true }, 'normal')).toBe('sleeping')
    expect(derivePetForm(critical, 'normal')).toBe('hungry')
    expect(derivePetForm({ ...critical, satiety: 50 }, 'normal')).toBe('sleepy')
    expect(derivePetForm({ ...critical, satiety: 50, energy: 50, mood: 20 }, 'normal')).toBe('sad')
  })

  it.each<[PetForm, keyof PetLifeSnapshot, number, number]>([
    ['hungry', 'satiety', 35, 36],
    ['sleepy', 'energy', 35, 36],
    ['sad', 'mood', 40, 41],
    ['happy', 'mood', 60, 59],
  ])('uses hysteresis for %s form', (form, field, retainedValue, exitValue) => {
    expect(derivePetForm({ ...base, [field]: retainedValue }, form)).toBe(form)
    expect(derivePetForm({ ...base, [field]: exitValue }, form)).toBe('normal')
  })
})

describe('applyPetEvent', () => {
  it('applies interactions and life operations', () => {
    expect(applyPetEvent(base, { type: 'click' }, 0)).toMatchObject({ mood: 51, lastInteractionAt: 0 })
    expect(applyPetEvent(base, { type: 'double-click' }, 0)).toMatchObject({ mood: 53 })
    expect(applyPetEvent(base, { type: 'pet', seconds: 12 }, 0)).toMatchObject({ mood: 55 })
    expect(applyPetEvent(base, { type: 'feed' }, 0)).toMatchObject({ satiety: 75, mood: 52 })
    expect(applyPetEvent(base, { type: 'sleep' }, 0)).toMatchObject({ sleeping: true })
    expect(applyPetEvent({ ...base, sleeping: true }, { type: 'wake' }, 0)).toMatchObject({ sleeping: false })
    expect(applyPetEvent(base, { type: 'task-success' }, 0)).toMatchObject({ mood: 52 })
    expect(applyPetEvent(base, { type: 'task-error' }, 0)).toMatchObject({ mood: 48 })
  })

  it('clamps event results to the 0-100 range', () => {
    expect(applyPetEvent({ ...base, mood: 99, satiety: 90 }, { type: 'feed' }, 1)).toMatchObject({
      mood: 100,
      satiety: 100,
    })
    expect(applyPetEvent({ ...base, mood: 1 }, { type: 'task-error' }, 1).mood).toBe(0)
  })

  it('keeps interaction time monotonic when the clock moves backwards', () => {
    const snapshot = { ...base, lastCalculatedAt: 10_000, lastInteractionAt: 10_000 }

    expect(applyPetEvent(snapshot, { type: 'click' }, 5_000).lastInteractionAt).toBe(10_000)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'ignores invalid pet duration: %s',
    (seconds) => {
      expect(applyPetEvent(base, { type: 'pet', seconds }, 0)).toMatchObject({ mood: 50 })
    },
  )
})
