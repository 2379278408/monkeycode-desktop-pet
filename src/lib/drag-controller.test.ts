import { describe, expect, it, vi } from 'vitest'
import { createDragController, type DragTransport } from './drag-controller'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createTransport(overrides: Partial<DragTransport> = {}): DragTransport {
  return {
    begin: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('createDragController', () => {
  it('cancels a candidate immediately while begin is pending', async () => {
    const begin = deferred()
    const transport = createTransport({ begin: vi.fn(() => begin.promise) })
    const controller = createDragController('candidate', transport)

    controller.notifyMove()
    const cancellation = controller.cancel()
    expect(transport.cancel).toHaveBeenCalledWith('candidate')
    await expect(cancellation).resolves.toBe(true)

    begin.resolve()
    await controller.started

    expect(transport.move).not.toHaveBeenCalled()
    expect(transport.end).not.toHaveBeenCalled()
  })

  it('finishes immediately while begin is pending', async () => {
    const begin = deferred()
    const transport = createTransport({ begin: vi.fn(() => begin.promise) })
    const controller = createDragController('pending', transport)
    controller.startDragging()

    const finish = controller.finish()

    expect(transport.end).toHaveBeenCalledWith('pending')
    await expect(finish).resolves.toBe(true)
    begin.resolve()
    await controller.started
  })

  it('finishes immediately while a move request is still in flight', async () => {
    const move = deferred()
    const transport = createTransport({ move: vi.fn(() => move.promise) })
    const controller = createDragController('dragging', transport)
    await controller.started
    controller.startDragging()
    controller.notifyMove()
    await vi.waitFor(() => expect(transport.move).toHaveBeenCalledOnce())

    const finish = controller.finish()
    await vi.waitFor(() => expect(transport.end).toHaveBeenCalledWith('dragging'))
    await expect(finish).resolves.toBe(true)

    move.resolve()
  })

  it('drops pending and future move notifications after finish', async () => {
    const begin = deferred()
    const transport = createTransport({ begin: vi.fn(() => begin.promise) })
    const controller = createDragController('closed', transport)
    controller.startDragging()
    controller.notifyMove()

    const finish = controller.finish()
    controller.notifyMove()
    await expect(finish).resolves.toBe(true)
    begin.resolve()
    await controller.started

    expect(transport.move).not.toHaveBeenCalled()
    expect(transport.end).toHaveBeenCalledWith('closed')
  })

  it('absorbs a synchronous end failure and stays closed', async () => {
    const transport = createTransport({
      end: vi.fn(() => { throw new Error('end failed') }),
    })
    const controller = createDragController('end-failed', transport)
    controller.startDragging()

    await expect(controller.finish()).resolves.toBe(false)

    expect(controller.isClosed()).toBe(true)
    expect(controller.startDragging()).toBe(false)
  })

  it('absorbs synchronous move failures and accepts later notifications', async () => {
    const transport = createTransport({
      move: vi.fn(() => { throw new Error('move failed') }),
    })
    const controller = createDragController('move-failed', transport)
    await controller.started
    controller.startDragging()

    controller.notifyMove()
    await vi.waitFor(() => expect(transport.move).toHaveBeenCalledTimes(1))
    controller.notifyMove()
    await vi.waitFor(() => expect(transport.move).toHaveBeenCalledTimes(2))

    await expect(controller.finish()).resolves.toBe(true)
  })

  it('absorbs a synchronous cancel failure and keeps terminal calls idempotent', async () => {
    const transport = createTransport({
      cancel: vi.fn(() => { throw new Error('cancel failed') }),
    })
    const controller = createDragController('cancel-failed', transport)

    const first = controller.cancel()
    const second = controller.cancel()
    const finish = controller.finish()

    await expect(Promise.all([first, second, finish])).resolves.toEqual([false, false, false])
    expect(transport.cancel).toHaveBeenCalledOnce()
    expect(transport.end).not.toHaveBeenCalled()
  })

  it('keeps candidate click cancellation available when begin fails', async () => {
    const transport = createTransport({
      begin: vi.fn().mockRejectedValue(new Error('begin failed')),
    })
    const controller = createDragController('failed', transport)
    controller.notifyMove()

    await expect(controller.started).resolves.toBe(false)
    await expect(controller.cancel()).resolves.toBe(true)

    expect(controller.isClosed()).toBe(true)
    expect(controller.startDragging()).toBe(false)
    expect(transport.move).not.toHaveBeenCalled()
    expect(transport.end).not.toHaveBeenCalled()
    expect(transport.cancel).toHaveBeenCalledWith('failed')
  })
})
