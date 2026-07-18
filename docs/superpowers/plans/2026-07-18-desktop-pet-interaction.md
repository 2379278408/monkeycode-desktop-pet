# 桌宠交互与状态表现实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可直接拖动、透明区域可穿透、环绕卡信息完整、自动检测任务终态并展示五种表情动作的 Windows 桌宠 1.1.0。

**Architecture:** Electron 主进程维护低频钱包与签到数据、15 秒活跃任务监控和任务终态确认；Renderer 维护 8 秒瞬时状态并渲染环绕卡。窗口交互通过受信 IPC 移动和调整尺寸，Renderer 仅上报指针与命中信息，主进程负责边界限制和鼠标穿透。

**Tech Stack:** Electron 41、React 19、Zustand 5、TypeScript 7、Vitest 4、Vite 8、tsup 8、electron-builder 26

## Global Constraints

- 应用版本升级为 `1.1.0`。
- 活跃任务每 15 秒查询一次，最多跟踪 3 个任务。
- 任务从活跃列表消失时按 ID 查询详情并确认 `finished` 或 `error`。
- 签到状态按当前登录代际和本地日期缓存，跨天重新查询。
- 钱包在登录、签到、任务终态和手动刷新时更新，并每 5 分钟兜底刷新。
- 任务成功或失败动作持续 8 秒。
- 指针移动达到 5 像素后判定为拖动。
- 透明空白区域允许点击下方窗口。
- Electron IPC 必须验证 sender、参数和窗口状态。
- 用户凭据、会话和验证码 token 不进入日志。
- 第二阶段自定义 AI 不在本计划中实现。

---

### Task 1: 自动监控活跃任务并确认终态

**Files:**
- Modify: `electron/api/types.ts`
- Modify: `electron/poller/data-poller.ts`
- Modify: `electron/poller/data-poller.test.ts`

**Interfaces:**
- Produces: `TaskTerminalEvent { task_id, title, status: 'finished' | 'error', occurred_at }`。
- Produces: `PollerState.task_event: TaskTerminalEvent | null` 和 `PollerState.checked_in: boolean | null`。
- Produces: `DataPoller.markCheckedIn()` 与 `DataPoller.refreshAll()`。

- [x] **Step 1: 添加任务终态和分频刷新失败测试**

在 `data-poller.test.ts` 添加测试，使用 `vi.useFakeTimers()` 和可控 API mock 验证：

```typescript
it('confirms a missing active task and emits finished once', async () => {
  let activeRequestCount = 0
  const api = { request: vi.fn((path: string) => {
    if (path === '/api/v1/users/wallet') {
      return Promise.resolve({ balance: 100, daily_token_balance: 200, daily_token_limit: 300 })
    }
    if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
    if (path.includes('status=processing,pending')) {
      activeRequestCount += 1
      return Promise.resolve(activeRequestCount === 1
        ? { tasks: [{ id: 't1', title: 'Task t1', status: 'processing' }] }
        : { tasks: [] })
    }
    if (path === '/api/v1/users/tasks/t1') {
      return Promise.resolve({ id: 't1', title: 'Task t1', status: 'finished' })
    }
    throw new Error(`Unexpected path: ${path}`)
  }) }
  const poller = new DataPoller(api, { taskIntervalMs: 15_000, walletIntervalMs: 300_000 })
  const updates: PollerState[] = []
  poller.onUpdate((state) => updates.push(state))

  await poller.refreshAll()
  await poller.refreshTasks()
  await poller.refreshTasks()

  expect(updates.flatMap((state) => state.task_event ? [state.task_event] : []))
    .toEqual([{ task_id: 't1', title: 'Task t1', status: 'finished', occurred_at: expect.any(Number) }])
})
```

同时覆盖 `error`、首次基线无事件、详情确认失败后重试、`reset()` 清空旧代际、钱包 5 分钟分频和签到跨天查询。

- [x] **Step 2: 运行 Poller 测试确认失败**

Run: `npx vitest run electron/poller/data-poller.test.ts`

Expected: FAIL，缺少 `TaskTerminalEvent`、`refreshTasks()`、`refreshAll()` 或相关状态字段。

- [x] **Step 3: 实现任务跟踪与数据分频**

在 `electron/api/types.ts` 增加：

```typescript
export interface CheckinStatus {
  checked_in?: boolean
}

export interface TaskTerminalEvent {
  task_id: string
  title?: string
  status: 'finished' | 'error'
  occurred_at: number
}
```

在 `DataPoller` 中实现：

