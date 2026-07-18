import { useEffect, useState } from 'react'
import { usePetStore } from '../stores/pet-store'
import { BubbleCard } from './BubbleCard'
import { TaskItem } from './TaskItem'

export type CheckinState = 'unknown' | 'idle' | 'submitting' | 'success' | 'already' | 'error'

export interface CheckinFeedback {
  state: CheckinState
  message: string
}

export const ORBIT_LAYOUT = {
  quota: { left: 10, top: 32, width: 146, height: 108 },
  tasks: { left: 196, top: 16, width: 174, height: 166 },
  checkin: { left: 10, top: 178, width: 140, height: 108 },
  actions: { left: 280, top: 278, width: 88, height: 142 },
  monkey: { left: 120, top: 290, width: 140, height: 140 },
} as const

export function initialCheckinFeedback(checkedIn: boolean | null): CheckinFeedback {
  if (checkedIn === true) return { state: 'already', message: '今日已签到' }
  if (checkedIn === false) return { state: 'idle', message: '签到领取今日额度' }
  return { state: 'unknown', message: '正在获取签到状态' }
}

export function syncCheckinFeedback(
  current: CheckinFeedback,
  checkedIn: boolean | null,
): CheckinFeedback {
  if (checkedIn === true) {
    return current.state === 'success'
      ? current
      : { state: 'already', message: '今日已签到' }
  }
  if (checkedIn === false
    && (current.state === 'unknown' || current.state === 'success' || current.state === 'already')) {
    return { state: 'idle', message: '签到领取今日额度' }
  }
  if (checkedIn === null && current.state !== 'submitting' && current.state !== 'error') {
    return { state: 'unknown', message: '正在获取签到状态' }
  }
  return current
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

interface OrbitStatusPanelProps {
  onLogout: () => Promise<void>
}

export function OrbitStatusPanel({ onLogout }: OrbitStatusPanelProps) {
  const wallet = usePetStore((state) => state.wallet)
  const tasks = usePetStore((state) => state.tasks)
  const online = usePetStore((state) => state.online)
  const error = usePetStore((state) => state.error)
  const checkedIn = usePetStore((state) => state.checkedIn)
  const recentTaskEvent = usePetStore((state) => state.recentTaskEvent)
  const [checkin, setCheckin] = useState<CheckinFeedback>(() => initialCheckinFeedback(checkedIn))
  const [refreshing, setRefreshing] = useState(false)
  const [openingPlatform, setOpeningPlatform] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    setCheckin((current) => syncCheckinFeedback(current, checkedIn))
  }, [checkedIn])

  useEffect(() => {
    if (checkin.state !== 'success' || checkedIn !== true) return
    const timer = setTimeout(() => {
      setCheckin({ state: 'already', message: '今日已签到' })
    }, 2_500)
    return () => clearTimeout(timer)
  }, [checkedIn, checkin.state])

  const dailyBalance = wallet?.daily_token_balance ?? 0
  const dailyLimit = wallet?.daily_token_limit ?? 0
  const quotaPercent = dailyLimit > 0
    ? Math.max(0, Math.min(100, (dailyBalance / dailyLimit) * 100))
    : 0
  const quotaLow = dailyLimit > 0 && quotaPercent < 10
  const activeTasks = tasks.slice(0, 3)
  const checkinDisabled = checkedIn !== false
    || checkin.state === 'submitting'
    || checkin.state === 'success'
    || checkin.state === 'already'
    || checkin.state === 'unknown'

  const handleCheckin = async () => {
    if (checkinDisabled) return
    setCheckin({ state: 'submitting', message: '正在安全签到...' })
    try {
      const result = await window.electronAPI.checkin()
      if (result.success) {
        setCheckin(result.already_checked_in
          ? { state: 'already', message: result.message }
          : { state: 'success', message: result.message })
        return
      }
      const message = result.message || result.error || '签到失败，请重试'
      setCheckin(usePetStore.getState().checkedIn
        ? { state: 'already', message: '今日已签到' }
        : { state: 'error', message })
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '签到失败，请重试'
      setCheckin(usePetStore.getState().checkedIn
        ? { state: 'already', message: '今日已签到' }
        : { state: 'error', message })
    }
  }

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setActionMessage('')
    try {
      await window.electronAPI.refresh()
    } catch {
      setActionMessage('刷新失败，请重试')
    } finally {
      setRefreshing(false)
    }
  }

  const handleOpenPlatform = async () => {
    if (openingPlatform) return
    setOpeningPlatform(true)
    setActionMessage('')
    try {
      await window.electronAPI.openExternal('https://monkeycode-ai.com')
    } catch {
      setActionMessage('打开平台失败')
    } finally {
      setOpeningPlatform(false)
    }
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  const checkinColor = checkin.state === 'error'
    ? '#d6455d'
    : checkin.state === 'success' || checkin.state === 'already'
      ? '#1f9d68'
      : '#667085'
  const checkinLabel = checkin.state === 'unknown'
    ? '签到状态同步中'
    : checkin.state === 'submitting'
      ? '正在签到'
      : checkin.state === 'success'
        ? '签到成功'
        : checkin.state === 'already' || checkedIn
          ? '今日已签到'
          : '立即签到'

  return (
    <div aria-label="MonkeyCode 状态面板" style={{ position: 'absolute', inset: 0 }}>
      <style>{`
        .orbit-action {
          border: 1px solid rgba(255, 255, 255, 0.72);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 6px 18px rgba(33, 47, 74, 0.12);
          color: #344054;
          cursor: pointer;
          font: 700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          min-height: 36px;
          transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
        }
        .orbit-action:hover { background: #ffffff; transform: translateY(-1px); }
        .orbit-action:active { transform: translateY(0); }
        .orbit-action:focus-visible { outline: 3px solid rgba(79, 124, 255, 0.38); outline-offset: 2px; }
        .orbit-action:disabled { cursor: wait; opacity: 0.58; transform: none; }
        .orbit-checkin {
          width: 100%;
          min-height: 36px;
          border: 0;
          border-radius: 10px;
          background: linear-gradient(135deg, #4f7cff, #7559e8);
          color: #ffffff;
          cursor: pointer;
          font: 800 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          transition: filter 120ms ease, transform 120ms ease;
        }
        .orbit-checkin:hover { filter: brightness(1.06); transform: translateY(-1px); }
        .orbit-checkin:active { transform: translateY(0); }
        .orbit-checkin:focus-visible { outline: 3px solid rgba(79, 124, 255, 0.38); outline-offset: 2px; }
        .orbit-checkin:disabled { background: #d0d5dd; color: #667085; cursor: default; filter: none; transform: none; }
      `}</style>

      <BubbleCard title="Daily quota" accent={quotaLow ? '#d6455d' : '#4f7cff'} style={ORBIT_LAYOUT.quota}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 5 }}>
          <strong style={{ color: quotaLow ? '#c93650' : '#1f2a44', fontSize: 22, lineHeight: 1 }}>
            {dailyLimit > 0 ? `${quotaPercent.toFixed(0)}%` : '--'}
          </strong>
          <span style={{ color: '#596579', fontSize: 10, textAlign: 'right' }}>
            {dailyLimit > 0 ? `${formatTokens(dailyBalance)} / ${formatTokens(dailyLimit)}` : '等待额度数据'}
          </span>
        </div>
        <div style={{ height: 5, marginTop: 9, overflow: 'hidden', borderRadius: 5, background: '#e7eaf0' }}>
          <div
            style={{
              width: `${quotaPercent}%`,
              height: '100%',
              borderRadius: 5,
              background: quotaLow ? '#d6455d' : 'linear-gradient(90deg, #4f7cff, #7559e8)',
              transition: 'width 240ms ease',
            }}
          />
        </div>
        <div style={{ marginTop: 7, color: !online || error ? '#c93650' : '#596579', fontSize: 10 }}>
          {!online ? '离线，显示最近数据' : error || `积分 ${formatTokens((wallet?.balance ?? 0) / 1000)}`}
        </div>
      </BubbleCard>

      <BubbleCard title="Active tasks" accent="#d99016" style={ORBIT_LAYOUT.tasks}>
        {activeTasks.length === 0 && !recentTaskEvent && (
          <div style={{ color: '#667085', fontSize: 11, lineHeight: '25px' }}>当前空闲</div>
        )}
        {activeTasks.map((task) => (
          <TaskItem
            key={task.id}
            title={task.title ?? '未命名任务'}
            status={task.status ?? 'pending'}
            createdAt={task.created_at}
          />
        ))}
        {recentTaskEvent && (
          <TaskItem
            title={recentTaskEvent.title ?? '最近任务'}
            status={recentTaskEvent.status}
            createdAt={recentTaskEvent.occurred_at}
          />
        )}
        <div style={{ marginTop: 5, color: '#596579', fontSize: 10 }}>
          {activeTasks.length > 0 ? `${activeTasks.length} 个任务运行中` : '15 秒自动同步'}
        </div>
      </BubbleCard>

      <BubbleCard title="Daily check-in" accent="#1f9d68" style={ORBIT_LAYOUT.checkin}>
        <button
          type="button"
          className="orbit-checkin"
          data-window-interactive
          aria-label={checkinLabel}
          disabled={checkinDisabled}
          onClick={() => void handleCheckin()}
        >
          {checkin.state === 'submitting'
            ? '签到中...'
            : checkin.state === 'success'
              ? '签到成功'
              : checkedIn || checkin.state === 'already'
                ? '今日已签到'
                : checkin.state === 'unknown'
                  ? '状态同步中'
                : '立即签到'}
        </button>
        <div
          role="status"
          style={{
            minHeight: 24,
            marginTop: 6,
            overflow: 'hidden',
            color: checkinColor,
            fontSize: 10,
            lineHeight: 1.3,
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          }}
        >
          {checkin.message}
        </div>
      </BubbleCard>

      <div
        data-window-interactive
        aria-label="桌宠操作"
        style={{ position: 'absolute', ...ORBIT_LAYOUT.actions, display: 'grid', gap: 6 }}
      >
        <button
          type="button"
          className="orbit-action"
          data-window-interactive
          aria-label="刷新桌宠数据"
          disabled={refreshing || openingPlatform || loggingOut}
          onClick={() => void handleRefresh()}
        >
          {refreshing ? '刷新中...' : '刷新数据'}
        </button>
        <button
          type="button"
          className="orbit-action"
          data-window-interactive
          aria-label="打开 MonkeyCode"
          disabled={openingPlatform || loggingOut}
          onClick={() => void handleOpenPlatform()}
        >
          {openingPlatform ? '打开中...' : '打开平台'}
        </button>
        <button
          type="button"
          className="orbit-action"
          data-window-interactive
          aria-label="退出登录"
          disabled={openingPlatform || loggingOut}
          onClick={() => void handleLogout()}
        >
          {loggingOut ? '退出中...' : '退出登录'}
        </button>
        {actionMessage && (
          <div role="status" style={{ color: '#c93650', fontSize: 10, textAlign: 'center' }}>
            {actionMessage}
          </div>
        )}
      </div>
    </div>
  )
}
