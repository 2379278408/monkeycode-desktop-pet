# 桌宠陪伴互动核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付稳定拖动、持续生命数值、六种基础形态、点击/双击/拖动/抚摸、喂食和睡眠的桌宠互动核心。

**Architecture:** Electron 主进程读取 DIP 光标并持久化生命快照，Renderer 只负责手势识别、动作编排和视觉呈现。生命结算、形态选择和动作优先级均实现为无副作用纯函数，由 Zustand store 连接 IPC 与 React 组件。

**Tech Stack:** Electron 41、React 19、TypeScript 7、Zustand 5、Vitest 4、Vite 8、SVG/CSS。

## Global Constraints

- 拖动阈值固定为 5 像素，双击间隔固定为 300 毫秒。
- 生命数值范围固定为 0 至 100，离线结算最大跨度固定为 72 小时。
- 饱食度清醒时每小时减少 2，精力清醒时每小时减少 1.5，睡眠时每小时增加 8。
- 连续 6 小时无互动后，心情每小时减少 1。
- 形态固定为正常、开心、委屈、饥饿、困倦、睡眠。
- 现有任务 SUCCESS、ERROR 和 QUOTA_LOW 继续作为短暂业务动作。
- Renderer 不直接访问文件系统或 Electron store。
- 所有持续动画支持 `prefers-reduced-motion`。
- 每个任务完成后运行定向测试和 `npm run verify`，修复全部 Critical 和 Important 审查问题。

---

## 文件结构

- `electron/window/interaction.ts`：窗口边界和拖动位置纯函数。
- `electron/main.ts`：DIP 光标采样、拖动会话和生命状态 IPC。
- `electron/pet-life/store.ts`：生命快照校验与原子 JSON 持久化。
- `electron/pet-life/store.test.ts`：损坏数据、范围校验和持久化测试。
- `electron/preload.ts`：暴露最小拖动和生命状态 API。
- `src/types/electron.d.ts`：Renderer 可见 IPC 类型。
- `src/lib/pet-life.ts`：生命结算和基础形态纯函数。
- `src/lib/pet-life.test.ts`：数值、离线和滞回测试。
- `src/lib/pet-action.ts`：动作类型和优先级决策。
- `src/lib/pet-action.test.ts`：动作覆盖与恢复测试。
- `src/lib/pointer-gesture.ts`：点击、双击、拖动和抚摸识别。
- `src/lib/pointer-gesture.test.ts`：互斥手势测试。
- `src/stores/pet-life-store.ts`：生命状态、互动行为和持久化协调。
- `src/stores/pet-life-store.test.ts`：store 行为和限频测试。
- `src/components/PetShell.tsx`：手势接入、喂食和睡眠入口。
- `src/components/MonkeySprite.tsx`：基础形态与临时动作资源映射。
- `src/components/OrbitStatusPanel.tsx`：生命数值和生活操作面板。
- `src/styles.css`：互动动作和 reduced-motion。
- `public/assets/monkey/*.svg`：六种形态和互动动作资源。

---

### Task 1: 使用主进程 DIP 光标修复拖动乱跳

**Files:**
- Modify: `electron/window/interaction.ts`
- Modify: `electron/window/interaction.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `src/components/PetShell.tsx`
- Create: `src/lib/drag-controller.ts`
- Create: `src/lib/drag-controller.test.ts`

**Interfaces:**
- Consumes: `screen.getCursorScreenPoint(): Point`、现有 `clampWindowPosition` 和 `isRectangleCoveredByWorkAreas`。
- Produces: `draggedWindowBounds(startBounds: Rectangle, startPointer: Point, currentPointer: Point): Rectangle`；`beginDrag(sessionId)`、`moveDrag(sessionId)`、`endDrag(sessionId)`、`cancelDrag(sessionId)`；可测试的 Renderer `DragController`。

- [x] **Step 1: 添加拖动位置纯函数失败测试**

在 `electron/window/interaction.test.ts` 添加：

```ts
import { draggedWindowBounds } from './interaction'

