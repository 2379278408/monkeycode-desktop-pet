import { createHash } from 'node:crypto'

const DEFAULT_API_BASE = 'https://monkeycode-ai.com'
const DEFAULT_MAX_NONCE = 5_000_000

export interface CaptchaChallenge {
  challenge: {
    c: number
    s: number
    d: number
  }
  token: string
  expires?: number
}

interface CaptchaRedeem {
  success: boolean
  token?: string
  message?: string
  expires?: number
}

export interface CaptchaClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  maxNonce?: number
  timeoutMs?: number
}

function fnv1a32(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index) & 0xff
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function prng(seed: string, length: number): string {
  let state = fnv1a32(seed)
  let result = ''
  while (result.length < length) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    result += state.toString(16).padStart(8, '0')
  }
  return result.slice(0, length)
}

function solveOne(salt: string, target: string, maxNonce: number): number {
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    const digest = createHash('sha256').update(`${salt}${nonce}`).digest('hex')
    if (digest.startsWith(target)) return nonce
  }
  throw new Error('验证码计算超时，请重试')
}

async function solveOneAsync(salt: string, target: string, maxNonce: number): Promise<number> {
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    const digest = createHash('sha256').update(`${salt}${nonce}`).digest('hex')
    if (digest.startsWith(target)) return nonce
    if (nonce > 0 && nonce % 5_000 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  throw new Error('验证码计算超时，请重试')
}

function validateChallenge(input: unknown): asserts input is CaptchaChallenge {
  if (!input || typeof input !== 'object') {
    throw new Error('验证码响应格式异常')
  }
  const candidate = input as Partial<CaptchaChallenge>
  const challenge = candidate.challenge
  if (!candidate.token || !challenge
    || challenge.c !== 50 || challenge.s !== 32 || challenge.d !== 3) {
    throw new Error('验证码响应格式异常')
  }
}

function assertChallengeActive(expires?: number): void {
  if (expires === undefined) return
  if (!Number.isFinite(expires) || expires <= 0) {
    throw new Error('验证码响应格式异常')
  }
  const expiresAt = expires >= 1_000_000_000_000
    ? expires
    : expires >= 1_000_000_000
      ? expires * 1000
      : null
  if (expiresAt !== null && expiresAt <= Date.now()) {
    throw new Error('验证码已过期，请重试')
  }
}

export function solveChallenges(
  input: CaptchaChallenge,
  maxNonce = DEFAULT_MAX_NONCE,
): number[] {
  validateChallenge(input)
  const { challenge, token } = input
  const { c, s, d } = challenge

  return Array.from({ length: c }, (_value, index) => {
    const sequence = index + 1
    const salt = prng(`${token}${sequence}`, s)
    const target = prng(`${token}${sequence}d`, d)
    return solveOne(salt, target, maxNonce)
  })
}

async function solveChallengesAsync(
  input: CaptchaChallenge,
  maxNonce: number,
): Promise<number[]> {
  validateChallenge(input)
  const { c, s, d } = input.challenge
  const solutions: number[] = []
  for (let index = 0; index < c; index += 1) {
    assertChallengeActive(input.expires)
    const sequence = index + 1
    const salt = prng(`${input.token}${sequence}`, s)
    const target = prng(`${input.token}${sequence}d`, d)
    solutions.push(await solveOneAsync(salt, target, maxNonce))
  }
  return solutions
}

export function verifySolution(
  input: CaptchaChallenge,
  index: number,
  nonce: number,
): boolean {
  const sequence = index + 1
  const salt = prng(`${input.token}${sequence}`, input.challenge.s)
  const target = prng(`${input.token}${sequence}d`, input.challenge.d)
  return createHash('sha256').update(`${salt}${nonce}`).digest('hex').startsWith(target)
}

export class CaptchaClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly maxNonce: number
  private readonly timeoutMs: number

  constructor(options: CaptchaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.maxNonce = options.maxNonce ?? DEFAULT_MAX_NONCE
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async obtainToken(): Promise<string> {
    const challengeResponse = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/public/captcha/challenge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    )
    if (!challengeResponse.ok) {
      throw new Error(`获取验证码失败 (${challengeResponse.status})`)
    }

    const challenge: unknown = await challengeResponse.json().catch(() => {
      throw new Error('验证码响应格式异常')
    })
    validateChallenge(challenge)
    assertChallengeActive(challenge.expires)
    const solutions = await solveChallengesAsync(challenge, this.maxNonce)
    assertChallengeActive(challenge.expires)
    const redeemResponse = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/public/captcha/redeem`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: challenge.token, solutions }),
      },
    )
    const redeem = await redeemResponse.json().catch(() => ({})) as CaptchaRedeem
    if (!redeemResponse.ok || !redeem.success || !redeem.token) {
      throw new Error(redeem.message || `验证码校验失败 (${redeemResponse.status})`)
    }
    return redeem.token
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('验证码请求超时，请重试')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
