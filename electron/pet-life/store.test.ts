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

  it('rejects negative safe integer timestamps', () => {
    expect(normalizePetLifeSnapshot({
      ...validSnapshot,
      lastCalculatedAt: -100,
      lastInteractionAt: -1,
    })).toBeNull()
  })

  it('accepts one hour of future clock skew and rejects timestamps beyond 24 hours', () => {
    const wallNow = 1_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(wallNow)

    expect(normalizePetLifeSnapshot({
      ...validSnapshot,
      lastCalculatedAt: wallNow + 60 * 60_000,
      lastInteractionAt: wallNow,
    })).toMatchObject({ lastCalculatedAt: wallNow + 60 * 60_000 })
    expect(normalizePetLifeSnapshot({
      ...validSnapshot,
      lastCalculatedAt: wallNow + 24 * 60 * 60_000 + 1,
      lastInteractionAt: wallNow,
    })).toBeNull()
    expect(normalizePetLifeSnapshot({
      ...validSnapshot,
      lastCalculatedAt: Number.MAX_SAFE_INTEGER,
      lastInteractionAt: wallNow,
    })).toBeNull()
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
    const { store } = createStore()
    const stat = vi.spyOn(fs, 'statSync')
    const exists = vi.spyOn(fs, 'existsSync')

    expect(store.load()).toBeNull()
    expect(stat).toHaveBeenCalledOnce()
    expect(exists).not.toHaveBeenCalled()
  })

  it('returns null without warning when the file disappears before stat', () => {
    const { store } = createStore()
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    vi.spyOn(fs, 'statSync').mockImplementation(() => { throw error })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(store.load()).toBeNull()
    expect(warning).not.toHaveBeenCalled()
  })

  it('returns null without warning when the file disappears between stat and read', () => {
    const { filePath, store } = createStore()
    fs.writeFileSync(filePath, JSON.stringify(validSnapshot), 'utf8')
    const error = Object.assign(new Error('missing during read'), { code: 'ENOENT' })
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw error })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(store.load()).toBeNull()
    expect(warning).not.toHaveBeenCalled()
  })

  it('throws a fixed error for stat permission failures with a redacted warning', () => {
    const { filePath, store } = createStore()
    const error = Object.assign(new Error(`permission denied: ${filePath}`), { code: 'EACCES' })
    vi.spyOn(fs, 'statSync').mockImplementation(() => { throw error })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => store.load()).toThrowError('桌宠生命状态读取失败')
    expect(warning).toHaveBeenCalledWith(
      '[PetLife] 无法读取生命状态',
      'Error: 文件读取失败',
    )
    expect(JSON.stringify(warning.mock.calls)).not.toContain(filePath)
  })

  it('throws a fixed error for damaged JSON without logging its path or contents', () => {
    const { filePath, store } = createStore()
    const sensitiveContents = '{"secret":"do-not-log"'
    fs.writeFileSync(filePath, sensitiveContents, 'utf8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => store.load()).toThrowError('桌宠生命状态读取失败')
    expect(warning).toHaveBeenCalledOnce()
    expect(JSON.stringify(warning.mock.calls)).not.toContain(sensitiveContents)
    expect(JSON.stringify(warning.mock.calls)).not.toContain(filePath)
    expect(warning.mock.calls[0]).toHaveLength(2)
  })

  it('throws a fixed error for an oversized file without reading or leaking its contents', () => {
    const { filePath, store } = createStore()
    fs.writeFileSync(filePath, 's'.repeat(16 * 1024 + 1), 'utf8')
    const readFile = vi.spyOn(fs, 'readFileSync')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => store.load()).toThrowError('桌宠生命状态读取失败')
    expect(readFile).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      '[PetLife] 无法读取生命状态',
      'FileTooLargeError: 文件过大',
    )
    expect(JSON.stringify(warning.mock.calls)).not.toContain(filePath)
    expect(JSON.stringify(warning.mock.calls)).not.toContain('ssssssss')
  })

  it('throws a fixed error when reading fails without logging the original error or path', () => {
    const { filePath, store } = createStore()
    fs.writeFileSync(filePath, JSON.stringify(validSnapshot), 'utf8')
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error(`permission denied: ${filePath}`)
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => store.load()).toThrowError('桌宠生命状态读取失败')
    const warningText = JSON.stringify(warning.mock.calls)
    expect(warningText).not.toContain(filePath)
    expect(warningText).not.toContain('permission denied')
    expect(warning).toHaveBeenCalledWith(
      '[PetLife] 无法读取生命状态',
      'Error: 文件读取失败',
    )
  })

  it('throws a fixed error when parsed data cannot be normalized', () => {
    const { filePath, store } = createStore()
    fs.writeFileSync(filePath, JSON.stringify({ ...validSnapshot, energy: 'secret-invalid' }), 'utf8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => store.load()).toThrowError('桌宠生命状态读取失败')
    expect(warning).toHaveBeenCalledWith(
      '[PetLife] 无法读取生命状态',
      'InvalidSnapshotError: 数据格式无效',
    )
    expect(JSON.stringify(warning.mock.calls)).not.toContain('secret-invalid')
    expect(JSON.stringify(warning.mock.calls)).not.toContain(filePath)
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
      '桌宠生命状态保存失败',
    )
  })
})