- `taskIntervalMs = 15_000` 和 `walletIntervalMs = 300_000`。
- `trackedActiveTasks: Map<string, ProjectTask>`，最多保留 3 个活跃任务。
- 首次活跃任务结果只建立基线。
- 后续缺失任务请求 `/api/v1/users/tasks/${encodeURIComponent(id)}`。
- 详情终态只发布一次 `task_event`，随后从跟踪集合移除。
- 详情仍活跃或请求失败时保留跟踪项，下轮继续确认。
- `refreshAll()` 强制刷新钱包、签到和任务；定时器只按各自频率执行到期请求。
- `reset()` 增加 generation、清空任务基线、签到日期和刷新时间戳。

- [x] **Step 4: 运行 Poller 测试确认通过**

Run: `npx vitest run electron/poller/data-poller.test.ts`

Expected: PASS，任务终态、代际隔离、签到日期和分频刷新测试全部通过。

- [x] **Step 5: 提交任务监控实现**

```bash
git add electron/api/types.ts electron/poller/data-poller.ts electron/poller/data-poller.test.ts
git commit -m "feat: 自动监控桌宠任务状态"
```

### Task 2: 实现 8 秒瞬时状态机

**Files:**
- Modify: `src/stores/pet-store.ts`
- Modify: `src/stores/pet-store.test.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: Task 1 的 `task_event`、活跃任务、钱包、签到和在线状态。
- Produces: `clearTaskEvent()` 和可渲染的 `recentTaskEvent`、`checkedIn`。

- [x] **Step 1: 添加瞬时状态失败测试**

在 `pet-store.test.ts` 添加：

```typescript
it('shows success for eight seconds then restores working state', () => {
  vi.useFakeTimers()
  const store = usePetStore.getState()
  store.updateFromAPI({
    tasks: [{ id: 'active', status: 'processing' }],
    task_event: { task_id: 'done', title: 'Done', status: 'finished', occurred_at: 1 },
  })

  expect(usePetStore.getState().petState).toBe(PetState.SUCCESS)
  vi.advanceTimersByTime(8_000)
  expect(usePetStore.getState().petState).toBe(PetState.WORKING)
})
```

同时覆盖失败事件、低额度恢复、重复事件不重置计时、`reset()` 清理计时器。

- [x] **Step 2: 运行 Store 测试确认失败**

Run: `npx vitest run src/stores/pet-store.test.ts`

Expected: FAIL，store 尚未处理 `task_event` 和 8 秒恢复。

- [x] **Step 3: 实现基础状态与瞬时状态分离**

实现纯函数：

```typescript
export function deriveBasePetState(wallet: Wallet | null, tasks: Task[], online: boolean): PetState {
  if (tasks.some((task) => task.status === 'pending' || task.status === 'processing')) return PetState.WORKING
  if (wallet && (wallet.daily_token_limit ?? 0) > 0
    && (wallet.daily_token_balance ?? 0) / (wallet.daily_token_limit ?? 1) < 0.1) return PetState.QUOTA_LOW
  return PetState.IDLE
}
```

收到新终态事件后设置 `SUCCESS` 或 `ERROR`，启动单一 8 秒 timer；timer 结束调用 `clearTaskEvent()` 并恢复基础状态。扩展 Renderer 类型，使 `StateUpdate` 包含 `checked_in` 和 `task_event`。

- [x] **Step 4: 运行 Store 测试确认通过**

Run: `npx vitest run src/stores/pet-store.test.ts`

Expected: PASS，五种状态均可达到，8 秒后恢复正确基础状态。

- [x] **Step 5: 提交状态机实现**

```bash
git add src/stores/pet-store.ts src/stores/pet-store.test.ts src/types/electron.d.ts
git commit -m "feat: 增加桌宠瞬时任务状态"
```

### Task 3: 实现直接拖动、窗口锚定和透明穿透

**Files:**
- Create: `electron/window/interaction.ts`
- Create: `electron/window/interaction.test.ts`
- Create: `src/lib/pointer-gesture.ts`
- Create: `src/lib/pointer-gesture.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `src/components/PetShell.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `window.electronAPI.beginDrag(x, y)`、`moveDrag(x, y)`、`endDrag()`、`setMousePassthrough(enabled)`、`setWindowMode(mode)`。
- Produces: `WindowMode = 'auth' | 'collapsed' | 'expanded'`。

- [ ] **Step 1: 添加拖动阈值和窗口边界失败测试**

创建纯函数测试：

```typescript
expect(classifyGesture({ x: 10, y: 10 }, { x: 14, y: 12 }, 5)).toBe('click')
expect(classifyGesture({ x: 10, y: 10 }, { x: 16, y: 10 }, 5)).toBe('drag')

