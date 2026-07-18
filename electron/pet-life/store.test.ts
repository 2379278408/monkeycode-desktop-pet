import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePetLifeSnapshot, PetLifeStore } from './store'

const validSnapshot = {
  mood: 50,
  satiety: 60,
  energy: 70,
  sleeping: false,
  lastCalculatedAt: 100,
  lastInteractionAt: 90,
}

const temporaryDirectories: string[] = []

function createStore(): { filePath: string; store: PetLifeStore } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-life-store-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'pet-life.json')
  return { filePath, store: new PetLifeStore(filePath) }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('normalizePetLifeSnapshot', () => {
  it('accepts a valid snapshot', () => {
    expect(normalizePetLifeSnapshot(validSnapshot)).toEqual(validSnapshot)
  })

  it.each([
    null,
    [],
    { mood: '50' },
    { ...validSnapshot, sleeping: 'false' },
    { ...validSnapshot, lastInteractionAt: undefined },
  ])('rejects malformed data %#', (value) => {
    expect(normalizePetLifeSnapshot(value)).toBeNull()
  })

  it.each([
    ['mood', Number.NaN],
    ['satiety', Number.POSITIVE_INFINITY],
    ['energy', Number.NEGATIVE_INFINITY],
    ['lastCalculatedAt', Number.NaN],
    ['lastInteractionAt', Number.POSITIVE_INFINITY],
  ])('rejects non-finite %s', (field, value) => {
    expect(normalizePetLifeSnapshot({ ...validSnapshot, [field]: value })).toBeNull()
  })

  it.each([
    ['lastCalculatedAt', 1.5],
    ['lastInteractionAt', 1.5],
    ['lastCalculatedAt', Number.MAX_VALUE],
    ['lastInteractionAt', Number.MAX_VALUE],
  ])('rejects an invalid %s timestamp', (field, value) => {
    expect(normalizePetLifeSnapshot({ ...validSnapshot, [field]: value })).toBeNull()
  })

  it('clamps negative safe integer timestamps to zero', () => {
    expect(normalizePetLifeSnapshot({
      ...validSnapshot,
      lastCalculatedAt: -100,
      lastInteractionAt: -1,
    })).toEqual({
      ...validSnapshot,
      lastCalculatedAt: 0,
      lastInteractionAt: 0,
    })
  })

  it('clamps life values and strips extra fields', () => {
    expect(normalizePetLifeSnapshot({
      ...validSnapshot,
      mood: -1,
      satiety: 101,
      energy: 150,
      extra: 'discarded',
    })).toEqual({
      ...validSnapshot,
      mood: 0,
      satiety: 100,
      energy: 100,
    })
  })
})

describe('PetLifeStore', () => {
  it('returns null when the file is missing', () => {
    expect(createStore().store.load()).toBeNull()
  })

  it('returns null for damaged JSON without logging its contents', () => {
    const { filePath, store } = createStore()
    const sensitiveContents = '{"secret":"do-not-log"'
    fs.writeFileSync(filePath, sensitiveContents, 'utf8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(store.load()).toBeNull()
    expect(warning).toHaveBeenCalledOnce()
    expect(JSON.stringify(warning.mock.calls)).not.toContain(sensitiveContents)
    expect(warning.mock.calls[0]).toHaveLength(2)
  })

  it('rejects an oversized file without reading its contents', () => {
    const { filePath, store } = createStore()
    fs.writeFileSync(filePath, 's'.repeat(16 * 1024 + 1), 'utf8')
    const readFile = vi.spyOn(fs, 'readFileSync')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(store.load()).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      '[PetLife] 无法读取生命状态',
      'FileTooLargeError: 文件过大',
    )
  })

  it('writes a process-specific temporary file in the same directory then renames it', () => {
    const { filePath, store } = createStore()
    const writeFile = vi.spyOn(fs, 'writeFileSync')
    const rename = vi.spyOn(fs, 'renameSync')
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    store.save({ ...validSnapshot, mood: 120 })

    expect(writeFile).toHaveBeenCalledWith(temporaryPath, expect.any(String), 'utf8')
    expect(path.dirname(temporaryPath)).toBe(path.dirname(filePath))
    expect(rename).toHaveBeenCalledWith(temporaryPath, filePath)
    expect(writeFile.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0])
    expect(fs.existsSync(temporaryPath)).toBe(false)
    expect(store.load()).toEqual({ ...validSnapshot, mood: 100 })
  })

  it('rejects an invalid save', () => {
    const { store } = createStore()
    expect(() => store.save({ ...validSnapshot, energy: Number.NaN })).toThrow(
      '无效桌宠生命状态',
    )
  })
})
