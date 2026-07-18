import { useState } from 'react';
import { usePetStore } from '../stores/pet-store';
import { TaskItem } from './TaskItem';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface BubbleCardProps {
  onLogout: () => void;
}

export function BubbleCard({ onLogout }: BubbleCardProps) {
  const [checkinState, setCheckinState] = useState<
    { loading: boolean; message: string; success: boolean }
  >({ loading: false, message: '', success: false });
  const wallet = usePetStore((s) => s.wallet);
  const tasks = usePetStore((s) => s.tasks);
  const online = usePetStore((s) => s.online);
  const error = usePetStore((s) => s.error);

  const balance = (wallet?.balance ?? 0) / 1000;
  const dailyBalance = wallet?.daily_token_balance ?? 0;
  const dailyLimit = wallet?.daily_token_limit ?? 1;
  const quotaPercent = dailyLimit > 0 ? (dailyBalance / dailyLimit) * 100 : 0;
  const barColor = quotaPercent > 10 ? '#4caf50' : '#f44336';

  const handleCheckin = async () => {
    if (checkinState.loading) return;
    setCheckinState({ loading: true, message: '', success: false });
    try {
      const result = await window.electronAPI.checkin();
      setCheckinState({
        loading: false,
        message: result.success ? '签到成功' : result.error || '签到失败，请重试',
        success: result.success,
      });
    } catch (error) {
      setCheckinState({
        loading: false,
        message: error instanceof Error ? error.message : '签到失败，请重试',
        success: false,
      });
    }
  };

  return (
    <div
      style={{
        width: 320,
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        padding: 16,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#333',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>MonkeyCode Status</div>

      {(!online || error) && (
        <div style={{ color: online ? '#c62828' : '#ef6c00', fontSize: 11, marginBottom: 10 }}>
          {error || '当前离线，正在保留最近一次数据'}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span>Daily Quota</span>
          <span>{quotaPercent.toFixed(1)}%</span>
        </div>
        <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(quotaPercent, 100)}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span>Remaining Tokens</span>
        <span>{formatTokens(dailyBalance)} / {formatTokens(dailyLimit)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 12 }}>
        <span>Credits</span>
        <span>{formatTokens(balance)}</span>
      </div>

      {tasks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Active Tasks</div>
          {tasks.map((t) => (
            <TaskItem
              key={t.id}
              title={t.title ?? '未命名任务'}
              status={t.status ?? 'unknown'}
              createdAt={t.created_at}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => window.electronAPI.openExternal('https://monkeycode-ai.com')}
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 6,
            background: '#1a73e8',
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Open MonkeyCode
        </button>
        <button
          onClick={() => void handleCheckin()}
          disabled={checkinState.loading}
          style={{
            flex: 1,
            padding: '8px 0',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: '#fff',
            color: '#333',
            fontSize: 13,
            cursor: checkinState.loading ? 'wait' : 'pointer',
          }}
        >
          {checkinState.loading ? 'Checking...' : 'Check-in'}
        </button>
      </div>
      {checkinState.message && (
        <div style={{ marginTop: 6, fontSize: 11, color: checkinState.success ? '#2e7d32' : '#c62828' }}>
          {checkinState.message}
        </div>
      )}
      <button
        onClick={onLogout}
        style={{ width: '100%', marginTop: 8, padding: 6, border: 0, background: 'transparent', color: '#777', cursor: 'pointer' }}
      >
        退出登录
      </button>
    </div>
  );
}
