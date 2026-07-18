# MonkeyCode Desktop Pet Authentication and Data Chain Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop pet that completes MonkeyCode's native captcha login protocol, stores its session securely, and reliably displays wallet and task data.

**Architecture:** Electron's main process owns captcha solving, API traffic, cookies, encrypted storage, and polling. The React renderer uses a typed preload bridge and receives authentication and data state without access to the session cookie.

**Tech Stack:** Electron 41, React 19, TypeScript, Vitest, Vite, Electron `safeStorage`, Node `crypto`, electron-builder.

## Global Constraints

- Production API base URL is exactly `https://monkeycode-ai.com`.
- Password login sends `email`, `password`, and a redeemed `captcha_token`.
- Passwords, captcha tokens, and sessions must never be logged.
- Session values persisted on disk must be encrypted with Electron `safeStorage`.
- API success requires both an HTTP success status and response `code === 0`.
- The renderer must never receive the session cookie.
- Existing changes remain uncommitted until the user verifies the Windows package.

---

### Task 1: Typed API Client and Response Parser

**Files:**
- Create: `electron/api/types.ts`
- Create: `electron/api/client.ts`
- Test: `electron/api/client.test.ts`

**Interfaces:**
- Produces: `ApiClient.request<T>(path, options): Promise<T>`
- Produces: `ApiError` with `httpStatus`, `code`, and safe `message`
- Produces: `ApiEnvelope<T>`, `Wallet`, `ProjectTask`, and `UserStatus` types

- [ ] Write tests covering HTTP failure, HTTP 200 with nonzero business code, successful envelope extraction, timeout, and Cookie header injection.
- [ ] Run `npx vitest run electron/api/client.test.ts`; expect failures because `ApiClient` does not exist.
- [ ] Implement `ApiClient` with injected `fetch`, an `AbortController` timeout, JSON parsing, and this success guard:

```ts
if (!response.ok || envelope.code !== 0) {
  throw new ApiError(response.status, envelope.code, envelope.message)
}
return envelope.data
```

- [ ] Add `getSetCookie()` support with a `get('set-cookie')` fallback so login can extract the host-only session Cookie.
- [ ] Run the focused test and then `npx vitest run`; expect all API tests to pass.

### Task 2: Cap.js PoW Captcha Client

**Files:**
- Create: `electron/auth/captcha-client.ts`
- Test: `electron/auth/captcha-client.test.ts`
- Reference: `../mobile/src/api/captcha.ts`

**Interfaces:**
- Consumes: `ApiClient` transport behavior
- Produces: `CaptchaClient.obtainToken(): Promise<string>`
- Produces: exported `solveChallenges(challenge): number[]` for deterministic testing

- [ ] Copy the protocol-compatible FNV-1a, xorshift32 PRNG, nonce solver, and SHA-256 prefix comparison from the mobile implementation, using Node `createHash('sha256')`.
- [ ] Add a fixed challenge-vector test that verifies every returned nonce satisfies its generated target prefix.
- [ ] Add tests asserting challenge is fetched from `/api/v1/public/captcha/challenge` and solutions are posted to `/api/v1/public/captcha/redeem`.
- [ ] Reject malformed challenge values, expired responses, missing redeem tokens, and nonce exhaustion with safe user-facing errors.
- [ ] Run `npx vitest run electron/auth/captcha-client.test.ts`; expect all captcha tests to pass.

### Task 3: Encrypted Session Store

**Files:**
- Modify: `electron/store/secure-store.ts`
- Modify: `electron/store/secure-store.test.ts`

**Interfaces:**
- Produces: `SecureStore.get(key): string | null`
- Produces: `SecureStore.set(key, value): void`
- Produces: `SecureStore.delete(key): void`

- [ ] Mock Electron `app` and `safeStorage` and test that the plaintext session is absent from the written JSON.
- [ ] Test encrypted round-trip, missing key, migration from the legacy plaintext object, and unavailable encryption.
- [ ] Persist versioned base64 ciphertext:

```ts
type StoredValue = { version: 1; encrypted: string }
const encrypted = safeStorage.encryptString(value).toString('base64')
```

- [ ] Migrate a legacy string by encrypting it and atomically overwriting the same JSON file.
- [ ] Propagate persistence failures as safe errors so the UI cannot report a durable login when storage failed.
- [ ] Run `npx vitest run electron/store/secure-store.test.ts`; expect all secure-store tests to pass.

### Task 4: Authentication Lifecycle

**Files:**
- Modify: `electron/auth/manager.ts`
- Modify: `electron/auth/manager.test.ts`

**Interfaces:**
- Consumes: `CaptchaClient.obtainToken()` and `ApiClient`
- Produces: `loginWithCredentials(email, password): Promise<AuthResult>`
- Produces: `validateSession(): Promise<boolean>`
- Produces: `logout(): Promise<void>`

