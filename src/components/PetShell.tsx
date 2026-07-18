import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { MonkeySprite, stateLabels } from './MonkeySprite'
import { OrbitStatusPanel } from './OrbitStatusPanel'
import { usePetStore } from '../stores/pet-store'
import { classifyGesture } from '../lib/pointer-gesture'
import { createDragController, type DragController } from '../lib/drag-controller'

interface PetShellProps {
  onLogout: () => Promise<void>
}

interface PointerSession {
  pointerId: number
  start: ScreenPoint
  dragging: boolean
  closing: boolean
  controller: DragController
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
  const petState = usePetStore((state) => state.petState)
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

  const closePointerSession = useCallback((
    session: PointerSession,
    terminal: 'finish' | 'cancel',
    onSettled: () => void,
  ) => {
    if (session.closing) return
    session.closing = true
    const operation = terminal === 'finish'
      ? session.controller.finish()
      : session.controller.cancel()
    void operation.finally(() => {
      if (pointerSessionRef.current === session) pointerSessionRef.current = null
      draggingRef.current = false
      onSettled()
    }).catch(() => {})
  }, [])

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
      if (session) {
        const terminal = session.dragging
          ? session.controller.finish()
          : session.controller.cancel()
        void terminal.finally(() => {
          if (pointerSessionRef.current === session) pointerSessionRef.current = null
          draggingRef.current = false
          void passthroughController.request(false)
        }).catch(() => {})
      } else {
        draggingRef.current = false
        void passthroughController.request(false)
      }
      modeTransitionRef.current = false
      modeGenerationRef.current += 1
    }
  }, [passthroughController, restorePassthroughAt, setMousePassthrough])

  const finishDrag = useCallback((session: PointerSession, screenX: number, screenY: number) => {
    closePointerSession(session, 'finish', () => {
      if (mountedRef.current) {
        restorePassthroughAt(screenX - window.screenX, screenY - window.screenY)
      }
    })
  }, [closePointerSession, restorePassthroughAt])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0
      || pointerSessionRef.current
      || draggingRef.current
      || modeTransitionRef.current) return

    const dragSessionId = crypto.randomUUID()
    const controller = createDragController(dragSessionId, {
      begin: window.electronAPI.beginDrag,
      move: window.electronAPI.moveDrag,
      end: window.electronAPI.endDrag,
      cancel: window.electronAPI.cancelDrag,
    })
    const session: PointerSession = {
      pointerId: event.pointerId,
      start: { x: event.screenX, y: event.screenY },
      dragging: false,
      closing: false,
      controller,
    }
    pointerSessionRef.current = session
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      closePointerSession(session, 'cancel', () => {
        if (mountedRef.current) restorePassthroughAt(event.clientX, event.clientY)
      })
      return
    }
    setMousePassthrough(false)
  }, [closePointerSession, restorePassthroughAt, setMousePassthrough])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return

    if (!session.dragging
      && classifyGesture(session.start, { x: event.screenX, y: event.screenY }, 5) === 'drag') {
      if (!session.controller.startDragging()) return
      session.dragging = true
      draggingRef.current = true
      setMousePassthrough(false)
      session.controller.notifyMove()
      return
    }

    if (session.dragging) {
      session.controller.notifyMove()
    }
  }, [setMousePassthrough])

  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {}
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

    if (session.dragging) {
      finishDrag(session, event.screenX, event.screenY)
      releasePointer(event)
      return
    }

    closePointerSession(session, 'cancel', () => {
      if (mountedRef.current) toggleCard({ x: event.screenX, y: event.screenY })
    })
    releasePointer(event)
  }, [closePointerSession, finishDrag, toggleCard])

  const cancelPointerSession = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    shouldReleasePointer: boolean,
  ) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return

    if (session.dragging) {
      finishDrag(session, event.screenX, event.screenY)
    } else {
      closePointerSession(session, 'cancel', () => {
        if (mountedRef.current) restorePassthroughAt(event.clientX, event.clientY)
      })
    }
    if (shouldReleasePointer) releasePointer(event)
  }, [closePointerSession, finishDrag, restorePassthroughAt])

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
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {stateLabels[petState]}
      </div>
      {showCard && <OrbitStatusPanel onLogout={onLogout} />}
      <div
        className="pet-monkey-control"
        data-window-interactive
        role="button"
        tabIndex={0}
        aria-label={`${stateLabels[petState]}，${showCard ? '收起状态面板' : '展开状态面板'}`}
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
