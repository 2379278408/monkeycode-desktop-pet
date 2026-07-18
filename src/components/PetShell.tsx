import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { MonkeySprite, actionLabels } from './MonkeySprite'
import { OrbitStatusPanel } from './OrbitStatusPanel'
import { usePetStore, type TaskTerminalEvent } from '../stores/pet-store'
import { usePetLifeStore } from '../stores/pet-life-store'
import {
  appendGesturePoint,
  classifyReleaseIntent,
  type GestureSession,
  type PointerIntent,
} from '../lib/pointer-gesture'
import { createDragController, type DragController } from '../lib/drag-controller'
import {
  selectPetAction,
  type PetInteractionAction,
  type PetLifeAction,
} from '../lib/pet-action'

export const PET_LIFE_TICK_MS = 60_000

type TemporaryPetAction = Exclude<PetInteractionAction, 'dragging'> | PetLifeAction

export function petActionDuration(action: TemporaryPetAction): number {
  if (action === 'dropping') return 360
  if (action === 'waking') return 1_000
  return 1_500
}

export function pettingDurationSeconds(firstPointAt: number, releasedAt: number): number {
  return Math.max(0, (releasedAt - firstPointAt) / 1_000)
}

export function taskResultEventKey(event: TaskTerminalEvent): string {
  return JSON.stringify([event.task_id, event.status, event.occurred_at])
}

interface PetLifeClockCommands {
  hydrate: (now: number) => Promise<void>
  tick: (now: number) => void
}

export function startPetLifeClock(
  commands: PetLifeClockCommands,
  now: () => number = Date.now,
): () => void {
  try {
    void commands.hydrate(now()).catch(() => {})
  } catch {}

  const interval = setInterval(() => {
    try {
      commands.tick(now())
    } catch {}
  }, PET_LIFE_TICK_MS)
  return () => clearInterval(interval)
}

interface PetShellProps {
  onLogout: () => Promise<void>
}

interface PointerSession {
  pointerId: number
  gesture: GestureSession
  dragging: boolean
  petStartedAt: number | null
  closing: boolean
  holdTimer: ReturnType<typeof setTimeout> | null
  captureTarget: HTMLDivElement
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
  const [interactionAction, setInteractionAction] = useState<PetInteractionAction | null>(null)
  const [lifeAction, setLifeAction] = useState<PetLifeAction | null>(null)
  const petState = usePetStore((state) => state.petState)
  const recentTaskEvent = usePetStore((state) => state.recentTaskEvent)
  const updateFromAPI = usePetStore((s) => s.updateFromAPI)
  const form = usePetLifeStore((state) => state.form)
  const hydrate = usePetLifeStore((state) => state.hydrate)
  const tick = usePetLifeStore((state) => state.tick)
  const recordTaskResult = usePetLifeStore((state) => state.recordTaskResult)
  const petAction = selectPetAction({
    interaction: interactionAction,
    lifeAction,
    business: petState,
    form,
  })
  const pointerSessionRef = useRef<PointerSession | null>(null)
  const latestPointerScreenPositionRef = useRef<ScreenPoint | null>(null)
  const previousClickAtRef = useRef<number | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lifeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draggingRef = useRef(false)
  const modeTransitionRef = useRef(false)
  const modeGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const passthroughControllerRef = useRef<PassthroughController | null>(null)
  if (!passthroughControllerRef.current) {
    passthroughControllerRef.current = createPassthroughController()
  }
  const passthroughController = passthroughControllerRef.current

