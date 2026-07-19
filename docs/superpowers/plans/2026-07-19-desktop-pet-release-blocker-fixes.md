# 桌宠互动核心发布阻塞修正实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复互动核心 1.2.0 发布审查发现的四项阻塞，并恢复 Windows 验收包发布流程。

**Architecture:** PetShell 以待提交单击标记协调双击窗口与活跃指针会话；动作选择器将互动动作拆成高、低两个优先级层。生命快照使用无 Node 依赖的共享校验模块，在 preload 和 Main 两侧执行精确字段与 16 KiB 限制，存储层继续负责数值归一化和时间规则。

**Tech Stack:** Electron 41、React 19、TypeScript 7、Zustand 5、Vitest 4、GitHub Actions、electron-builder。

## Global Constraints

- Renderer 不接触 session Cookie、文件系统或 Electron store。
- 生命快照仅包含 `mood`、`satiety`、`energy`、`sleeping`、`lastCalculatedAt`、`lastInteractionAt` 六个字段。
- preload 与 Main 的生命快照 IPC 上限均为 16 KiB UTF-8 JSON。
- 校验错误使用固定文案，日志不得包含 payload、路径或字段值。
- 手势阈值保持拖动 5px、双击 300ms、长按 350ms、抚摸 80px 且至少反转 2 次。
- 动作优先级为高优先级互动、生活动作、普通互动、业务动作、生命形态。
- Windows 实机验收覆盖 100%、125%、150% 缩放和多显示器快速拖动。

---

### Task 1: 加固生命快照 IPC 输入边界

**Files:**
- Create: `electron/pet-life/validation.ts`
- Create: `electron/pet-life/validation.test.ts`
- Modify: `electron/pet-life/store.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `PetLifeSnapshot` 六字段结构和 `PetLifeStore.save(snapshot)`。
- Produces: `MAX_PET_LIFE_SNAPSHOT_BYTES = 16 * 1024`、`assertPetLifeSnapshotPayload(value: unknown): PetLifeSnapshot`。

- [x] **Step 1: 添加共享校验失败测试**

创建 `electron/pet-life/validation.test.ts`，覆盖合法快照、额外字段、错误类型、循环对象和超过 16 KiB：

```ts
import { describe, expect, it } from 'vitest'
import {
  MAX_PET_LIFE_SNAPSHOT_BYTES,
  assertPetLifeSnapshotPayload,
} from './validation'

const validSnapshot = {
  mood: 50,
  satiety: 60,
  energy: 70,
  sleeping: false,
  lastCalculatedAt: 1,
  lastInteractionAt: 1,
}

