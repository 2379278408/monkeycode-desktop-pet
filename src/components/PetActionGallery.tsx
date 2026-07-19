import { useEffect, useState } from 'react'
import {
  galleryActionGroups,
  galleryAssetReferences,
  galleryAssets,
  galleryAssetUrl,
} from '../lib/pet-action-gallery'
import type { GalleryAsset } from '../lib/pet-action-gallery'
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

interface ReplayMediaQuery {
  matches: boolean
  addEventListener: (type: 'change', listener: () => void) => void
  removeEventListener: (type: 'change', listener: () => void) => void
}

export function startGalleryReplay(
  media: ReplayMediaQuery,
  replay: () => void,
  schedule: (callback: () => void, delay: number) => number = window.setInterval,
  cancel: (timer: number) => void = window.clearInterval,
): () => void {
  let timer: number | undefined

  const sync = () => {
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    if (!media.matches) timer = schedule(replay, 4_800)
  }

  media.addEventListener('change', sync)
  sync()

  return () => {
    media.removeEventListener('change', sync)
    if (timer !== undefined) cancel(timer)
  }
}

function filenameFor(action: PetAction): string {
  return actionAnimations[action].split('/').pop() ?? ''
}

function ActionCard({ action, replay }: { action: PetAction; replay: number }) {
  const filename = filenameFor(action)
  const references = galleryAssetReferences(filename)

  return (
    <article
      className="gallery-action-card"
      data-action={action}
      aria-label={actionLabels[action]}
    >
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

function AssetCard({ asset }: { asset: GalleryAsset }) {
  const [failed, setFailed] = useState(false)
  const references = galleryAssetReferences(asset.filename)
  const status = assetInventoryStatus(Boolean(asset.auxiliary), references.length, failed)

  return (
    <article className="gallery-asset-card" data-gallery-asset={asset.filename}>
      {failed
        ? <div className="gallery-asset-error" aria-hidden="true">加载失败</div>
        : (
            <img
              src={galleryAssetUrl(asset.filename)}
              alt=""
              width="96"
              height="96"
              loading="lazy"
              onError={() => setFailed(true)}
            />
          )}
      <code>{asset.filename}</code>
      <span role="status" aria-live="polite">{status}</span>
    </article>
  )
}

export function PetActionGallery() {
  const [replay, setReplay] = useState(0)

  useEffect(() => {
    return startGalleryReplay(
      window.matchMedia('(prefers-reduced-motion: reduce)'),
      () => setReplay((value) => value + 1),
    )
  }, [])

  return (
    <main className="gallery-shell">
      <header className="gallery-hero">
        <p className="gallery-eyebrow">DESKTOP PET / 1.2.0</p>
        <h1>MonkeyCode 动作验收展厅</h1>
        <p className="gallery-intro">直接复用 EXE 的生产贴图映射与 CSS 动画。</p>
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
