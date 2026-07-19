import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { actionAnimations, actionClasses } from './MonkeySprite'
import {
  PetActionGallery,
  assetInventoryStatus,
  startGalleryReplay,
} from './PetActionGallery'

describe('PetActionGallery', () => {
  it('renders the acceptance summary and all four groups', () => {
    const markup = renderToStaticMarkup(createElement(PetActionGallery))

    expect(markup).toContain('MonkeyCode 动作验收展厅')
    expect(markup).toContain('17 个运行时动作')
    expect(markup).toContain('15 张打包贴图')
    for (const label of ['生命形态', '互动动作', '生活动作', '业务状态']) {
      expect(markup).toContain(label)
    }
  })

  it('renders every production action with its class and mapped filename', () => {
    const markup = renderToStaticMarkup(createElement(PetActionGallery))

    for (const [action, asset] of Object.entries(actionAnimations)) {
      const card = markup.match(new RegExp(`<article[^>]+data-action="${action}"[\\s\\S]+?</article>`))?.[0]

      expect(card).toBeDefined()
      expect(card).toContain(actionClasses[action as keyof typeof actionClasses])
      expect(card).toContain(asset.split('/').pop())
    }
  })

  it('renders every packaged asset including auxiliary resources', () => {
    const markup = renderToStaticMarkup(createElement(PetActionGallery))

    expect(markup.match(/data-gallery-asset=/g)).toHaveLength(15)
    expect(markup).toContain('idle.svg')
    expect(markup).toContain('working.svg')
    expect(markup.match(/打包辅助资源/g)).toHaveLength(2)
  })

  it('provides a stable failed-resource status', () => {
    expect(assetInventoryStatus(true, 0, false)).toBe('打包辅助资源')
    expect(assetInventoryStatus(false, 3, false)).toBe('3 个动作引用')
    expect(assetInventoryStatus(false, 3, true)).toBe('资源加载失败')
  })

  it('coordinates replay with reduced-motion changes and cleanup', () => {
    let changeListener: (() => void) | undefined
    const media = {
      matches: true,
      addEventListener: vi.fn((_event: string, listener: () => void) => { changeListener = listener }),
      removeEventListener: vi.fn(),
    }
    const schedule = vi.fn(() => 42)
    const cancel = vi.fn()
    const replay = vi.fn()
    const cleanup = startGalleryReplay(media, replay, schedule, cancel)

    expect(schedule).not.toHaveBeenCalled()
    media.matches = false
    changeListener?.()
    expect(schedule).toHaveBeenCalledWith(replay, 4_800)
    media.matches = true
    changeListener?.()
    expect(cancel).toHaveBeenCalledWith(42)

    cleanup()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('defines responsive and reduced-motion gallery styles', () => {
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

    expect(styles).toContain('.gallery-shell')
    expect(styles).toContain('.gallery-action-grid')
    expect(styles).toContain('@media (max-width: 680px)')
    expect(styles).toMatch(/prefers-reduced-motion[\s\S]+gallery/s)
  })
})
