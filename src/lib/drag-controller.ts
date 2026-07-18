export interface DragTransport {
  begin: (sessionId: string) => Promise<void>
  move: (sessionId: string) => Promise<void>
  end: (sessionId: string) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
}

export interface DragController {
  started: Promise<boolean>
  startDragging: () => boolean
  notifyMove: () => void
  finish: () => Promise<boolean>
  cancel: () => Promise<boolean>
  isClosed: () => boolean
}

function invokeSafely(operation: () => Promise<void>): Promise<boolean> {
  try {
    return Promise.resolve(operation()).then(() => true, () => false)
  } catch {
    return Promise.resolve(false)
  }
}

export function createDragController(
  sessionId: string,
  transport: DragTransport,
): DragController {
  let phase: 'candidate' | 'dragging' | 'closed' = 'candidate'
  let movePending = false
  let movePump: Promise<void> | null = null
  let terminalPromise: Promise<boolean> | null = null
  let beginState: 'pending' | 'succeeded' | 'failed' = 'pending'

  const started = invokeSafely(() => transport.begin(sessionId)).then((succeeded) => {
    beginState = succeeded ? 'succeeded' : 'failed'
    if (!succeeded) movePending = false
    return succeeded
  })

  const startMovePump = () => {
    if (movePump || phase !== 'dragging') return

    const pump = (async () => {
      if (!await started) return
      while (phase === 'dragging' && movePending) {
        movePending = false
        await invokeSafely(() => transport.move(sessionId))
      }
    })()
    movePump = pump.finally(() => {
      movePump = null
      if (phase === 'dragging' && movePending) startMovePump()
    })
  }

  const close = (operation: DragTransport['end'] | DragTransport['cancel']) => {
    if (terminalPromise) return terminalPromise
    if (phase === 'closed') return Promise.resolve(false)

    phase = 'closed'
    movePending = false
    terminalPromise = invokeSafely(() => operation(sessionId))
    return terminalPromise
  }

  return {
    started,
    startDragging() {
      if (phase !== 'candidate' || beginState === 'failed') return false
      phase = 'dragging'
      return true
    },
    notifyMove() {
      if (phase !== 'dragging') return
      movePending = true
      startMovePump()
    },
    finish() {
      return close(phase === 'dragging' ? transport.end : transport.cancel)
    },
    cancel() {
      return close(transport.cancel)
    },
    isClosed() {
      return phase === 'closed'
    },
  }
}