  const clearInteractionAction = useCallback(() => {
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current)
    interactionTimerRef.current = null
    setInteractionAction(null)
  }, [])

  const showInteractionAction = useCallback((action: PetInteractionAction) => {
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current)
    interactionTimerRef.current = null
    setInteractionAction(action)
    if (action === 'dragging') return

    const timer = setTimeout(() => {
      if (interactionTimerRef.current !== timer) return
      interactionTimerRef.current = null
      setInteractionAction(null)
    }, petActionDuration(action))
    interactionTimerRef.current = timer
  }, [])

  const showLifeAction = useCallback((action: PetLifeAction) => {
    if (lifeTimerRef.current) clearTimeout(lifeTimerRef.current)
    setLifeAction(action)
    const timer = setTimeout(() => {
      if (lifeTimerRef.current !== timer) return
      lifeTimerRef.current = null
      setLifeAction(null)
    }, petActionDuration(action))
    lifeTimerRef.current = timer
  }, [])

  const setMousePassthrough = useCallback((enabled: boolean) => {
    void passthroughController.request(enabled)
  }, [passthroughController])

  const restorePassthroughAt = useCallback((clientX: number, clientY: number) => {
    const interactive = Boolean(
      document.elementFromPoint(clientX, clientY)?.closest('[data-window-interactive]'),
    )
    setMousePassthrough(!interactive)
  }, [setMousePassthrough])

  const restorePassthroughAtLatestPointer = useCallback(() => {
    const position = latestPointerScreenPositionRef.current
    if (!position) {
      setMousePassthrough(false)
      return
    }
    restorePassthroughAt(
      position.x - window.screenX,
      position.y - window.screenY,
    )
  }, [restorePassthroughAt, setMousePassthrough])

  const closePointerSession = useCallback((
    session: PointerSession,
    terminal: 'finish' | 'cancel',
    onSettled: () => void,
  ) => {
    if (session.closing) return
    session.closing = true
    if (session.holdTimer) {
      clearTimeout(session.holdTimer)
      session.holdTimer = null
    }
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
    return startPetLifeClock({ hydrate, tick })
  }, [hydrate, tick])

  useEffect(() => {
    if (!recentTaskEvent) return
    recordTaskResult(
      recentTaskEvent.status,
      taskResultEventKey(recentTaskEvent),
      recentTaskEvent.occurred_at,
    )
  }, [recentTaskEvent, recordTaskResult])

  useEffect(() => {
    mountedRef.current = true
    const handleMouseMove = (event: MouseEvent) => {
      latestPointerScreenPositionRef.current = { x: event.screenX, y: event.screenY }
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
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current)
      if (lifeTimerRef.current) clearTimeout(lifeTimerRef.current)
      interactionTimerRef.current = null
      lifeTimerRef.current = null
      if (session) {
        if (session.holdTimer) clearTimeout(session.holdTimer)
        try {
          if (session.captureTarget.hasPointerCapture(session.pointerId)) {
            session.captureTarget.releasePointerCapture(session.pointerId)
          }
        } catch {}
        const terminal = session.controller.cancel()
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

  const finishDrag = useCallback((session: PointerSession) => {
    if (session.closing) return
    session.closing = true
    if (session.holdTimer) {
      clearTimeout(session.holdTimer)
      session.holdTimer = null
    }
    void session.controller.finish().then((finished) => {
      if (pointerSessionRef.current === session) pointerSessionRef.current = null
      draggingRef.current = false
      if (!mountedRef.current) return
      if (finished) showInteractionAction('dropping')
      else clearInteractionAction()
      restorePassthroughAtLatestPointer()
    }).catch(() => {})
  }, [clearInteractionAction, restorePassthroughAtLatestPointer, showInteractionAction])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0
      || pointerSessionRef.current
      || draggingRef.current
      || modeTransitionRef.current) return
    latestPointerScreenPositionRef.current = { x: event.screenX, y: event.screenY }

    const dragSessionId = crypto.randomUUID()
    const controller = createDragController(dragSessionId, {
      begin: window.electronAPI.beginDrag,
      move: window.electronAPI.moveDrag,
      end: window.electronAPI.endDrag,
      cancel: window.electronAPI.cancelDrag,
    })
    const session: PointerSession = {
      pointerId: event.pointerId,
      gesture: {
        points: [{ x: event.screenX, y: event.screenY, at: event.timeStamp }],
        previousClickAt: previousClickAtRef.current,
        lockedIntent: null,
      },
      dragging: false,
      petStartedAt: null,
      closing: false,
      holdTimer: null,
      captureTarget: event.currentTarget,
      controller,
    }
    pointerSessionRef.current = session
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      closePointerSession(session, 'cancel', () => {
        if (mountedRef.current) restorePassthroughAtLatestPointer()
      })
      return
    }
    const startedAt = event.timeStamp
    session.holdTimer = setTimeout(() => {
      if (!mountedRef.current || pointerSessionRef.current !== session || session.closing) return
      session.holdTimer = null
      const latestPoint = session.gesture.points[session.gesture.points.length - 1]
      session.gesture = appendGesturePoint(session.gesture, {
        x: latestPoint.x,
        y: latestPoint.y,
        at: Math.max(latestPoint.at, startedAt + 350),
      })
      if (session.gesture.lockedIntent === 'pet-candidate') {
        session.petStartedAt = startedAt + 350
      }
    }, 350)
    setMousePassthrough(false)
  }, [closePointerSession, restorePassthroughAtLatestPointer, setMousePassthrough])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    latestPointerScreenPositionRef.current = { x: event.screenX, y: event.screenY }

    const previousIntent = session.gesture.lockedIntent
    session.gesture = appendGesturePoint(session.gesture, {
      x: event.screenX,
      y: event.screenY,
      at: event.timeStamp,
    })
    if (session.petStartedAt === null
      && previousIntent !== 'pet-candidate'
      && session.gesture.lockedIntent === 'pet-candidate') {
      const pressedAt = session.gesture.origin?.at ?? session.gesture.points[0]?.at ?? event.timeStamp
      session.petStartedAt = pressedAt + 350
    }
    if (session.gesture.lockedIntent === 'pet-candidate'
      || session.gesture.lockedIntent === 'pet') {
      if (session.holdTimer) {
        clearTimeout(session.holdTimer)
        session.holdTimer = null
      }
    }
    if (!session.dragging && session.gesture.lockedIntent === 'drag') {
      if (session.holdTimer) {
        clearTimeout(session.holdTimer)
        session.holdTimer = null
      }
      if (!session.controller.startDragging()) return
      session.dragging = true
      draggingRef.current = true
      void session.controller.started.then((started) => {
        if (!mountedRef.current || pointerSessionRef.current !== session || session.closing) return
        if (started) {
          showInteractionAction('dragging')
          return
        }
        closePointerSession(session, 'cancel', () => {
          if (!mountedRef.current) return
          clearInteractionAction()
          restorePassthroughAtLatestPointer()
        })
      })
      setMousePassthrough(false)
      session.controller.notifyMove()
      return
    }

    if (session.dragging) {
      session.controller.notifyMove()
    }
  }, [clearInteractionAction, closePointerSession, restorePassthroughAtLatestPointer, setMousePassthrough, showInteractionAction])

  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {}
  }

  const toggleCard = useCallback((restoreAtPointer = false) => {
    const nextShowCard = !showCard
    const generation = modeGenerationRef.current + 1
    modeGenerationRef.current = generation
    modeTransitionRef.current = true

    const restoreAfterModeChange = () => {
      if (!restoreAtPointer) {
        setMousePassthrough(false)
        return
      }
      restorePassthroughAtLatestPointer()
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
  }, [passthroughController, restorePassthroughAtLatestPointer, setMousePassthrough, showCard])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    latestPointerScreenPositionRef.current = { x: event.screenX, y: event.screenY }

    session.gesture = appendGesturePoint(session.gesture, {
      x: event.screenX,
      y: event.screenY,
      at: event.timeStamp,
    })
    const intent = classifyReleaseIntent(session.gesture)
    if (intent === 'drag' && !session.dragging && session.controller.startDragging()) {
      session.dragging = true
      draggingRef.current = true
    }
    if (session.dragging) {
      finishDrag(session)
      releasePointer(event)
      return
    }

    const releasedAt = event.timeStamp
    const runIntent = (releasedIntent: PointerIntent | null) => {
      if (releasedIntent === null) {
        restorePassthroughAtLatestPointer()
        return
      }
      if (releasedIntent === 'pet') {
        const firstPointAt = session.petStartedAt ?? releasedAt
        usePetLifeStore.getState().interact({
          type: 'pet',
          seconds: pettingDurationSeconds(firstPointAt, releasedAt),
        }, Date.now())
        showInteractionAction('petting')
        restorePassthroughAtLatestPointer()
        return
      }
      if (releasedIntent === 'double-click') {
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
        previousClickAtRef.current = null
        usePetLifeStore.getState().interact('double-click', Date.now())
        showInteractionAction('celebrating')
        restorePassthroughAtLatestPointer()
        return
      }
      if (releasedIntent === 'click') {
        previousClickAtRef.current = releasedAt
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
        clickTimerRef.current = setTimeout(() => {
          clickTimerRef.current = null
          previousClickAtRef.current = null
          if (!mountedRef.current) return
          const lifeStore = usePetLifeStore.getState()
          if (lifeStore.snapshot.sleeping) {
            lifeStore.wake(Date.now())
            showLifeAction('waking')
            return
          }
          lifeStore.interact('click', Date.now())
          showInteractionAction('waving')
          toggleCard(true)
        }, 301)
      }
    }
    if (session.holdTimer) clearTimeout(session.holdTimer)
    session.holdTimer = null
    session.closing = true
    pointerSessionRef.current = null
    draggingRef.current = false
    void session.controller.cancel().catch(() => {})
    runIntent(intent)
    releasePointer(event)
  }, [finishDrag, restorePassthroughAtLatestPointer, showInteractionAction, showLifeAction, toggleCard])

  const cancelPointerSession = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    shouldReleasePointer: boolean,
  ) => {
    const session = pointerSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    latestPointerScreenPositionRef.current = { x: event.screenX, y: event.screenY }

    closePointerSession(session, 'cancel', () => {
      if (mountedRef.current) {
        clearInteractionAction()
        restorePassthroughAtLatestPointer()
      }
    })
    if (shouldReleasePointer) releasePointer(event)
  }, [clearInteractionAction, closePointerSession, restorePassthroughAtLatestPointer])

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
        {actionLabels[petAction]}
      </div>
      {showCard && (
        <OrbitStatusPanel
          onLogout={onLogout}
          lifeAction={lifeAction}
          onLifeAction={showLifeAction}
        />
      )}
      <div
        className="pet-monkey-control"
        data-window-interactive
        role="button"
        tabIndex={0}
        aria-label={`${actionLabels[petAction]}，${showCard ? '收起状态面板' : '展开状态面板'}`}
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
        <MonkeySprite action={petAction} fallbackAction={form} />
      </div>
    </div>
  )
}