- [ ] Replace BrowserWindow-era mocks with injected `CaptchaClient`, `ApiClient`, and `SecureStore` mocks.
- [ ] Test that captcha completes before login and that the body contains trimmed email, original password, and `captcha_token`.
- [ ] Test Cookie extraction, `/status` confirmation, business-code failure, wrong credentials, blocked account, persistence failure, and local cleanup after logout.
- [ ] Implement credential validation with bounded email/password lengths before network calls.
- [ ] Extract only `monkeycode_ai_session` from `Set-Cookie`, persist it, and verify it through `/api/v1/users/status`.
- [ ] Implement `POST /api/v1/users/logout` with the Cookie header and clear local state in `finally`.
- [ ] Run `npx vitest run electron/auth/manager.test.ts`; expect all authentication tests to pass.

### Task 5: Reliable Data Polling

**Files:**
- Modify: `electron/poller/data-poller.ts`
- Modify: `electron/poller/data-poller.test.ts`

**Interfaces:**
- Consumes: authenticated `ApiClient`
- Produces: `start()`, `stop()`, `refresh()`, `onUpdate()`, and `onAuthExpired()`
- Produces: state `{ wallet, tasks, online, error }`

- [ ] Test immediate refresh, single interval, overlapping-request suppression, stop/restart, business error, network offline state, and authentication expiry.
- [ ] Replace raw fetch parsing with `ApiClient.request` for wallet and tasks.
- [ ] Guard `poll()` with an `inFlight` flag and publish a copied state object only after both requests settle.
- [ ] Treat 401/403 authentication errors as session expiry and stop polling.
- [ ] Preserve the last successful data for transient network errors and publish `online: false`.
- [ ] Run `npx vitest run electron/poller/data-poller.test.ts`; expect all poller tests to pass.

### Task 6: Typed IPC and Application State

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/LoginForm.tsx`
- Modify: `src/components/PetShell.tsx`

**Interfaces:**
- Produces: exact `ElectronAPI` runtime/type parity
- Produces: unsubscribe functions for `onStateUpdate` and `onAuthExpired`

- [ ] Define `checkSession`, `login(email,password)`, `logout`, `refresh`, `resizeWindow`, and typed subscriptions in both preload and declaration files.
- [ ] Validate IPC strings, window dimensions, and external URLs in the main process. Permit external URLs only for HTTPS hosts ending in `monkeycode-ai.com`.
- [ ] Register renderer subscriptions before session checking and start polling after the renderer reports readiness.
- [ ] Add startup rejection handling and a finite timeout so `Loading...` always resolves to login, signed-in, or offline UI.
- [ ] Resize both restored-session and newly logged-in windows to the same dimensions that contain the 320px card.
- [ ] Return cleanup callbacks from React effects and remove IPC listeners by their exact callback references.
- [ ] Run `npx tsc --noEmit` after Task 7 fixes the TypeScript configuration; expect zero type errors.

### Task 7: Production Resources and Build Configuration

**Files:**
- Move/copy source asset into: `public/assets/monkey/idle.json`
- Modify: `src/components/MonkeySprite.tsx`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `.github/workflows/build-win.yml`

**Interfaces:**
- Produces: a production-safe animation URL based on `import.meta.env.BASE_URL`
- Produces: `typecheck`, `test`, and `build` scripts used locally and in CI

- [ ] Ensure the monkey SVG exists under Vite `public` and resolve it with `${import.meta.env.BASE_URL}assets/monkey/idle.svg`.
- [ ] Update TypeScript configuration for the installed compiler, remove obsolete `baseUrl`, and keep the `@/*` alias valid through `paths` plus an explicit base.
- [ ] Add scripts:

```json
{
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "verify": "npm run typecheck && npm test && npm run build:electron && vite build"
}
```

- [ ] Update Windows CI to run `npm run typecheck` and `npm test` before packaging.
- [ ] Run `npm run verify`; expect typecheck, all tests, Electron bundle, and Vite build to pass.
- [ ] Inspect `dist/assets/monkey/idle.svg`; expect the production monkey resource to exist.

### Task 8: End-to-End Build Verification

**Files:**
- Modify only files required by failures discovered during verification.

**Interfaces:**
- Produces: Windows x64 NSIS installer artifact

- [ ] Run `npm run verify` from the desktop-pet repository.
- [ ] Run `npm run build`; expect an NSIS installer under `release/`.
- [ ] Inspect packaged files and confirm `dist`, `dist-electron`, and monkey animation resources are included.
- [ ] Review the complete diff for credentials, sensitive logs, stale BrowserWindow login code, unsafe external URLs, and unrelated changes.
- [ ] Keep all changes uncommitted and report the exact test/build results for user verification.
