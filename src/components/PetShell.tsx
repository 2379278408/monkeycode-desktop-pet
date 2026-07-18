import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { MonkeySprite } from './MonkeySprite'
import { OrbitStatusPanel } from './OrbitStatusPanel'
import { usePetStore } from '../stores/pet-store'
import { classifyGesture } from '../lib/pointer-gesture'

interface PetShellProps {
  onLogout: () => Promise<void>
}

interface PointerSession {
  pointerId: number
  dragSessionId: string
  start: ScreenPoint
  dragging: boolean
  beginSucceeded: boolean
  beginPromise: Promise<void>
  latestMove: ScreenPoint | null
  movePump: Promise<void> | null
}

interface ScreenPoint {
  x: number
  y: number
}

interface PassthroughController {
  request: (enabled: boolean) => Promise<boolean>
  markApplied: (enabled: boolean) => void
  markUnknown: () => void
}

function safely(operation: Promise<void>): Promise<void> {
  return operation.catch(() => {})
}

function startMovePump(session: PointerSession): Promise<void> {
  if (session.movePump) return session.movePump

  const pump = (async () => {
    await session.beginPromise
    if (!session.beginSucceeded) {
      session.latestMove = null
      return
    }
    while (session.latestMove) {
      const point = session.latestMove
      session.latestMove = null
      await safely(window.electronAPI.moveDrag(session.dragSessionId, point.x, point.y))
    }
  })()
  session.movePump = pump.finally(() => {
    session.movePump = null
  })
  return session.movePump
}

async function drainMovePump(session: PointerSession): Promise<void> {
  while (session.latestMove || session.movePump) {
    await startMovePump(session)
  }
}

function createPassthroughController(): PassthroughController {
  let desired = false
  let applied: boolean | null = null
  let inFlight: Promise<boolean> | null = null

  const pump = (): Promise<boolean> => {
    if (inFlight) return inFlight
    if (applied === desired) return Promise.resolve(true)

    const operation = (async () => {
      while (applied !== desired) {
        const target = desired
        try {
          await window.electronAPI.setMousePassthrough(target)
          applied = target
        } catch {
          applied = null
          if (desired === target) return false
        }
      }
      return true
    })()
    inFlight = operation.finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    request(enabled) {
      desired = enabled
      return pump()
    },
    markApplied(enabled) {
      desired = enabled
      applied = enabled
    },
    markUnknown() {
      applied = null
    },
  }
}

