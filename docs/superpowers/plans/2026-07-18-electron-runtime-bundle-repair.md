# Electron 运行时打包修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成可正常启动的 Windows 1.0.1 安装包，并通过自动检查阻止 Electron npm 包实现再次进入主进程 bundle。

**Architecture:** `tsup` 显式将 `electron` 标记为 external，使 Electron 内置模块在运行时解析。独立 Node.js 检查脚本验证主进程和 preload bundle 的模块边界，Windows CI 在 NSIS 打包前执行同一检查。

**Tech Stack:** Electron 41、tsup 8、Node.js 20、electron-builder 26、GitHub Actions

## Global Constraints

- 应用版本升级为 `1.0.1`。
- `dist-electron/main.js` 与 `dist-electron/preload.js` 必须保留运行时 `require("electron")`。
- 两个 bundle 均不得包含 `node_modules/electron/index.js` 或 `Electron failed to install correctly`。
- 现有认证、轮询、IPC 和渲染行为保持不变。
- Windows CI 必须在 NSIS 打包前验证 bundle 边界。

---

### Task 1: 修正 Electron bundle 边界并升级版本

**Files:**
- Create: `scripts/verify-electron-bundle.mjs`
- Modify: `package.json:3-13`
- Modify: `package-lock.json:3-12`

**Interfaces:**
- Consumes: `npm run build:electron` 生成的 `dist-electron/main.js` 和 `dist-electron/preload.js`。
- Produces: `npm run verify:bundle`，成功时退出码为 0，发现 Electron npm 包实现内联时退出码为 1。

- [ ] **Step 1: 创建失败的 bundle 边界检查**

创建 `scripts/verify-electron-bundle.mjs`：

```javascript
import { readFile } from 'node:fs/promises'

const bundlePaths = ['dist-electron/main.js', 'dist-electron/preload.js']
const forbiddenMarkers = [
  'node_modules/electron/index.js',
  'Electron failed to install correctly',
]

for (const bundlePath of bundlePaths) {
  const bundle = await readFile(bundlePath, 'utf8')

  if (!/require\(["']electron["']\)/.test(bundle)) {
    throw new Error(`${bundlePath} does not load Electron at runtime`)
  }

  for (const marker of forbiddenMarkers) {
    if (bundle.includes(marker)) {
      throw new Error(`${bundlePath} contains bundled Electron marker: ${marker}`)
    }
  }
}

console.log('Electron bundle boundary verified')
```

- [ ] **Step 2: 运行检查并确认复现故障**

Run: `npm run build:electron && node scripts/verify-electron-bundle.mjs`

Expected: FAIL，错误包含 `contains bundled Electron marker`。

- [ ] **Step 3: 外置 Electron 模块并添加检查命令**

将 `package.json` 的版本和 scripts 更新为：

```json
"version": "1.0.1",
"scripts": {
  "dev": "vite",
  "build:electron": "tsup electron/main.ts electron/preload.ts --outDir dist-electron --format cjs --target node20 --external electron --clean",
  "verify:bundle": "node scripts/verify-electron-bundle.mjs",
  "build": "npm run build:electron && npm run verify:bundle && vite build && electron-builder --win",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "verify": "npm run typecheck && npm test && npm run build:electron && npm run verify:bundle && vite build"
}
```

同步将 `package-lock.json` 顶层版本及根包版本更新为 `1.0.1`。

- [ ] **Step 4: 运行边界检查并确认通过**

Run: `npm run build:electron && npm run verify:bundle`

Expected: PASS，输出 `Electron bundle boundary verified`；两个 bundle 均包含外部 `require("electron")`。

- [ ] **Step 5: 运行完整本地验证**

Run: `npm run verify`

Expected: TypeScript 检查通过，45 项测试通过，Electron bundle 边界检查通过，Vite 构建通过。

- [ ] **Step 6: 提交 bundle 修复**

```bash
git add package.json package-lock.json scripts/verify-electron-bundle.mjs
git commit -m "fix: 修复 Electron 主进程打包边界"
```

### Task 2: 将 bundle 检查接入 Windows 构建

**Files:**
- Modify: `.github/workflows/build-win.yml:30-38`

**Interfaces:**
- Consumes: Task 1 提供的 `npm run verify:bundle`。
- Produces: NSIS 打包前的 Windows CI bundle 边界门禁。

- [ ] **Step 1: 在 Windows CI 构建阶段执行边界检查**

将 `Build application` 步骤改为：

```yaml
- name: Build application
  run: npm run build:electron && npm run verify:bundle && npx vite build
```

- [ ] **Step 2: 校验 workflow 和工作树差异**

Run: `git diff --check && npm run verify`

Expected: `git diff --check` 无输出；完整验证通过。

- [ ] **Step 3: 提交 CI 门禁**

```bash
git add .github/workflows/build-win.yml
git commit -m "ci: 校验 Electron 运行时打包边界"
```

### Task 3: 构建并验收 Windows 1.0.1 安装包

**Files:**
- Verify: `.github/workflows/build-win.yml`
- Artifact: `release/MonkeyCode Desktop Pet Setup 1.0.1.exe`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的提交。
- Produces: Windows x64 NSIS 安装包及其 SHA-256 校验值。

- [ ] **Step 1: 推送当前分支**

Run: `git push origin 260717-fix-auth-data-chain`

Expected: 远程分支更新到本计划的最新提交。

- [ ] **Step 2: 触发 Windows workflow**

Run: `gh workflow run build-win.yml --ref 260717-fix-auth-data-chain`

Expected: GitHub Actions 创建新的 `Build Windows EXE` run。

- [ ] **Step 3: 等待 workflow 完成并检查结论**

Run: `FIX_RUN_ID=$(gh run list --workflow build-win.yml --branch 260717-fix-auth-data-chain --limit 1 --json databaseId --jq '.[0].databaseId')`

Run: `gh run watch "$FIX_RUN_ID" --exit-status`

Expected: Type check、Test、Build application、Verify packaged resources、Build Electron 和 Upload EXE artifact 全部通过。

- [ ] **Step 4: 下载并校验安装包**

Run: `mkdir "/tmp/desktop-pet-build/electron-runtime-fix-1.0.1"`

Run: `gh run download "$FIX_RUN_ID" -n monkeycode-desktop-pet-win-x64 -D "/tmp/desktop-pet-build/electron-runtime-fix-1.0.1"`

Run: `sha256sum "/tmp/desktop-pet-build/electron-runtime-fix-1.0.1/MonkeyCode Desktop Pet Setup 1.0.1.exe"`

Expected: EXE 存在、文件大小大于 0，并输出 SHA-256。

- [ ] **Step 5: Windows 实机启动验收**

安装 `MonkeyCode Desktop Pet Setup 1.0.1.exe` 并启动应用。

Expected: 主进程正常启动；随后登录、重启恢复、余额、任务、签到、退出和再次登录均可操作。
