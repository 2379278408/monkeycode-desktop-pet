import { useState, useEffect } from 'react'
import { PetShell } from './components/PetShell'
import { LoginForm } from './components/LoginForm'

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)

  useEffect(() => {
    // 检查登录状态
    window.electronAPI.checkSession().then((result) => {
      setIsLoggedIn(result.logged_in)
    })
  }, [])

  // 还在检查状态
  if (isLoggedIn === null) {
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

  // 未登录，显示登录界面
  if (!isLoggedIn) {
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
          onLoginSuccess={() => {
            setIsLoggedIn(true)
            // 登录成功后缩小窗口到桌宠大小
            window.electronAPI.resizeWindow(200, 200)
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
      <PetShell />
    </div>
  )
}