export function PetShell({ onLogout }: PetShellProps) {
  const [showCard, setShowCard] = useState(false)
  const updateFromAPI = usePetStore((s) => s.updateFromAPI)
  const pointerSessionRef = useRef<PointerSession | null>(null)
  const draggingRef = useRef(false)
  const modeTransitionRef = useRef(false)
  const modeGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const passthroughControllerRef = useRef<PassthroughController | null>(null)
  if (!passthroughControllerRef.current) {
    passthroughControllerRef.current = createPassthroughController()
  }
  const passthroughController = passthroughControllerRef.current

  const setMousePassthrough = useCallback((enabled: boolean) => {
    void passthroughController.request(enabled)
  }, [passthroughController])

  const restorePassthroughAt = useCallback((clientX: number, clientY: number) => {
    const interactive = Boolean(
      document.elementFromPoint(clientX, clientY)?.closest('[data-window-interactive]'),
    )
    setMousePassthrough(!interactive)
  }, [setMousePassthrough])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onStateUpdate((data) => {
      updateFromAPI(data)
    })
    void window.electronAPI.startPolling().catch(() => {})
    return unsubscribe
  }, [updateFromAPI])

  useEffect(() => {
    mountedRef.current = true
    const handleMouseMove = (event: MouseEvent) => {
      if (pointerSessionRef.current || draggingRef.current || modeTransitionRef.current) {
        setMousePassthrough(false)
        return
      }
      restorePassthroughAt(event.clientX, event.clientY)
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      mountedRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      const session = pointerSessionRef.current
      pointerSessionRef.current = null
      if (session?.dragging) {
        void drainMovePump(session).then(() => session.beginSucceeded
          ? safely(window.electronAPI.endDrag(session.dragSessionId))
          : undefined)
      }
      draggingRef.current = false
      modeTransitionRef.current = false
      modeGenerationRef.current += 1
      void passthroughController.request(false)
    }
  }, [passthroughController, restorePassthroughAt, setMousePassthrough])

  const finishDrag = useCallback((session: PointerSession, screenX: number, screenY: number) => {
    session.latestMove = { x: screenX, y: screenY }
    void drainMovePump(session)
      .then(() => session.beginSucceeded
        ? safely(window.electronAPI.endDrag(session.dragSessionId))
        : undefined)
      .then(() => {
        draggingRef.current = false
        if (mountedRef.current) {
          restorePassthroughAt(screenX - window.screenX, screenY - window.screenY)
        }
      })
  }, [restorePassthroughAt])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0
      || pointerSessionRef.current
      || draggingRef.current
      || modeTransitionRef.current) return

    pointerSessionRef.current = {
      pointerId: event.pointerId,
      dragSessionId: crypto.randomUUID(),
      start: { x: event.screenX, y: event.screenY },
      dragging: false,
      beginSucceeded: false,
      beginPromise: Promise.resolve(),
      latestMove: null,
      movePump: null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setMousePassthrough(false)
  }, [setMousePassthrough])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return

    if (!session.dragging
      && classifyGesture(session.start, { x: event.screenX, y: event.screenY }, 5) === 'drag') {
      session.dragging = true
      draggingRef.current = true
      setMousePassthrough(false)
      session.beginPromise = window.electronAPI.beginDrag(
        session.dragSessionId,
        session.start.x,
        session.start.y,
      ).then(() => {
        session.beginSucceeded = true
      }).catch(() => {})
      session.latestMove = { x: event.screenX, y: event.screenY }
      void startMovePump(session)
      return
    }

    if (session.dragging) {
      session.latestMove = { x: event.screenX, y: event.screenY }
      void startMovePump(session)
    }
  }, [setMousePassthrough])

  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const toggleCard = useCallback((pointerScreenPosition?: ScreenPoint) => {
    const nextShowCard = !showCard
    const generation = modeGenerationRef.current + 1
    modeGenerationRef.current = generation
    modeTransitionRef.current = true

    const restoreAfterModeChange = () => {
      if (!pointerScreenPosition) {
        setMousePassthrough(false)
        return
      }
      const clientX = pointerScreenPosition.x - window.screenX
      const clientY = pointerScreenPosition.y - window.screenY
      restorePassthroughAt(clientX, clientY)
    }

    const changeMode = async () => {
      await passthroughController.request(false)
      if (!mountedRef.current || modeGenerationRef.current !== generation) return

      try {
        await window.electronAPI.setWindowMode(nextShowCard ? 'expanded' : 'collapsed')
        if (!mountedRef.current || modeGenerationRef.current !== generation) return
        passthroughController.markApplied(false)
        setShowCard(nextShowCard)
        modeTransitionRef.current = false
        restoreAfterModeChange()
      } catch {
        if (!mountedRef.current || modeGenerationRef.current !== generation) return
        modeTransitionRef.current = false
        passthroughController.markUnknown()
        restoreAfterModeChange()
      }
    }
    void changeMode()
  }, [passthroughController, restorePassthroughAt, setMousePassthrough, showCard])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    pointerSessionRef.current = null
    releasePointer(event)

    if (session.dragging) {
      finishDrag(session, event.screenX, event.screenY)
      return
    }

    toggleCard({ x: event.screenX, y: event.screenY })
  }, [finishDrag, toggleCard])

  const cancelPointerSession = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    shouldReleasePointer: boolean,
  ) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    pointerSessionRef.current = null
    if (shouldReleasePointer) releasePointer(event)

    if (session.dragging) {
      finishDrag(session, event.screenX, event.screenY)
    } else {
      restorePassthroughAt(event.clientX, event.clientY)
    }
  }, [finishDrag, restorePassthroughAt])

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    cancelPointerSession(event, true)
  }, [cancelPointerSession])

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    cancelPointerSession(event, false)
  }, [cancelPointerSession])

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        userSelect: 'none',
      }}
    >
      <style>{`
        .pet-monkey-control:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 3px rgba(79, 124, 255, 0.48);
          border-radius: 32px;
        }
      `}</style>
      {showCard && <OrbitStatusPanel onLogout={onLogout} />}
      <div
        className="pet-monkey-control"
        data-window-interactive
        role="button"
        tabIndex={0}
        aria-label={showCard ? '收起 MonkeyCode 状态面板' : '展开 MonkeyCode 状态面板'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if (event.repeat) return
          event.preventDefault()
          if (!pointerSessionRef.current && !draggingRef.current && !modeTransitionRef.current) {
            toggleCard()
          }
        }}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 0,
          transform: 'translateX(-50%)',
        }}
      >
        <MonkeySprite />
      </div>
    </div>
  )
}
