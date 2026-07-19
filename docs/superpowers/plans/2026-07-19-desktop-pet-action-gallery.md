# Desktop Pet Action Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-accessible acceptance gallery that displays all 17 production pet actions and inventories all 15 packaged SVG assets.

**Architecture:** Add a typed gallery catalog as the single source of display metadata, render it through a dedicated React gallery that reuses `MonkeySprite`, and select the gallery from a small root view when `?gallery=1` is present. Keep gallery styles namespaced while retaining the production `.pet-sprite` and `.pet-*` animation classes.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, React DOM server rendering, existing SVG assets and CSS keyframes.

## Global Constraints

- The gallery entry is exactly `/?gallery=1`.
- The gallery displays all 17 runtime `PetAction` values in four groups.
- The asset inventory displays all 15 SVG files under `public/assets/monkey`.
- Production `MonkeySprite`, `actionAnimations`, `actionClasses`, and `actionLabels` remain the source of runtime action behavior.
- Gallery rendering never accesses `window.electronAPI`.
- Existing Electron startup, authentication, IPC, gesture, life-state, and window behavior remain unchanged.
- Gallery CSS uses a `.gallery-*` namespace; production `.pet-*` motion classes are reused unchanged.
- No new runtime or development dependency is added.

---

### Task 1: Typed Gallery Catalog

**Files:**
- Create: `src/lib/pet-action-gallery.ts`
- Test: `src/lib/pet-action-gallery.test.ts`

**Interfaces:**
- Consumes: `PetAction` from `src/lib/pet-action.ts`; `actionAnimations` from `src/components/MonkeySprite.tsx`.
- Produces: `galleryActionGroups`, `galleryAssets`, `galleryAssetUrl(filename)`, `galleryAssetReferences(filename)`, `GalleryActionGroup`, and `GalleryAsset`.

- [x] **Step 1: Write the failing catalog tests**

Create `src/lib/pet-action-gallery.test.ts`:

```ts
import { readFileSync } from 'node:fs'
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
    expect(galleryAssets).toHaveLength(15)
    expect(new Set(galleryAssets.map((asset) => asset.filename)).size).toBe(15)

    for (const asset of galleryAssets) {
      expect(() => readFileSync(
        new URL(`../../public/assets/monkey/${asset.filename}`, import.meta.url),
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
```

- [x] **Step 2: Run the test and verify the missing module failure**

Run: `npm test -- src/lib/pet-action-gallery.test.ts`

Expected: FAIL because `./pet-action-gallery` does not exist.

- [x] **Step 3: Implement the typed catalog**

Create `src/lib/pet-action-gallery.ts`:

```ts
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
```

- [x] **Step 4: Run the catalog tests**

Run: `npm test -- src/lib/pet-action-gallery.test.ts`

Expected: PASS, 4 tests.

- [x] **Step 5: Commit the catalog**

```bash
git add src/lib/pet-action-gallery.ts src/lib/pet-action-gallery.test.ts
git commit -m "feat: 增加桌宠动作展厅目录"
```

---

### Task 2: Gallery Component and Visual Layout

**Files:**
- Create: `src/components/PetActionGallery.tsx`
- Create: `src/components/PetActionGallery.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `galleryActionGroups`, `galleryAssets`, `galleryAssetReferences`, and `galleryAssetUrl` from Task 1; `MonkeySprite`, `actionAnimations`, and `actionLabels` from production code.
- Produces: `PetActionGallery(): JSX.Element`.

- [x] **Step 1: Write failing SSR component tests**

Create `src/components/PetActionGallery.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { actionAnimations, actionClasses } from './MonkeySprite'
import { PetActionGallery, assetInventoryStatus } from './PetActionGallery'

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
      expect(markup).toContain(`data-action="${action}"`)
      expect(markup).toContain(actionClasses[action as keyof typeof actionClasses])
      expect(markup).toContain(asset.split('/').pop())
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

  it('defines responsive and reduced-motion gallery styles', () => {
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

    expect(styles).toContain('.gallery-shell')
    expect(styles).toContain('.gallery-action-grid')
    expect(styles).toContain('@media (max-width: 680px)')
    expect(styles).toMatch(/prefers-reduced-motion[\s\S]+gallery/s)
  })
})
```

- [x] **Step 2: Run the component test and verify it fails**

Run: `npm test -- src/components/PetActionGallery.test.ts`

Expected: FAIL because `PetActionGallery.tsx` does not exist.

- [x] **Step 3: Implement the gallery component**

Create `src/components/PetActionGallery.tsx` with these exact behaviors:

```tsx
import { useEffect, useState } from 'react'
import {
  galleryActionGroups,
  galleryAssetReferences,
  galleryAssets,
  galleryAssetUrl,
} from '../lib/pet-action-gallery'
import type { PetAction } from '../lib/pet-action'
import { MonkeySprite, actionAnimations, actionLabels } from './MonkeySprite'

const finiteActions = new Set<PetAction>([
  'waving',
  'celebrating',
  'petting',
  'dropping',
  'waking',
  'task-success',
  'task-error',
])

