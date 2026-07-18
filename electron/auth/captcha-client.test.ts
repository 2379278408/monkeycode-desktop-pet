import { describe, expect, it, vi } from 'vitest'
import {
  CaptchaClient,
  solveChallenges,
  verifySolution,
  type CaptchaChallenge,
} from './captcha-client'

const challenge: CaptchaChallenge = {
  challenge: { c: 50, s: 32, d: 3 },
  token: 'fixed-challenge-token',
}

describe('captcha solver', () => {
  it('solves every generated target', () => {
    const solutions = solveChallenges(challenge, 100_000)

    expect(solutions).toHaveLength(50)
    solutions.forEach((nonce, index) => {
      expect(verifySolution(challenge, index, nonce)).toBe(true)
    })
  })

  it('rejects malformed challenges', () => {
    expect(() => solveChallenges({
      challenge: { c: 100, s: 128, d: 8 },
      token: 'bad',
    })).toThrow('验证码响应格式异常')
  })
})

describe('CaptchaClient', () => {
  it('creates, solves, and redeems a challenge', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challenge), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        token: 'captcha-token',
      }), { status: 201 }))
    const client = new CaptchaClient({ fetchImpl, maxNonce: 100_000 })

    await expect(client.obtainToken()).resolves.toBe('captcha-token')
    expect(fetchImpl.mock.calls[0][0]).toContain('/api/v1/public/captcha/challenge')
    expect(fetchImpl.mock.calls[1][0]).toContain('/api/v1/public/captcha/redeem')

    const redeemBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string)
    expect(redeemBody.token).toBe(challenge.token)
    expect(redeemBody.solutions).toHaveLength(50)
  })

  it('surfaces redeem errors', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challenge), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        message: 'challenge expired',
      }), { status: 500 }))
    const client = new CaptchaClient({ fetchImpl, maxNonce: 100_000 })

    await expect(client.obtainToken()).rejects.toThrow('challenge expired')
  })

  it('rejects an expired challenge before redeeming it', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ...challenge,
      expires: Math.floor(Date.now() / 1000) - 1,
    }), { status: 201 }))
    const client = new CaptchaClient({ fetchImpl, maxNonce: 100_000 })

    await expect(client.obtainToken()).rejects.toThrow('验证码已过期')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('maps malformed challenge JSON to a safe error', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('null', { status: 201 }))
    const client = new CaptchaClient({ fetchImpl })

    await expect(client.obtainToken()).rejects.toThrow('验证码响应格式异常')
  })

  it('times out stalled captcha requests', async () => {
    const fetchImpl = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })) as typeof fetch
    const client = new CaptchaClient({ fetchImpl, timeoutMs: 1 })

    await expect(client.obtainToken()).rejects.toThrow('验证码请求超时')
  })
})
