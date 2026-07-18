# MonkeyCode Desktop Pet 认证与数据链修复设计

## 目标

桌宠通过 MonkeyCode 原生后端协议完成邮箱密码登录，安全保存服务端 session，并稳定展示钱包额度与任务状态。应用全程保留桌宠自身界面，不加载 MonkeyCode 网页控制台。

## 范围

- 完整实现 Cap.js PoW challenge、求解、redeem 和密码登录流程。
- 统一解析 MonkeyCode `{ code, message, data }` 响应信封。
- 使用 Electron `safeStorage` 加密持久化 session。
- 验证 session、调用服务端登出并处理 session 过期。
- 修复数据轮询启动、停止、重启、并发和首帧状态同步。
- 同步 preload IPC 类型和运行时契约。
- 修复动画资源打包、窗口尺寸和状态展示。
- 增加认证、响应解析、轮询和构建测试。

## 架构

### CaptchaClient

运行在 Electron 主进程。它从 `/api/v1/public/captcha/challenge` 获取参数，复用 MonkeyCode 移动端的 FNV-1a、xorshift32 和 SHA-256 求解算法，然后调用 `/api/v1/public/captcha/redeem` 获取短期 `captcha_token`。

该模块只返回 token，不接触用户凭据或 session。求解设置有界 nonce、challenge 到期检查和明确错误类型。

### ApiClient

封装生产 API 基址、JSON 请求、超时、响应信封解析和 Cookie header。业务成功条件同时要求 HTTP 成功和 `code === 0`。错误对象保留安全的用户消息、HTTP 状态和业务码。

### AuthManager

接收邮箱和密码，先获取 `captcha_token`，再提交：

```json
{
  "email": "user@example.com",
  "password": "user password",
  "captcha_token": "redeemed token"
}
```

登录成功后从 `Set-Cookie` 提取 `monkeycode_ai_session`，写入加密存储，并调用 `/api/v1/users/status` 验证。密码只在单次 IPC 调用期间驻留内存，不写日志或磁盘。

登出调用服务端 logout；无论服务端结果如何，本地 session 都会被清除。

### SecureStore

使用 Electron `safeStorage.encryptString` 加密 session，磁盘只保存密文和格式版本。系统加密能力不可用时，应用返回明确错误并拒绝持久化 bearer session。旧版明文 `auth.json` 会迁移为加密格式并覆盖原内容。

### DataPoller

同一时间只允许一个请求批次。每轮并行获取 wallet 和 tasks，解析业务响应后一次性发布不可变状态。登录完成后渲染进程先注册监听，再显式启动轮询，确保首帧可见。

鉴权失效会停止轮询、清理 session 并向渲染进程发送 `auth-expired`。网络错误保留最近一次数据并显示离线状态。登出后再次登录会创建或重新启动轮询器。

### IPC 与渲染层

preload 只暴露类型化方法：检查会话、登录、登出、订阅认证状态、订阅数据状态、调整窗口和打开受限外部链接。事件订阅返回取消函数。

主进程校验邮箱、密码长度、窗口尺寸和外链协议/域名。渲染层不接触 Cookie，也不直接请求认证 API。

## UI 状态

应用包含 `loading`、`signed-out`、`signing-in`、`signed-in`、`offline` 五种状态。启动检查设置超时和异常处理，任何失败都会落入可操作界面，避免永久停留在 `Loading...`。

登录窗口使用适合表单的尺寸。登录成功后切换为能够容纳猴子和 320px 气泡卡片的桌宠窗口。已有 session 恢复与首次登录使用相同布局。

动画文件通过 Vite `public` 目录或静态 import 进入安装包，生产路径基于 `import.meta.env.BASE_URL` 解析。

## 错误处理

- captcha challenge、求解、redeem 分别显示可识别错误。
- 登录失败展示后端安全消息，不展示堆栈或内部响应。
- HTTP 200 加非零业务码按业务失败处理。
- 请求设置超时并阻止轮询重叠。
- session 失效统一回到登录态。
- 日志禁止包含密码、captcha token 和 session。

## 测试与验收

- 使用固定 challenge 向量测试 PoW 求解结果。
- 测试 HTTP 与业务响应组合、Cookie 提取和错误映射。
- 测试 session 加密写入、恢复、失效和登出。
- 测试轮询防重入、停止、重启、首帧和鉴权过期。
- 类型检查覆盖 preload 声明与渲染调用。
- 构建后验证动画资源存在于产物。
- Windows 安装包验收：启动进入登录页、有效账号可登录、错误凭据有提示、重启恢复会话、额度和任务更新、登出后可再次登录。

## 非目标

- OAuth、OIDC 和第三方登录留给后续版本。
- 本轮固定使用中国站 `https://monkeycode-ai.com`。
- 本轮不修改 MonkeyCode SaaS 后端协议。