it('moves from the fixed starting bounds using the latest DIP cursor', () => {
  expect(draggedWindowBounds(
    { x: 400, y: 300, width: 380, height: 430 },
    { x: 600, y: 500 },
    { x: 645, y: 530 },
  )).toEqual({ x: 445, y: 330, width: 380, height: 430 })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/window/interaction.test.ts`

Expected: FAIL，提示 `draggedWindowBounds` 尚未导出。

- [x] **Step 3: 实现纯函数并切换主进程光标采样**

在 `electron/window/interaction.ts` 添加：

```ts
export function draggedWindowBounds(
  startBounds: Rectangle,
  startPointer: Point,
  currentPointer: Point,
): Rectangle {
  return {
    x: Math.round(startBounds.x + currentPointer.x - startPointer.x),
    y: Math.round(startBounds.y + currentPointer.y - startPointer.y),
    width: startBounds.width,
    height: startBounds.height,
  }
}
```

在 `electron/main.ts` 中让 `window:drag-begin` 只接收 `sessionId`，并使用：

```ts
dragSession = {
  id: sessionId,
  pointer: screen.getCursorScreenPoint(),
  bounds: getPetWindow().getBounds(),
  lastActivityAt: Date.now(),
  lastWindowMoveAt: 0,
}
```

让 `window:drag-move` 只接收 `sessionId`，候选边界改为：

```ts
const candidateBounds = draggedWindowBounds(
  dragSession.bounds,
  dragSession.pointer,
  screen.getCursorScreenPoint(),
)
```

让 `window:drag-end` 在关闭会话前使用当前光标重新计算并应用最终边界。保持会话 ID、超时、sender、mode 和边界校验。

- [x] **Step 4: 收紧 Renderer IPC 签名**

将 `electron/preload.ts` 和 `src/types/electron.d.ts` 改为：

```ts
beginDrag: (sessionId: string): Promise<void> =>
  ipcRenderer.invoke('window:drag-begin', sessionId),
moveDrag: (sessionId: string): Promise<void> =>
  ipcRenderer.invoke('window:drag-move', sessionId),
endDrag: (sessionId: string): Promise<void> =>
  ipcRenderer.invoke('window:drag-end', sessionId),
cancelDrag: (sessionId: string): Promise<void> =>
  ipcRenderer.invoke('window:drag-cancel', sessionId),
```

`PetShell.tsx` 在 pointerdown 调用 `beginDrag(sessionId)` 捕获起点；5 像素阈值前保持候选会话，点击和取消路径调用 `cancelDrag(sessionId)`。`DragController` 合并移动通知，pointerup 立即关闭本地会话并发送 end，后续通知直接丢弃。所有 transport 调用同时吸收同步抛出和异步拒绝。

- [x] **Step 5: 运行拖动与全量验证**

Run: `npx vitest run electron/window/interaction.test.ts src/lib/drag-controller.test.ts src/lib/pointer-gesture.test.ts && npm run verify`

Expected: 定向测试和全部现有测试通过，TypeScript、Electron bundle 与 Vite 构建通过。

- [x] **Step 6: 提交拖动修复**

```bash
git add electron/window/interaction.ts electron/window/interaction.test.ts electron/main.ts electron/preload.ts src/types/electron.d.ts src/components/PetShell.tsx src/lib/drag-controller.ts src/lib/drag-controller.test.ts
git commit -m "fix: 使用主进程光标修复桌宠拖动"
```

---

### Task 2: 实现生命数值与六种基础形态

**Files:**
- Create: `src/lib/pet-life.ts`
- Create: `src/lib/pet-life.test.ts`

**Interfaces:**
- Consumes: 时间戳和上一次 `PetLifeSnapshot`。
- Produces: `PetLifeSnapshot`、`PetForm`、`settlePetLife(snapshot, now)`、`derivePetForm(snapshot, previousForm)`、`applyPetEvent(snapshot, event, now)`。

- [x] **Step 1: 添加生命结算失败测试**

创建 `src/lib/pet-life.test.ts`，覆盖：

```ts
import { describe, expect, it } from 'vitest'
import { applyPetEvent, derivePetForm, settlePetLife } from './pet-life'

const base = {
  mood: 50,
  satiety: 50,
  energy: 50,
  sleeping: false,
  lastCalculatedAt: 0,
  lastInteractionAt: 0,
} as const

describe('settlePetLife', () => {
  it('settles one awake hour', () => {
    expect(settlePetLife(base, 3_600_000)).toMatchObject({ satiety: 48, energy: 48.5 })
  })

  it('caps offline settlement at 72 hours', () => {
    expect(settlePetLife(base, 100 * 3_600_000).lastCalculatedAt).toBe(100 * 3_600_000)
    expect(settlePetLife(base, 100 * 3_600_000).satiety).toBe(0)
  })

  it('ignores a backwards clock', () => {
    expect(settlePetLife({ ...base, lastCalculatedAt: 10_000 }, 5_000).satiety).toBe(50)
  })
})

it('uses hysteresis for hungry form', () => {
  expect(derivePetForm({ ...base, satiety: 25 }, 'normal')).toBe('hungry')
  expect(derivePetForm({ ...base, satiety: 34 }, 'hungry')).toBe('hungry')
  expect(derivePetForm({ ...base, satiety: 36 }, 'hungry')).toBe('normal')
})

it('applies feeding with clamping', () => {
  expect(applyPetEvent({ ...base, satiety: 90 }, { type: 'feed' }, 1)).toMatchObject({
    satiety: 100,
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/pet-life.test.ts`

Expected: FAIL，提示 `pet-life` 模块不存在。

- [x] **Step 3: 实现生命模型**

创建 `src/lib/pet-life.ts`：

```ts
export type PetForm = 'normal' | 'happy' | 'sad' | 'hungry' | 'sleepy' | 'sleeping'

export interface PetLifeSnapshot {
  mood: number
  satiety: number
  energy: number
  sleeping: boolean
  lastCalculatedAt: number
  lastInteractionAt: number
}

export type PetLifeEvent =
  | { type: 'click' }
  | { type: 'double-click' }
  | { type: 'pet'; seconds: number }
  | { type: 'feed' }
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'task-success' }
  | { type: 'task-error' }

const HOUR_MS = 3_600_000
const MAX_SETTLEMENT_MS = 72 * HOUR_MS
const clamp = (value: number) => Math.min(100, Math.max(0, value))
```

实现 `settlePetLife` 时将有效时间差限制在 `0..MAX_SETTLEMENT_MS`，清醒时结算饱食度和精力，睡眠时结算精力；无互动超过 6 小时后结算心情。非有限当前时间按零时间差处理，互动时间戳保持单调。实现设计文档中的数值增减和形态滞回阈值。

核心结算使用以下公式：

```ts
export function settlePetLife(snapshot: PetLifeSnapshot, now: number): PetLifeSnapshot {
  const effectiveNow = Math.max(snapshot.lastCalculatedAt, now)
  const elapsedMs = Math.min(MAX_SETTLEMENT_MS, effectiveNow - snapshot.lastCalculatedAt)
  const elapsedHours = elapsedMs / HOUR_MS
  const neglectedMs = Math.max(0, effectiveNow - snapshot.lastInteractionAt - 6 * HOUR_MS)
  const neglectedHours = Math.min(elapsedMs, neglectedMs) / HOUR_MS

  return {
    ...snapshot,
    mood: clamp(snapshot.mood - neglectedHours),
    satiety: snapshot.sleeping
      ? snapshot.satiety
      : clamp(snapshot.satiety - 2 * elapsedHours),
    energy: clamp(snapshot.energy + (snapshot.sleeping ? 8 : -1.5) * elapsedHours),
    lastCalculatedAt: effectiveNow,
  }
}

export function applyPetEvent(
  snapshot: PetLifeSnapshot,
  event: PetLifeEvent,
  now: number,
): PetLifeSnapshot {
  const settled = settlePetLife(snapshot, now)
  const interactionAt = settled.lastCalculatedAt
  if (event.type === 'feed') return { ...settled, satiety: clamp(settled.satiety + 25), mood: clamp(settled.mood + 2), lastInteractionAt: interactionAt }
  if (event.type === 'sleep') return { ...settled, sleeping: true, lastInteractionAt: interactionAt }
  if (event.type === 'wake') return { ...settled, sleeping: false, lastInteractionAt: interactionAt }
  if (event.type === 'click') return { ...settled, mood: clamp(settled.mood + 1), lastInteractionAt: interactionAt }
  if (event.type === 'double-click') return { ...settled, mood: clamp(settled.mood + 3), lastInteractionAt: interactionAt }
  if (event.type === 'pet') return { ...settled, mood: clamp(settled.mood + Math.min(5, Math.floor(event.seconds / 2))), lastInteractionAt: interactionAt }
  if (event.type === 'task-success') return { ...settled, mood: clamp(settled.mood + 2) }
  return { ...settled, mood: clamp(settled.mood - 2) }
}
```

- [x] **Step 4: 运行生命模型测试**

Run: `npx vitest run src/lib/pet-life.test.ts`

Expected: PASS。

- [x] **Step 5: 提交生命模型**

```bash
git add src/lib/pet-life.ts src/lib/pet-life.test.ts
git commit -m "feat: 增加桌宠生命状态模型"
```

---

### Task 3: 持久化生命快照并暴露受限 IPC

**Files:**
- Create: `electron/pet-life/store.ts`
- Create: `electron/pet-life/store.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: `PetLifeSnapshot` JSON 数据。
- Produces: `PetLifeStore.load(): PetLifeSnapshot | null`、`PetLifeStore.save(snapshot): void`；Renderer API `loadPetLife()` 和 `savePetLife(snapshot)`。

- [x] **Step 1: 添加快照校验失败测试**

创建 `electron/pet-life/store.test.ts`，使用临时目录和注入路径：

```ts
import { describe, expect, it } from 'vitest'
import { normalizePetLifeSnapshot } from './store'

describe('normalizePetLifeSnapshot', () => {
  it('accepts a valid snapshot', () => {
    expect(normalizePetLifeSnapshot({
      mood: 50,
      satiety: 60,
      energy: 70,
      sleeping: false,
      lastCalculatedAt: 100,
      lastInteractionAt: 90,
    })).toMatchObject({ mood: 50, satiety: 60, energy: 70 })
  })

  it('rejects malformed data', () => {
    expect(normalizePetLifeSnapshot({ mood: '50' })).toBeNull()
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/pet-life/store.test.ts`

Expected: FAIL，提示模块不存在。

- [x] **Step 3: 实现原子 JSON 存储**

创建 `electron/pet-life/store.ts`，导出校验函数和存储类：

```ts
import fs from 'node:fs'
import path from 'node:path'

export function normalizePetLifeSnapshot(value: unknown): PetLifeSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PetLifeSnapshot>
  const numbers = [
    candidate.mood,
    candidate.satiety,
    candidate.energy,
    candidate.lastCalculatedAt,
    candidate.lastInteractionAt,
  ]
  if (numbers.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    || typeof candidate.sleeping !== 'boolean') return null
  return {
    mood: Math.min(100, Math.max(0, candidate.mood!)),
    satiety: Math.min(100, Math.max(0, candidate.satiety!)),
    energy: Math.min(100, Math.max(0, candidate.energy!)),
    sleeping: candidate.sleeping,
    lastCalculatedAt: Math.max(0, candidate.lastCalculatedAt!),
    lastInteractionAt: Math.max(0, candidate.lastInteractionAt!),
  }
}

export class PetLifeStore {
  constructor(private readonly filePath: string) {}

  load(): PetLifeSnapshot | null {
    try {
      if (!fs.existsSync(this.filePath)) return null
      return normalizePetLifeSnapshot(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch (error) {
      console.warn('[PetLife] 无法读取生命状态', error instanceof Error ? error.message : 'unknown error')
      return null
    }
  }

  save(snapshot: PetLifeSnapshot): void {
    const normalized = normalizePetLifeSnapshot(snapshot)
    if (!normalized) throw new Error('无效桌宠生命状态')
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), 'utf8')
    fs.renameSync(temporaryPath, this.filePath)
  }
}
```

`normalizePetLifeSnapshot` 必须要求六个字段类型正确、数值有限，并将三项生命值限制到 0 至 100。时间戳要求为安全整数，负值归零。读取前限制快照文件大小为 16 KiB，临时文件名包含进程 ID 以隔离多实例写入。

- [x] **Step 4: 注册受限 IPC**

在 `electron/main.ts` 初始化：

```ts
const petLifeStore = new PetLifeStore(path.join(app.getPath('userData'), 'pet-life.json'))
```

注册 `pet-life:load` 和 `pet-life:save`，沿用 `assertTrustedSender`，save 参数数量固定为 1，并在主进程再次调用 `normalizePetLifeSnapshot`。在 preload 和类型声明中暴露：

```ts
loadPetLife: () => Promise<PetLifeSnapshot | null>
savePetLife: (snapshot: PetLifeSnapshot) => Promise<void>
```

- [x] **Step 5: 运行存储和全量验证**

Run: `npx vitest run electron/pet-life/store.test.ts && npm run verify`

Expected: 存储测试和全量验证通过。

- [x] **Step 6: 提交持久化实现**

```bash
git add electron/pet-life/store.ts electron/pet-life/store.test.ts electron/main.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat: 持久化桌宠生命状态"
```

---

### Task 4: 扩展四种互斥手势

**Files:**
- Modify: `src/lib/pointer-gesture.ts`
- Modify: `src/lib/pointer-gesture.test.ts`
- Modify: `src/components/PetShell.tsx`

**Interfaces:**
- Consumes: 指针轨迹、按压时间、前一次点击时间。
- Produces: `PointerIntent = 'click' | 'double-click' | 'drag' | 'pet'`、`GestureSession`、`appendGesturePoint`、`classifyReleaseIntent`；未完成的抚摸候选释放为 `null`。

- [x] **Step 1: 添加手势互斥失败测试**

在 `src/lib/pointer-gesture.test.ts` 添加：

```ts
const makeSession = (
  points: GesturePoint[],
  previousClickAt: number | null = null,
  lockedIntent: GestureSession['lockedIntent'] = null,
): GestureSession => ({ points, previousClickAt, lockedIntent })

it('classifies a quick stationary release as click', () => {
  expect(classifyReleaseIntent(makeSession([
    { x: 0, y: 0, at: 0 },
    { x: 2, y: 1, at: 120 },
  ]))).toBe('click')
})

it('classifies a second click within 300ms as double-click', () => {
  expect(classifyReleaseIntent(makeSession([
    { x: 0, y: 0, at: 300 },
    { x: 1, y: 1, at: 350 },
  ], 100))).toBe('double-click')
})

it('classifies repeated horizontal strokes as pet', () => {
  expect(classifyReleaseIntent(makeSession([
    { x: 0, y: 0, at: 0 },
    { x: 1, y: 1, at: 350 },
    { x: 45, y: 2, at: 500 },
    { x: 5, y: 1, at: 700 },
    { x: 50, y: 2, at: 900 },
  ], null, 'pet-candidate'))).toBe('pet')
})

it('keeps a directional movement as drag', () => {
  expect(classifyReleaseIntent(makeSession(
    [{ x: 0, y: 0, at: 0 }, { x: 20, y: 20, at: 100 }],
    null,
    'drag',
  )))
    .toBe('drag')
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/pointer-gesture.test.ts`

Expected: FAIL，提示新接口尚未导出。

- [x] **Step 3: 实现轨迹与意图分类**

在 `src/lib/pointer-gesture.ts` 定义：

```ts
export type PointerIntent = 'click' | 'double-click' | 'drag' | 'pet'
export interface GesturePoint extends Point { at: number }
export interface GestureSession {
  points: GesturePoint[]
  previousClickAt: number | null
  lockedIntent: 'drag' | 'pet-candidate' | 'pet' | null
}
```

规则固定为：按下后 350 毫秒内位移达到 5 像素时立即锁定拖动；静止按住达到 350 毫秒时锁定抚摸候选，此后总轨迹达到 80 像素且主轴方向反转至少 2 次时确认为抚摸；短按释放为点击；前一次点击间隔不超过 300 毫秒为双击。轨迹最多保存最近 32 点，原始按下点和抚摸累计指标独立保留。锁定后的手势不再切换类别，350 毫秒边界内达到 5 像素时拖动优先；未达标的抚摸候选释放时不产生点击事件。

- [x] **Step 4: 接入 PetShell**

`PetShell` 在 pointer down 创建轨迹和 350 毫秒长按计时器；计时器触发前位移达到 5 像素时取消计时器并进入拖动；计时器触发后锁定抚摸候选并累计往返轨迹；pointer up 产生 click、double-click 或 pet 事件。单击使用 301 毫秒定时器延后执行，为 300 毫秒双击边界留出调度余量，双击到达时取消单击定时器。非拖动释放同步关闭本地会话并异步取消主进程候选，拖动释放、取消和丢失捕获统一完成最终位置。组件卸载时清理定时器和 pointer capture；手势结束和窗口模式变化后按最新指针位置恢复穿透。

- [x] **Step 5: 运行手势和全量验证**

Run: `npx vitest run src/lib/pointer-gesture.test.ts && npm run verify`

Expected: 手势测试和全量验证通过。

- [x] **Step 6: 提交手势实现**

```bash
git add src/lib/pointer-gesture.ts src/lib/pointer-gesture.test.ts src/components/PetShell.tsx
git commit -m "feat: 支持桌宠点击双击与抚摸"
```

---

### Task 5: 实现动作优先级与生命状态 store

**Files:**
- Create: `src/lib/pet-action.ts`
- Create: `src/lib/pet-action.test.ts`
- Create: `src/stores/pet-life-store.ts`
- Create: `src/stores/pet-life-store.test.ts`
- Modify: `src/stores/pet-store.ts`

**Interfaces:**
- Consumes: `PetForm`、生命事件、现有 `PetState` 业务状态。
- Produces: `PetAction`、`selectPetAction(inputs)`、`usePetLifeStore` 的 `hydrate`、`interact`、`feed`、`sleep`、`wake` 和 `tick`。

- [ ] **Step 1: 添加动作优先级失败测试**

创建 `src/lib/pet-action.test.ts`：

```ts
import { expect, it } from 'vitest'
import { selectPetAction } from './pet-action'

it('prioritizes direct interaction over business and base states', () => {
  expect(selectPetAction({ interaction: 'petting', lifeAction: null, business: 'error', form: 'hungry' }))
    .toBe('petting')
})

it('returns to the current base form after temporary actions', () => {
  expect(selectPetAction({ interaction: null, lifeAction: null, business: null, form: 'sleepy' }))
    .toBe('sleepy')
})
```

创建 `src/stores/pet-life-store.test.ts`，mock `window.electronAPI`，验证 hydrate 后离线结算、喂食增加 25、睡眠切换和保存调用。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/pet-action.test.ts src/stores/pet-life-store.test.ts`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现动作选择器**

在 `src/lib/pet-action.ts` 定义：

```ts
export type PetAction =
  | PetForm
  | 'waving' | 'celebrating' | 'petting' | 'dragging' | 'dropping'
  | 'eating' | 'falling-asleep' | 'waking'
  | 'task-success' | 'task-error' | 'quota-low'
```

`selectPetAction` 严格按设计优先级返回第一个非空输入，并将现有 SUCCESS、ERROR、QUOTA_LOW 映射为业务动作。

- [ ] **Step 4: 实现 Zustand 生命 store**

`usePetLifeStore` 初始值为 50/50/50；`hydrate` 调用 `loadPetLife` 后结算；`interact`、`feed`、`sleep`、`wake` 和 `tick` 先结算再应用事件。每次变化调用 `savePetLife`，保存失败只设置一次非阻塞 `persistenceError`。点击和双击按设计的 10 分钟窗口限频，抚摸单次收益上限为 5。

- [ ] **Step 5: 连接业务状态**

保留 `src/stores/pet-store.ts` 的 8 秒任务终态计时。向 PetShell 暴露业务 `PetState`，由 `selectPetAction` 与生命 form 合并；业务 store 不直接修改生命快照。

- [ ] **Step 6: 运行 store 与全量验证**

Run: `npx vitest run src/lib/pet-action.test.ts src/stores/pet-life-store.test.ts src/stores/pet-store.test.ts && npm run verify`

Expected: 所有测试和构建通过。

- [ ] **Step 7: 提交动作与 store**

```bash
git add src/lib/pet-action.ts src/lib/pet-action.test.ts src/stores/pet-life-store.ts src/stores/pet-life-store.test.ts src/stores/pet-store.ts
git commit -m "feat: 编排桌宠生命状态与互动动作"
```

---

### Task 6: 绘制六种形态和互动动作资源

**Files:**
- Create: `public/assets/monkey/normal.svg`
- Create: `public/assets/monkey/happy.svg`
- Create: `public/assets/monkey/sad.svg`
- Create: `public/assets/monkey/hungry.svg`
- Create: `public/assets/monkey/sleepy.svg`
- Create: `public/assets/monkey/sleeping.svg`
- Create: `public/assets/monkey/waving.svg`
- Create: `public/assets/monkey/petting.svg`
- Create: `public/assets/monkey/dragging.svg`
- Create: `public/assets/monkey/eating.svg`
- Modify: `src/components/MonkeySprite.tsx`
- Modify: `src/components/MonkeySprite.test.ts`
- Modify: `src/styles.css`
- Modify: `.github/workflows/build-win.yml`

**Interfaces:**
- Consumes: `PetAction`。
- Produces: `actionAnimations: Record<PetAction, string>` 和每个动作的可访问标签。

- [ ] **Step 1: 扩展资源映射失败测试**

在 `MonkeySprite.test.ts` 断言：

```ts
const required = [
  'normal.svg', 'happy.svg', 'sad.svg', 'hungry.svg', 'sleepy.svg', 'sleeping.svg',
  'waving.svg', 'petting.svg', 'dragging.svg', 'eating.svg',
]

for (const filename of required) {
  expect(existsSync(new URL(`../../public/assets/monkey/${filename}`, import.meta.url))).toBe(true)
}
```

同时断言每个 `PetAction` 都有唯一资源或明确复用的临时动作映射，并包含中文状态标签。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/MonkeySprite.test.ts`

Expected: FAIL，提示新资源或映射缺失。

- [ ] **Step 3: 创建 SVG 和动作样式**

所有 SVG 使用现有 `viewBox="0 0 140 140"`、配色和线条体系。形态差异：开心闭眼上扬嘴；委屈下垂眉眼；饥饿持空碗；困倦半闭眼；睡眠闭眼和 `Z`；抚摸闭眼轻摆；拖动双手上举；喂食持食物。CSS 动画只作用于 140×140 容器内部视觉层。

在 `prefers-reduced-motion` 中关闭新增 wrapper、img 和伪元素动画，保留静态姿态。

- [ ] **Step 4: 接入 MonkeySprite**

将组件签名改为：

```ts
export function MonkeySprite({ action }: { action: PetAction })
```

根据 `actionAnimations[action]` 渲染资源和动作类；图片保持 `aria-hidden`，外部 live region 继续播报状态。

- [ ] **Step 5: 扩展 Windows 资源检查并验证**

在 `.github/workflows/build-win.yml` 的资源检查列表加入十个新 SVG。

Run: `npx vitest run src/components/MonkeySprite.test.ts && npm run verify`

Expected: 资源测试、118+ 全量测试和构建通过，`dist/assets/monkey/` 包含新资源。

- [ ] **Step 6: 提交视觉资源**

```bash
git add public/assets/monkey src/components/MonkeySprite.tsx src/components/MonkeySprite.test.ts src/styles.css .github/workflows/build-win.yml
git commit -m "feat: 增加桌宠陪伴形态与互动动作"
```

---

### Task 7: 接入喂食、睡觉和完整互动 UI

**Files:**
- Modify: `src/components/PetShell.tsx`
- Modify: `src/components/OrbitStatusPanel.tsx`
- Modify: `src/components/OrbitStatusPanel.test.ts`
- Modify: `src/components/MonkeySprite.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `usePetLifeStore` 和 `selectPetAction`。
- Produces: 可操作的喂食、睡觉/唤醒按钮，三项生命值展示和完整手势反馈。

- [ ] **Step 1: 添加面板交互失败测试**

扩展 `OrbitStatusPanel.test.ts`：

```ts
it('exposes pet life values and life actions', () => {
  expect(source).toContain('心情')
  expect(source).toContain('饱食度')
  expect(source).toContain('精力')
  expect(source).toContain('喂食')
  expect(source).toContain('睡觉')
})
```

增加 store mock 测试，断言喂食按钮调用 `feed`，睡眠时按钮文案变为“唤醒”并调用 `wake`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/OrbitStatusPanel.test.ts`

Expected: FAIL，提示生命值和操作入口缺失。

- [ ] **Step 3: 实现生命状态面板**

在环绕面板增加紧凑生命卡，显示三项 0 至 100 数值和可访问进度条。增加“喂食”和“睡觉/唤醒”按钮；动作进行时禁用重复操作。保持三张环绕卡布局和透明命中逻辑。

- [ ] **Step 4: 连接手势与动作计时**

PetShell 启动时调用 `hydrate`，每 60 秒调用 `tick(Date.now())`。手势事件映射：click→waving，double-click→celebrating，pet→petting，drag→dragging，release→dropping。喂食、入睡和唤醒动作结束后重新调用 `derivePetForm`。临时互动动作最长 3 秒，拖动动作由会话结束控制。

- [ ] **Step 5: 完善可访问性和 reduced-motion**

live region 播报动作标签；按钮包含明确中文 `aria-label`；进度条提供 `aria-valuemin=0`、`aria-valuemax=100` 和当前值；键盘 Enter/Space 保留展开行为，生活操作按钮阻止事件冒泡。

- [ ] **Step 6: 运行 UI 与全量验证**

Run: `npx vitest run src/components/OrbitStatusPanel.test.ts src/components/MonkeySprite.test.ts src/stores/pet-life-store.test.ts && npm run verify && npm audit --omit=dev --fetch-timeout=60000 && git diff --check`

Expected: 测试、类型检查、bundle 边界、Vite 构建和生产依赖审计通过，审计为 0 漏洞。

- [ ] **Step 7: 提交互动 UI**

```bash
git add src/components/PetShell.tsx src/components/OrbitStatusPanel.tsx src/components/OrbitStatusPanel.test.ts src/components/MonkeySprite.tsx src/styles.css
git commit -m "feat: 完成桌宠喂食睡眠与手势互动"
```

---

### Task 8: 发布互动核心 Windows 验收包

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/superpowers/plans/2026-07-18-desktop-pet-companion-core.md`
- Artifact: `release/MonkeyCode Desktop Pet Setup 1.2.0.exe`

**Interfaces:**
- Consumes: Task 1 至 Task 7 的完整实现。
- Produces: Windows x64 NSIS 1.2.0 安装包和验收记录。

- [ ] **Step 1: 更新版本**

将 `package.json` 顶层版本、`package-lock.json` 顶层版本和根包版本改为 `1.2.0`。

- [ ] **Step 2: 请求独立代码审查**

审查设计提交到当前 HEAD 的完整范围，重点检查：DIP 拖动、手势互斥、离线结算、滞回状态、IPC 参数校验、原子存储、动作优先级、SVG 资源完整性和 reduced-motion。修复全部 Critical 和 Important 后重新运行发布门禁。

- [ ] **Step 3: 运行发布门禁**

Run: `npm run verify && npm audit --omit=dev --fetch-timeout=60000 && git diff --check`

Expected: 全部测试与构建通过，生产依赖审计为 0 漏洞。

- [ ] **Step 4: 提交版本**

```bash
git add package.json package-lock.json
git commit -m "chore: 发布桌宠互动核心 1.2.0"
```

- [ ] **Step 5: 推送并触发 Windows CI**

Run: `git push origin 260717-fix-auth-data-chain`

Run: `gh workflow run build-win.yml --ref 260717-fix-auth-data-chain`

Expected: 新的 Windows workflow run 被创建。

- [ ] **Step 6: 下载并校验安装包**

Run: `RUN_ID=$(gh run list --workflow build-win.yml --branch 260717-fix-auth-data-chain --limit 1 --json databaseId --jq '.[0].databaseId')`

Run: `gh run watch "$RUN_ID" --exit-status`

Run: `mkdir "/tmp/desktop-pet-build/companion-core-1.2.0"`

Run: `gh run download "$RUN_ID" -n monkeycode-desktop-pet-win-x64 -D "/tmp/desktop-pet-build/companion-core-1.2.0"`

Run: `sha256sum "/tmp/desktop-pet-build/companion-core-1.2.0/MonkeyCode Desktop Pet Setup 1.2.0.exe"`

Expected: CI 成功，安装包大小大于 0，SHA-256 写入本计划。

- [ ] **Step 7: Windows 实机验收**

验证 100%、125%、150% 缩放和多显示器快速拖动；点击、双击、拖动、抚摸互斥；喂食、睡觉、唤醒；六种形态；任务与额度动作覆盖；透明穿透；应用重启和离线状态结算。
