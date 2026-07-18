# Electron 运行时打包修复设计

## 背景

Windows 安装包启动时，主进程抛出 `Electron failed to install correctly`。构建产物 `dist-electron/main.js` 和 `dist-electron/preload.js` 包含 `node_modules/electron/index.js`，导致已安装应用执行开发期 Electron npm 包的二进制定位逻辑。

## 根因

当前 `build:electron` 命令使用 `tsup` 打包主进程和 preload，且未显式排除 Electron 运行时模块。生成的 bundle 内联了 `electron` npm 包实现。Electron 应用运行时应通过内置模块解析 `require("electron")`。

## 修复方案

1. 在 `build:electron` 命令中添加 `--external electron`，保留运行时 `require("electron")`。
2. 将应用版本升级到 `1.0.1`，便于区分故障安装包并支持覆盖升级。
3. 新增 bundle 静态检查，要求主进程和 preload 产物包含外部 Electron 引用，且不包含 Electron npm 包安装错误文本。
4. 在 Windows CI 的应用构建阶段执行该静态检查，阻止同类错误进入 NSIS Artifact。

## 影响范围

- `package.json` 和 `package-lock.json`：版本与构建脚本。
- Windows CI：增加 bundle 边界验证。
- Electron 主进程业务逻辑、认证协议和渲染进程行为保持现状。

## 验证

1. 运行 `npm run verify`，确认类型检查、单元测试和前后端构建通过。
2. 检查 `dist-electron/main.js` 与 `dist-electron/preload.js`，确认 Electron 由运行时加载。
3. 触发 Windows GitHub Actions，确认 NSIS 构建和 Artifact 上传通过。
4. 下载 `1.0.1` 安装包并核对文件大小与 SHA-256。
5. 在 Windows 安装后启动应用，确认主进程正常启动，再验证登录、数据轮询和退出流程。

## 成功标准

- 安装后的应用可以正常启动，主进程不再出现 Electron 安装错误。
- CI 能在 Electron npm 包实现被内联时终止构建。
- 现有 45 项测试及构建检查保持通过。