function filenameFor(action: PetAction): string {
  return actionAnimations[action].split('/').pop() ?? ''
}

function ActionCard({ action, replay }: { action: PetAction; replay: number }) {
  const filename = filenameFor(action)
  const references = galleryAssetReferences(filename)

  return (
    <article className="gallery-action-card" data-action={action}>
      <div className="gallery-stage">
        <MonkeySprite
          key={finiteActions.has(action) ? `${action}:${replay}` : action}
          action={action}
        />
      </div>
      <div className="gallery-card-copy">
        <h3>{actionLabels[action].replace('MonkeyCode 猴子', '')}</h3>
        <code>{action}</code>
        <p>{filename}</p>
        {references.length > 1 && <span>{references.length} 个动作复用</span>}
      </div>
    </article>
  )
}

export function assetInventoryStatus(
  auxiliary: boolean,
  referenceCount: number,
  failed: boolean,
): string {
  if (failed) return '资源加载失败'
  return auxiliary ? '打包辅助资源' : `${referenceCount} 个动作引用`
}

function AssetCard({ asset }: { asset: (typeof galleryAssets)[number] }) {
  const [failed, setFailed] = useState(false)
  const references = galleryAssetReferences(asset.filename)

  return (
    <article className="gallery-asset-card" data-gallery-asset={asset.filename}>
      {failed
        ? <div className="gallery-asset-error" role="status">资源加载失败</div>
        : (
            <img
              src={galleryAssetUrl(asset.filename)}
              alt=""
              width="96"
              height="96"
              onError={() => setFailed(true)}
            />
          )}
      <code>{asset.filename}</code>
      <span>{assetInventoryStatus(Boolean(asset.auxiliary), references.length, failed)}</span>
    </article>
  )
}

export function PetActionGallery() {
  const [replay, setReplay] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setReplay((value) => value + 1), 4_800)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <main className="gallery-shell">
      <header className="gallery-hero">
        <p className="gallery-eyebrow">DESKTOP PET / 1.2.0</p>
        <h1>MonkeyCode 动作验收展厅</h1>
        <p>直接复用 EXE 的生产贴图映射与 CSS 动画。</p>
        <div className="gallery-stats" aria-label="资源统计">
          <strong>17 个运行时动作</strong>
          <strong>15 张打包贴图</strong>
          <strong>4 类状态分组</strong>
        </div>
      </header>

      {galleryActionGroups.map((group) => (
        <section className="gallery-group" key={group.id} aria-labelledby={`gallery-${group.id}`}>
          <div className="gallery-section-heading">
            <h2 id={`gallery-${group.id}`}>{group.label}</h2>
            <p>{group.description}</p>
          </div>
          <div className="gallery-action-grid">
            {group.actions.map((action) => (
              <ActionCard action={action} replay={replay} key={action} />
            ))}
          </div>
        </section>
      ))}

      <section className="gallery-group" aria-labelledby="gallery-assets">
        <div className="gallery-section-heading">
          <h2 id="gallery-assets">打包资源清单</h2>
          <p>EXE 内包含的全部 SVG 文件及运行时引用关系。</p>
        </div>
        <div className="gallery-asset-grid">
          {galleryAssets.map((asset) => <AssetCard asset={asset} key={asset.filename} />)}
        </div>
      </section>
    </main>
  )
}
```

- [x] **Step 4: Add namespaced responsive gallery styles**

Append a `.gallery-shell` style block to `src/styles.css` that implements:

```css
.gallery-shell {
  box-sizing: border-box;
  height: 100vh;
  min-height: 100vh;
  overflow-y: auto;
  padding: 48px clamp(20px, 5vw, 72px) 80px;
  color: #f4f7fb;
  font-family: Inter, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 12% 4%, rgba(112, 225, 245, .16), transparent 28rem),
    radial-gradient(circle at 88% 18%, rgba(255, 181, 71, .12), transparent 24rem),
    #091017;
}

.gallery-hero,
.gallery-group {
  width: min(1280px, 100%);
  margin-inline: auto;
}

.gallery-eyebrow,
.gallery-card-copy code,
.gallery-asset-card code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}

.gallery-hero h1 {
  max-width: 760px;
  margin: 10px 0 14px;
  font-size: clamp(2.25rem, 6vw, 5.6rem);
  line-height: .94;
}

.gallery-stats,
.gallery-action-grid,
.gallery-asset-grid {
  display: grid;
  gap: 14px;
}

.gallery-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 30px;
}

.gallery-stats strong,
.gallery-action-card,
.gallery-asset-card {
  border: 1px solid rgba(255, 255, 255, .1);
  background: rgba(255, 255, 255, .055);
  box-shadow: inset 0 1px rgba(255, 255, 255, .05);
}

.gallery-stats strong {
  padding: 16px 18px;
  border-radius: 14px;
}

