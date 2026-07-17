import { useState } from 'react'

interface LoginFormProps {
  onLoginSuccess: () => void
}

export function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await window.electronAPI.login(email, password)
      if (result.success) {
        onLoginSuccess()
      } else {
        setError(result.error || 'Login failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        width: 280,
        padding: 20,
        background: 'rgba(0, 0, 0, 0.85)',
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: '#fff',
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        MonkeyCode Pet
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            width: '100%',
            padding: '8px 12px',
            marginBottom: 8,
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            width: '100%',
            padding: '8px 12px',
            marginBottom: 8,
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <div
            style={{
              color: '#ff6b6b',
              fontSize: 12,
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: loading ? '#555' : '#4f46e5',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>

      <div
        style={{
          marginTop: 12,
          textAlign: 'center',
        }}
      >
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI.openExternal('https://monkeycode-ai.com/register')
          }}
          style={{
            color: '#818cf8',
            fontSize: 11,
            textDecoration: 'none',
          }}
        >
          Don't have an account? Register
        </a>
      </div>
    </div>
  )
}