describe('assertPetLifeSnapshotPayload', () => {
  it('returns an exact valid snapshot', () => {
    expect(assertPetLifeSnapshotPayload(validSnapshot)).toEqual(validSnapshot)
  })

  it.each([
    { ...validSnapshot, padding: 'unexpected' },
    { ...validSnapshot, mood: '50' },
    { ...validSnapshot, sleeping: 0 },
  ])('rejects an invalid payload', (payload) => {
    expect(() => assertPetLifeSnapshotPayload(payload))
      .toThrow('桌宠生命状态保存失败')
  })

  it('rejects a cyclic payload', () => {
    const payload: Record<string, unknown> = { ...validSnapshot }
    payload.self = payload
    expect(() => assertPetLifeSnapshotPayload(payload))
      .toThrow('桌宠生命状态保存失败')
  })

  it('rejects payloads larger than the shared byte limit', () => {
    expect(MAX_PET_LIFE_SNAPSHOT_BYTES).toBe(16 * 1024)
    expect(() => assertPetLifeSnapshotPayload({
      ...validSnapshot,
      padding: 'x'.repeat(MAX_PET_LIFE_SNAPSHOT_BYTES),
    })).toThrow('桌宠生命状态保存失败')
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/pet-life/validation.test.ts`

Expected: FAIL，提示 `./validation` 不存在。

- [x] **Step 3: 实现无 Node 依赖的共享校验器**

在 `electron/pet-life/validation.ts` 定义唯一字段集合，使用 `TextEncoder().encode(JSON.stringify(value)).byteLength` 计算 UTF-8 大小，并在任何失败路径抛出固定错误：

```ts
export interface PetLifeSnapshot {
  mood: number
  satiety: number
  energy: number
  sleeping: boolean
  lastCalculatedAt: number
  lastInteractionAt: number
}

export const MAX_PET_LIFE_SNAPSHOT_BYTES = 16 * 1024
const SAVE_ERROR_MESSAGE = '桌宠生命状态保存失败'
const SNAPSHOT_KEYS = [
  'energy',
  'lastCalculatedAt',
  'lastInteractionAt',
  'mood',
  'satiety',
  'sleeping',
] as const

export function assertPetLifeSnapshotPayload(value: unknown): PetLifeSnapshot {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const serialized = JSON.stringify(value)
    if (new TextEncoder().encode(serialized).byteLength > MAX_PET_LIFE_SNAPSHOT_BYTES) throw new Error()
    const keys = Object.keys(value).sort()
    if (keys.length !== SNAPSHOT_KEYS.length
      || keys.some((key, index) => key !== SNAPSHOT_KEYS[index])) throw new Error()
    const candidate = value as Record<string, unknown>
    if (typeof candidate.mood !== 'number' || !Number.isFinite(candidate.mood)
      || typeof candidate.satiety !== 'number' || !Number.isFinite(candidate.satiety)
      || typeof candidate.energy !== 'number' || !Number.isFinite(candidate.energy)
      || typeof candidate.sleeping !== 'boolean'
      || typeof candidate.lastCalculatedAt !== 'number'
      || typeof candidate.lastInteractionAt !== 'number') throw new Error()
    return value as PetLifeSnapshot
  } catch {
    throw new Error(SAVE_ERROR_MESSAGE)
  }
}
```

时间戳的安全整数、非负和未来 24 小时规则继续由 `normalizePetLifeSnapshot` 判断。

- [x] **Step 4: 在 preload 和 Main 双侧接入校验**

从 `electron/pet-life/store.ts` 移除重复接口并重新导出共享类型：

```ts
import {
  assertPetLifeSnapshotPayload,
  type PetLifeSnapshot,
} from './validation'

export type { PetLifeSnapshot } from './validation'
```

preload 保存前校验：

```ts
savePetLife: (snapshot: PetLifeSnapshot): Promise<void> =>
  ipcRenderer.invoke('pet-life:save', assertPetLifeSnapshotPayload(snapshot)),
```

Main handler 先执行 envelope 校验，再执行存储 normalizer：

```ts
const payload = assertPetLifeSnapshotPayload(args[0])
const snapshot = normalizePetLifeSnapshot(payload)
if (!snapshot) throw new Error('桌宠生命状态保存失败')
petLifeStore.save(snapshot)
```

`PetLifeStore.save` 的无效输入错误同步为固定保存错误。

- [x] **Step 5: 运行定向测试和 bundle 验证**

Run: `npx vitest run electron/pet-life/validation.test.ts electron/pet-life/store.test.ts && npm run typecheck && npm run build:electron && npm run verify:bundle`

Expected: 新增测试、存储测试、类型检查和 preload/Main bundle 边界全部 PASS。

- [x] **Step 6: 提交 IPC 加固**

```bash
git add electron/pet-life/validation.ts electron/pet-life/validation.test.ts electron/pet-life/store.ts electron/preload.ts electron/main.ts
git commit -m "fix: 加固桌宠生命状态 IPC 校验"
```

---

### Task 2: 修正桌宠动作优先级

**Files:**
- Modify: `src/lib/pet-action.ts`
- Modify: `src/lib/pet-action.test.ts`
- Modify: `src/components/MonkeySprite.tsx`

**Interfaces:**
- Consumes: `PetActionInputs` 和既有 17 个 `PetAction`。
- Produces: `selectPetAction(inputs)` 的五层确定性优先级。

- [x] **Step 1: 添加优先级排列失败测试**

在 `src/lib/pet-action.test.ts` 将旧优先级用例替换为明确排列：

```ts
it.each(['dragging', 'petting', 'dropping'] as const)(
  'keeps high-priority interaction %s above life actions',
  (interaction) => {
    expect(selectPetAction({ interaction, lifeAction: 'eating', business: PetState.ERROR, form: 'hungry' }))
      .toBe(interaction)
  },
)

it.each(['waving', 'celebrating'] as const)(
  'keeps life actions above ordinary interaction %s',
  (interaction) => {
    expect(selectPetAction({ interaction, lifeAction: 'waking', business: PetState.ERROR, form: 'hungry' }))
      .toBe('waking')
  },
)

it('keeps ordinary interaction above business and form', () => {
  expect(selectPetAction({ interaction: 'waving', lifeAction: null, business: PetState.ERROR, form: 'hungry' }))
    .toBe('waving')
})
```

- [x] **Step 2: 运行测试确认生活动作优先级失败**

Run: `npx vitest run src/lib/pet-action.test.ts`

Expected: FAIL，`waving + waking` 实际返回 `waving`。

- [x] **Step 3: 实现高低互动分层**

在 `src/lib/pet-action.ts` 增加窄化函数并调整选择顺序：

```ts
function isHighPriorityInteraction(
  action: PetInteractionAction | null,
): action is Extract<PetInteractionAction, 'dragging' | 'petting' | 'dropping'> {
  return action === 'dragging' || action === 'petting' || action === 'dropping'
}

export function selectPetAction(inputs: PetActionInputs): PetAction {
  if (isHighPriorityInteraction(inputs.interaction)) return inputs.interaction
  return inputs.lifeAction
    ?? inputs.interaction
    ?? selectBusinessAction(inputs.business)
    ?? inputs.form
}
```

删除 `MonkeySprite.tsx` 中已经过期的 Task 7 注释，保持资源映射不变。

- [x] **Step 4: 运行动作与 Sprite 测试**

Run: `npx vitest run src/lib/pet-action.test.ts src/components/MonkeySprite.test.ts src/components/PetShell.test.ts`

Expected: 三个测试文件全部 PASS，17 动作穷尽检查保持通过。

- [x] **Step 5: 提交优先级修正**

```bash
git add src/lib/pet-action.ts src/lib/pet-action.test.ts src/components/MonkeySprite.tsx
git commit -m "fix: 修正桌宠生活动作优先级"
```

---

### Task 3: 协调延迟单击与活跃指针会话

**Files:**
- Modify: `src/components/PetShell.tsx`
- Modify: `src/components/PetShell.test.ts`

**Interfaces:**
- Consumes: `PointerIntent`、`usePetLifeStore.getState()`、`toggleCard()` 和拖动终端结果。
- Produces: `PendingClickCoordinator` 纯状态协调器和稳定的睡眠唤醒语义。

- [x] **Step 1: 添加单击协调器失败测试**

在 `PetShell.tsx` 导出无 React 依赖的协调器：

```ts
export interface PendingClickCoordinator {
  markDue: () => void
  cancel: () => void
  settle: (intent: PointerIntent | null) => boolean
}
```

先在 `PetShell.test.ts` 写期望行为：

```ts
it('defers a due click until a non-double pointer session settles', () => {
  const coordinator = createPendingClickCoordinator()
  coordinator.markDue()
  expect(coordinator.settle('pet')).toBe(true)
  expect(coordinator.settle('pet')).toBe(false)
})

it.each(['double-click', 'click'] as const)(
  'resolves a due first click when the second session is %s',
  (intent) => {
    const coordinator = createPendingClickCoordinator()
    coordinator.markDue()
    expect(coordinator.settle(intent)).toBe(intent === 'click')
  },
)

it('clears a due click on cancellation', () => {
  const coordinator = createPendingClickCoordinator()
  coordinator.markDue()
  coordinator.cancel()
  expect(coordinator.settle('pet')).toBe(false)
})
```

- [x] **Step 2: 运行协调器测试确认失败**

Run: `npx vitest run src/components/PetShell.test.ts`

Expected: FAIL，提示 `createPendingClickCoordinator` 不存在。

- [x] **Step 3: 实现最小待提交状态协调器**

在 `PetShell.tsx` 组件外实现闭包：

```ts
export function createPendingClickCoordinator(): PendingClickCoordinator {
  let due = false
  return {
    markDue() { due = true },
    cancel() { due = false },
    settle(intent) {
      const shouldCommit = due && intent !== 'double-click'
      due = false
      return shouldCommit
    },
  }
}
```

组件以 `useRef(createPendingClickCoordinator())` 持有单个协调器，卸载时调用 `cancel()`。

- [x] **Step 4: 提取最新状态单击提交函数**

新增稳定 `commitClick` 回调，每次执行读取最新 store：

```ts
const commitClick = useCallback(() => {
  const lifeStore = usePetLifeStore.getState()
  if (lifeStore.snapshot.sleeping) {
    lifeStore.wake(Date.now())
    showLifeAction('waking')
    previousClickAtRef.current = null
    return
  }
  lifeStore.interact('click', Date.now())
  showInteractionAction('waving')
  toggleCard(true)
}, [showInteractionAction, showLifeAction, toggleCard])
```

睡眠点击在 `releasedIntent === 'click'` 分支立即调用 `commitClick()`，并跳过 301ms timer。

- [x] **Step 5: 在计时器和所有终端路径接入协调器**

清醒单击计时器到期时：

```ts
if (pointerSessionRef.current) {
  pendingClickCoordinatorRef.current.markDue()
  return
}
commitClick()
```

非拖动会话完成分类后调用 `settle(intent)`；返回 `true` 时先调用 `commitClick()`，再执行 `runIntent(intent)`，确保抚摸动作最后写入。拖动会话将该布尔结果传入 `finishDrag`，在 finish Promise settled 后先提交单击，再播放落地动作并恢复 passthrough。pointer cancel、lost capture 和 unmount 调用 `cancel()`。

双击分支继续清除 `clickTimerRef`，并调用 coordinator `cancel()`。睡眠状态若到达双击分支，则调用 `wake` 和 `waking`，清除双击候选并跳过庆祝。

- [x] **Step 6: 增加 fake timer 时序测试**

使用协调器与 `vi.useFakeTimers()` 覆盖：

```ts
it('does not commit while the second pointer session is active', async () => {
  vi.useFakeTimers()
  const commit = vi.fn()
  const coordinator = createPendingClickCoordinator()
  const activeSession = { current: true }
  setTimeout(() => {
    if (activeSession.current) coordinator.markDue()
    else commit()
  }, 301)
  await vi.advanceTimersByTimeAsync(301)
  expect(commit).not.toHaveBeenCalled()
  activeSession.current = false
  if (coordinator.settle('pet')) commit()
  expect(commit).toHaveBeenCalledOnce()
  vi.useRealTimers()
})
```

另加纯函数或协调器测试覆盖拖动 finish 成功、finish 失败和 cancel 均只消费一次；睡眠提交通过注入 store commands 的 helper 验证 `wake` 先于动作回调。

- [x] **Step 7: 运行手势、拖动和生命 store 定向测试**

Run: `npx vitest run src/components/PetShell.test.ts src/lib/pointer-gesture.test.ts src/lib/drag-controller.test.ts src/stores/pet-life-store.test.ts`

Expected: 四个测试文件全部 PASS，定时器测试恢复真实 timers。

- [x] **Step 8: 提交手势时序修正**

```bash
git add src/components/PetShell.tsx src/components/PetShell.test.ts
git commit -m "fix: 协调桌宠连续手势时序"
```

---

### Task 4: 恢复 1.2.0 发布门禁

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/build-win.yml`
- Modify: `docs/superpowers/plans/2026-07-18-desktop-pet-companion-core.md`
- Modify: `docs/superpowers/plans/2026-07-19-desktop-pet-release-blocker-fixes.md`

**Interfaces:**
- Consumes: Task 1 至 Task 3 的修正提交。
- Produces: 1.2.0 Windows x64 NSIS workflow 和可核验安装包。

- [x] **Step 1: 精确校验 Windows 安装包名称**

在 `.github/workflows/build-win.yml` 的 Electron 构建后增加 PowerShell 检查：

```yaml
      - name: Verify installer name
        shell: pwsh
        run: |
          $installer = "release/MonkeyCode Desktop Pet Setup 1.2.0.exe"
          if (-not (Test-Path $installer)) {
            throw "Missing expected installer: $installer"
          }
          if ((Get-Item $installer).Length -le 0) {
            throw "Installer is empty: $installer"
          }
```

上传 artifact 的 EXE path 改为精确文件名，YML 保留通配符：

```yaml
          path: |
            release/MonkeyCode Desktop Pet Setup 1.2.0.exe
            release/*.yml
```

- [x] **Step 2: 运行完整发布门禁**

Run: `npm run verify && npm audit --omit=dev --fetch-timeout=60000 && git diff --check`

Expected: 全部测试、类型检查、Electron bundle、Vite 构建通过，生产依赖审计为 0 漏洞。

- [x] **Step 3: 请求完整范围复审**

审查 `0a2da35..HEAD`，确认 Critical 和 Important 均为 0。重点复测连续手势、动作层级、IPC envelope、资源映射和 Windows workflow 精确产物。

- [x] **Step 4: 更新两个计划的完成状态**

将本计划 Task 1 至 Task 4 已完成步骤标记为 `[x]`；将互动核心计划 Task 8 的版本、审查、门禁和提交步骤标记为 `[x]`。Windows workflow 和实机验收步骤按实际结果更新。

- [x] **Step 5: 提交 1.2.0 发布配置**

```bash
git add package.json package-lock.json .github/workflows/build-win.yml docs/superpowers/plans/2026-07-18-desktop-pet-companion-core.md docs/superpowers/plans/2026-07-19-desktop-pet-release-blocker-fixes.md
git commit -m "chore: 发布桌宠互动核心 1.2.0"
```

- [ ] **Step 6: 推送并触发 Windows CI**

Run: `git push origin 260717-fix-auth-data-chain`

Run: `gh workflow run build-win.yml --ref 260717-fix-auth-data-chain`

Expected: 创建新的 `build-win.yml` workflow run。

- [ ] **Step 7: 等待并下载安装包**

Run:

```bash
RUN_ID=$(gh run list --workflow build-win.yml --branch 260717-fix-auth-data-chain --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
mkdir "/tmp/desktop-pet-build/companion-core-1.2.0"
gh run download "$RUN_ID" -n monkeycode-desktop-pet-win-x64 -D "/tmp/desktop-pet-build/companion-core-1.2.0"
```

Run: `sha256sum "/tmp/desktop-pet-build/companion-core-1.2.0/MonkeyCode Desktop Pet Setup 1.2.0.exe"`

Expected: workflow 成功，安装包大小大于 0，SHA-256 记录到互动核心计划。

- [ ] **Step 8: 停在 Windows 实机验收检查点**

向用户报告 Run ID、安装包路径、大小、SHA-256 和验收清单。等待 Windows 100%、125%、150% 缩放及多显示器结果。
