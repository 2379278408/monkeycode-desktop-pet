import { useState, useCallback, useEffect } from 'react'
import { MonkeySprite } from './MonkeySprite'
import { BubbleCard } from './BubbleCard'
import { usePetStore } from '../stores/pet-store'

interface PetShellProps {
  onLogout: () => void
}

export function PetShell({ onLogout }: PetShellProps) {
  const [showCard, setShowCard] = useState(false)
  const updateFromAPI = usePetStore((s) => s.updateFromAPI)

  useEffect(() => {
    const unsubscribe = window.electronAPI.onStateUpdate((data) => {
      updateFromAPI(data)
    })
    void window.electronAPI.startPolling()
    return unsubscribe
  }, [updateFromAPI])

  const handleMonkeyClick = useCallback(() => {
    setShowCard((prev) => !prev)
  }, [])

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      {showCard && <BubbleCard onLogout={onLogout} />}
      <div onClick={handleMonkeyClick}>
        <MonkeySprite />
      </div>
    </div>
  )
}
