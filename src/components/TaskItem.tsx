const statusIcons: Record<string, string> = {
  processing: '🔄',
  pending: '⏳',
  finished: '✅',
  error: '❌',
};

function minutesAgo(timestamp: number): string {
  const timestampMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const diff = Math.max(0, Math.floor((Date.now() - timestampMs) / 60000));
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TaskItemProps {
  title: string;
  status: string;
  createdAt?: number;
}

export function TaskItem({ title, status, createdAt }: TaskItemProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0',
        borderBottom: '1px solid #f0f0f0',
        fontSize: 13,
      }}
    >
      <span style={{ flexShrink: 0 }}>{statusIcons[status] ?? '❓'}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <span style={{ color: '#999', fontSize: 11, flexShrink: 0 }}>
        {createdAt === undefined ? '时间未知' : minutesAgo(createdAt)}
      </span>
    </div>
  );
}