expect(clampWindowPosition({ x: 1900, y: 1060 }, { width: 180, height: 190 }, {
  x: 0, y: 0, width: 1920, height: 1080,
})).toEqual({ x: 1740, y: 890 })
```

覆盖负坐标多显示器和展开窗口锚点保持。

- [ ] **Step 2: 运行交互测试确认失败**

Run: `npx vitest run electron/window/interaction.test.ts src/lib/pointer-gesture.test.ts`

Expected: FAIL，交互辅助函数尚未定义。

- [ ] **Step 3: 实现纯交互函数与受信 IPC**

在主进程实现三种窗口尺寸：`auth 380x430`、`collapsed 180x190`、`expanded 380x430`。拖动开始时记录指针与窗口起点，移动时计算偏移并按当前 display workArea 限制位置。模式切换以猴子屏幕锚点为基准调整 bounds。

`setMousePassthrough(true)` 调用：

```typescript
petWindow.setIgnoreMouseEvents(true, { forward: true })
```

所有 IPC 均复用受信 Renderer 校验，并拒绝非有限坐标、未知模式和已销毁窗口。

- [ ] **Step 4: 在 PetShell 接入指针手势和命中上报**

猴子容器标记 `data-window-interactive`。`pointerdown` 记录起点并捕获指针；`pointermove` 达到 5 像素后发送拖动；`pointerup` 根据分类执行结束拖动或切换面板。窗口级 `mousemove` 使用 `document.elementFromPoint()` 检查 `[data-window-interactive]`，仅在命中状态变化时发送穿透 IPC。

- [ ] **Step 5: 运行交互测试确认通过**

Run: `npx vitest run electron/window/interaction.test.ts src/lib/pointer-gesture.test.ts`

Expected: PASS，拖动阈值、工作区限制和窗口锚点测试通过。

- [ ] **Step 6: 提交窗口交互实现**

```bash
git add electron/window electron/main.ts electron/preload.ts src/types/electron.d.ts src/lib src/components/PetShell.tsx src/App.tsx
git commit -m "feat: 支持桌宠拖动与透明穿透"
```

### Task 4: 完善签到状态和环绕状态卡

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/poller/data-poller.ts`
- Modify: `electron/poller/data-poller.test.ts`
- Modify: `src/components/BubbleCard.tsx`
- Modify: `src/components/TaskItem.tsx`
- Create: `src/components/OrbitStatusPanel.tsx`
- Modify: `src/components/PetShell.tsx`

**Interfaces:**
- Consumes: `checkedIn`、`recentTaskEvent`、wallet 和最多 3 个活跃任务。
- Produces: 环绕额度卡、任务卡和签到卡。

- [ ] **Step 1: 添加签到缓存失败测试**

验证首次刷新调用 `GET /api/v1/users/wallet/checkin`，同日后续任务轮询不再调用；`markCheckedIn()` 立即设置 true；日期变化或 `refreshAll()` 重新查询；`reset()` 防止账号切换复用缓存。

- [ ] **Step 2: 运行签到测试确认失败**

Run: `npx vitest run electron/poller/data-poller.test.ts`

Expected: FAIL，签到状态尚未按日期缓存。

- [ ] **Step 3: 实现签到状态流**

签到前检查 Poller 当前 `checked_in`。已签到时直接返回：

```typescript
{ success: true, already_checked_in: true, message: '今日已签到' }
```

签到成功后调用 `markCheckedIn()` 和钱包强制刷新。失败返回明确 message，Renderer 将成功、已签到和失败显示为独立视觉状态。

- [ ] **Step 4: 实现 C 方案环绕状态卡**

`OrbitStatusPanel` 以猴子为中心布置三张卡：额度卡位于左上、任务卡位于右上、签到卡位于下方。任务卡显示最多 3 个活跃任务和最近一次终态；签到卡在已签到时禁用按钮并显示“今日已签到”。所有按钮添加 `data-window-interactive`、`aria-label` 和键盘 focus 样式。

- [ ] **Step 5: 运行 Poller 与完整组件类型检查**

Run: `npx vitest run electron/poller/data-poller.test.ts && npm run typecheck`

Expected: PASS，签到缓存测试和 TypeScript 检查通过。

- [ ] **Step 6: 提交环绕卡和签到反馈**

```bash
git add electron/main.ts electron/poller src/components
git commit -m "feat: 完善桌宠签到与环绕状态卡"
```

### Task 5: 增加五种猴子表情与动作

**Files:**
- Create: `public/assets/monkey/working.svg`
- Create: `public/assets/monkey/success.svg`
- Create: `public/assets/monkey/error.svg`
- Create: `public/assets/monkey/quota-low.svg`
- Modify: `public/assets/monkey/idle.svg`
- Modify: `src/components/MonkeySprite.tsx`
- Create: `src/components/MonkeySprite.test.ts`
- Create: `src/styles.css`
- Modify: `src/main.tsx`
- Modify: `index.html`
- Modify: `.github/workflows/build-win.yml`

**Interfaces:**
- Consumes: `PetState.IDLE | WORKING | SUCCESS | ERROR | QUOTA_LOW`。
- Produces: 每个状态独立 SVG、CSS 动作类和 reduced-motion 静态降级。

