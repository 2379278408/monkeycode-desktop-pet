import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RootView, isGalleryMode } from './RootView'

describe('RootView', () => {
  it('declares a responsive mobile viewport', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

    expect(html).toContain('name="viewport"')
    expect(html).toContain('content="width=device-width, initial-scale=1"')
  })

  it('recognizes only the explicit gallery query value', () => {
    expect(isGalleryMode('?gallery=1')).toBe(true)
    expect(isGalleryMode('?source=test&gallery=1')).toBe(true)
    expect(isGalleryMode('')).toBe(false)
    expect(isGalleryMode('?gallery=0')).toBe(false)
    expect(isGalleryMode('?gallery=true')).toBe(false)
  })

  it('renders the gallery without requiring Electron APIs', () => {
    const markup = renderToStaticMarkup(createElement(RootView, { search: '?gallery=1' }))

    expect(markup).toContain('MonkeyCode 动作验收展厅')
    expect(markup).toContain('data-action="normal"')
  })

  it('keeps the normal application as the default root', () => {
    const markup = renderToStaticMarkup(createElement(RootView, { search: '' }))

    expect(markup).not.toContain('MonkeyCode 动作验收展厅')
    expect(markup).toContain('Loading...')
  })
})
