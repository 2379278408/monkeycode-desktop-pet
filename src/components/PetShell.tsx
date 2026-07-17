import { useState, useCallback, useEffect } from 'react'
import { MonkeySprite } from './MonkeySprite'
import { BubbleCard } from './BubbleCard'
import { usePetStore } from '../stores/pet-store'

export function PetShell() {
  const [showCard, setShowCard] = useState(false)
  const updateFromAPI = usePetStore((s) => s.updateFromAPI)

  useEffect(() => {
    window.electronAPI.onStateUpdate((data) => {
      updateFromAPI(data)
    })
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
      {showCard && <BubbleCard />}
      <div onClick={handleMonkeyClick}>
        <MonkeySprite />
      </div>
    </div>
  )
}