- [ ] **Step 1: 添加五种资源映射断言**

扩展 Windows CI 的资源检查，要求五个 SVG 都存在；在 `MonkeySprite.tsx` 导出 `stateAnimations`，并在 `MonkeySprite.test.ts` 断言：

```typescript
expect(new Set(Object.values(stateAnimations)).size).toBe(5)
expect(Object.keys(stateAnimations).sort()).toEqual(Object.values(PetState).sort())
```

- [ ] **Step 2: 运行资源断言确认失败**

Run: `npx vitest run src/components/MonkeySprite.test.ts`

Expected: FAIL，`stateAnimations` 尚未导出且四个状态仍映射到 `idle.svg`。

- [ ] **Step 3: 创建状态 SVG 和 CSS 动作**

- `idle.svg`：自然微笑和睁眼。
- `working.svg`：专注眉眼与代码符号。
- `success.svg`：开心闭眼和庆祝星形。
- `error.svg`：下垂眉眼和警示符号。
- `quota-low.svg`：疲惫半闭眼和低电量符号。

在 `src/styles.css` 定义 `pet-idle`、`pet-working`、`pet-success`、`pet-error`、`pet-quota-low` 动画，并使用：

```css
@media (prefers-reduced-motion: reduce) {
  .pet-sprite { animation: none !important; }
}
```

- [ ] **Step 4: 运行完整前端构建和资源检查**

Run: `npm run verify`

Expected: 五种资源映射、45 项现有测试和新增测试通过，Vite 构建包含所有 SVG。

- [ ] **Step 5: 提交状态视觉实现**

```bash
git add public/assets/monkey src/components/MonkeySprite.tsx src/components/MonkeySprite.test.ts src/styles.css src/main.tsx index.html .github/workflows/build-win.yml
git commit -m "feat: 增加桌宠五种状态动作"
```

### Task 6: 版本、清理和 Windows 1.1.0 验收

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Verify: `docs/superpowers/specs/2026-07-18-desktop-pet-interaction-design.md`
- Artifact: `release/MonkeyCode Desktop Pet Setup 1.1.0.exe`

**Interfaces:**
- Consumes: Task 1 至 Task 5 的完整实现。
- Produces: Windows x64 NSIS 1.1.0 安装包和验收记录。

- [ ] **Step 1: 更新版本和忽略视觉草稿**

将 `package.json`、`package-lock.json` 顶层版本和根包版本改为 `1.1.0`，并在 `.gitignore` 增加：

```gitignore
.superpowers/
```

- [ ] **Step 2: 运行最终本地验证**

Run: `npm run verify && npm audit --omit=dev && git diff --check`

Expected: 所有测试、类型检查、Electron bundle 边界、Vite 构建和生产依赖审计通过，`git diff --check` 无输出。

- [ ] **Step 3: 提交版本和构建配置**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: 发布桌宠 1.1.0"
```

- [ ] **Step 4: 请求独立代码审查**

审查范围从 `a8fa8f2` 到当前 HEAD，重点检查任务代际、任务终态去重、签到跨天、IPC 安全、透明穿透、窗口边界和状态资源完整性。修复全部 Critical 和 Important 问题后重新运行 Step 2。

- [ ] **Step 5: 推送并触发 Windows CI**

Run: `git push origin 260717-fix-auth-data-chain`

Run: `gh workflow run build-win.yml --ref 260717-fix-auth-data-chain`

Expected: 新的 Windows workflow run 被创建。

- [ ] **Step 6: 下载并校验 Artifact**

Run: `INTERACTION_RUN_ID=$(gh run list --workflow build-win.yml --branch 260717-fix-auth-data-chain --limit 1 --json databaseId --jq '.[0].databaseId')`

Run: `gh run watch "$INTERACTION_RUN_ID" --exit-status`

Run: `mkdir "/tmp/desktop-pet-build/interaction-1.1.0"`

Run: `gh run download "$INTERACTION_RUN_ID" -n monkeycode-desktop-pet-win-x64 -D "/tmp/desktop-pet-build/interaction-1.1.0"`

Run: `sha256sum "/tmp/desktop-pet-build/interaction-1.1.0/MonkeyCode Desktop Pet Setup 1.1.0.exe"`

Run: `stat -c '%n %s bytes' "/tmp/desktop-pet-build/interaction-1.1.0/MonkeyCode Desktop Pet Setup 1.1.0.exe"`

Expected: CI 全部步骤通过，EXE 存在且大小大于 0，SHA-256 已记录。

- [ ] **Step 7: Windows 实机终验**

覆盖安装 1.1.0 后验证：直接拖动、短按展开、透明区域点击下方网页、三张环绕卡、已签到提示、最多 3 个并发任务、任务完成和失败 8 秒动作、五种状态差异、跨显示器边界和退出登录。