.gallery-group { margin-top: 58px; }
.gallery-section-heading { margin-bottom: 18px; }
.gallery-section-heading h2 { margin: 0 0 6px; font-size: 1.55rem; }
.gallery-section-heading p { margin: 0; color: #9ba9b7; }

.gallery-action-grid {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

.gallery-action-card {
  overflow: hidden;
  border-radius: 20px;
}

.gallery-stage {
  display: grid;
  min-height: 184px;
  place-items: center;
  background: linear-gradient(145deg, rgba(112, 225, 245, .08), rgba(255, 181, 71, .04));
}

.gallery-card-copy { padding: 16px; }
.gallery-card-copy h3 { margin: 0 0 10px; font-size: 1rem; }
.gallery-card-copy p { margin: 8px 0 0; color: #9ba9b7; }
.gallery-card-copy span { display: inline-block; margin-top: 10px; color: #70e1f5; }

.gallery-asset-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.gallery-asset-card {
  display: grid;
  gap: 8px;
  justify-items: center;
  padding: 18px 12px;
  border-radius: 16px;
  text-align: center;
}

.gallery-asset-card span { color: #9ba9b7; font-size: .78rem; }
.gallery-asset-error { display: grid; width: 96px; height: 96px; place-items: center; color: #ff8f9c; font-size: .75rem; }

@media (max-width: 680px) {
  .gallery-shell { padding: 28px 14px 56px; }
  .gallery-stats { grid-template-columns: 1fr; }
  .gallery-action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gallery-stage { min-height: 154px; }
  .gallery-action-card .pet-sprite,
  .gallery-action-card .pet-sprite img { width: 118px; height: 118px; }
}

@media (prefers-reduced-motion: reduce) {
  .gallery-shell *,
  .gallery-shell *::before,
  .gallery-shell *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [x] **Step 5: Run component and catalog tests**

Run: `npm test -- src/components/PetActionGallery.test.ts src/lib/pet-action-gallery.test.ts`

Expected: PASS, 9 tests.

- [x] **Step 6: Commit the gallery UI**

```bash
git add src/components/PetActionGallery.tsx src/components/PetActionGallery.test.ts src/styles.css
git commit -m "feat: 展示桌宠全部状态动作"
```

---

### Task 3: Browser Gallery Entry

**Files:**
- Create: `src/RootView.tsx`
- Create: `src/RootView.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `App` and `PetActionGallery`.
- Produces: `isGalleryMode(search: string): boolean` and `RootView({ search }): JSX.Element`.

- [x] **Step 1: Write failing root selection tests**

Create `src/RootView.test.ts`:

```ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RootView, isGalleryMode } from './RootView'

describe('RootView', () => {
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
```

- [x] **Step 2: Run the root test and verify it fails**

Run: `npm test -- src/RootView.test.ts`

Expected: FAIL because `RootView.tsx` does not exist.

- [x] **Step 3: Implement root selection**

Create `src/RootView.tsx`:

```tsx
import App from './App'
import { PetActionGallery } from './components/PetActionGallery'

export function isGalleryMode(search: string): boolean {
  return new URLSearchParams(search).get('gallery') === '1'
}

export function RootView({ search }: { search: string }) {
  return isGalleryMode(search) ? <PetActionGallery /> : <App />
}
```

Replace `src/main.tsx` with:

```tsx
import { createRoot } from 'react-dom/client'
import { RootView } from './RootView'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <RootView search={window.location.search} />,
)
```

- [x] **Step 4: Run root and gallery tests**

Run: `npm test -- src/RootView.test.ts src/components/PetActionGallery.test.ts src/lib/pet-action-gallery.test.ts`

Expected: PASS, 12 tests.

- [x] **Step 5: Commit the browser entry**

```bash
git add src/RootView.tsx src/RootView.test.ts src/main.tsx
git commit -m "feat: 增加桌宠动作展厅入口"
```

---

### Task 4: Release Gate and Browser Preview

**Files:**
- Modify only files required by concrete verification failures.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-3.
- Produces: a verified `/?gallery=1` preview URL on the Vite development server.

- [x] **Step 1: Run the full release gate**

Run: `npm run verify`

Expected: typecheck passes; all Vitest files pass; Electron bundle verification passes; Vite production build passes.

- [x] **Step 2: Check patch formatting and repository state**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional plan status updates remain.

- [x] **Step 3: Start the bounded gallery preview**

Use the `deploy-website` skill to reuse the repository's managed Vite terminal on port `4174`. Request the platform preview for port `4174` and verify:

```text
/?gallery=1
```

Expected: all four action sections and the 15-asset inventory render without Electron API errors.

- [x] **Step 4: Check desktop and mobile layouts**

Inspect the preview at a desktop viewport and a viewport at or below 680px.

Expected: desktop cards use an adaptive multi-column grid; mobile action cards use two columns; labels remain readable; no horizontal overflow occurs.

- [x] **Step 5: Record final plan completion**

Mark all completed checkboxes in this plan, then commit the status update:

```bash
git add docs/superpowers/plans/2026-07-19-desktop-pet-action-gallery.md
git commit -m "docs: 完成桌宠动作展厅实施计划"
```
