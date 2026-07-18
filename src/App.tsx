import { useEffect, useState } from 'react'
import { PetShell } from './components/PetShell'
import { LoginForm } from './components/LoginForm'
import { usePetStore } from './stores/pet-store'

async function checkSessionWithTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('启动检查超时，请重试')), 15_000)
  })
  try {
    return await Promise.race([window.electronAPI.checkSession(), timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export default function App() {
  const resetPetState = usePetStore((state) => state.reset)
  const [authState, setAuthState] = useState<
    'loading' | 'signed-out' | 'signed-in' | 'offline'
  >('loading')
  const [startupError, setStartupError] = useState('')

  const runSessionCheck = () => {
    setAuthState('loading')
    void checkSessionWithTimeout()
      .then((result) => {
        setAuthState(result.logged_in ? 'signed-in' : result.offline ? 'offline' : 'signed-out')
        setStartupError(result.error ?? '')
      })
      .catch((error: unknown) => {
        setAuthState('signed-out')
        setStartupError(error instanceof Error ? error.message : '启动失败，请重试')
      })
  }

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAuthExpired(() => {
      resetPetState()
      setAuthState('signed-out')
      setStartupError('登录状态已失效，请重新登录')
    })
    runSessionCheck()

    return unsubscribe
  }, [])

  const handleLogout = async () => {
    try {
      await window.electronAPI.logout()
      resetPetState()
      setStartupError('')
      setAuthState('signed-out')
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : '退出登录失败，请重试')
      setAuthState('offline')
    }
  }

  // 还在检查状态
  if (authState === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'transparent',
          color: '#fff',
          fontSize: 12,
        }}
      >
        Loading...
      </div>
    )
  }

  if (authState === 'offline') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div style={{ width: 280, padding: 20, borderRadius: 12, background: 'rgba(0,0,0,.86)', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>MonkeyCode 暂时离线</div>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 16 }}>
            {startupError || '已保留本地登录状态，请检查网络后重试'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={runSessionCheck} style={{ flex: 1, padding: 8 }}>重试</button>
            <button onClick={() => void handleLogout()} style={{ flex: 1, padding: 8 }}>退出登录</button>
          </div>
        </div>
      </div>
    )
  }

  // 未登录，显示登录界面
  if (authState === 'signed-out') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'transparent',
        }}
      >
        <LoginForm
          initialError={startupError}
          onLoginSuccess={() => {
            setStartupError('')
            setAuthState('signed-in')
            void window.electronAPI.resizeWindow(380, 430)
          }}
        />
      </div>
    )
  }

  // 已登录，显示桌宠
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'transparent',
      }}
    >
      <PetShell onLogout={() => void handleLogout()} />
    </div>
  )
}
