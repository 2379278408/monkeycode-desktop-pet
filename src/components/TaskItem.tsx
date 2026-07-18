const statusColors: Record<string, string> = {
  processing: '#4f7cff',
  pending: '#d99016',
  finished: '#1f9d68',
  error: '#d6455d',
}

const statusLabels: Record<string, string> = {
  processing: '执行中',
  pending: '等待中',
  finished: '已完成',
  error: '失败',
}

function minutesAgo(timestamp: number): string {
  const timestampMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  const diff = Math.max(0, Math.floor((Date.now() - timestampMs) / 60000))
  if (diff < 1) return '刚刚'
  if (diff < 60) return `${diff}m`
  const hours = Math.floor(diff / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

interface TaskItemProps {
  title: string
  status: string
  createdAt?: number
}

export function TaskItem({ title, status, createdAt }: TaskItemProps) {
  const statusLabel = statusLabels[status] ?? status
  return (
    <div
      aria-label={`${title}，${statusLabel}${createdAt === undefined ? '' : `，${minutesAgo(createdAt)}`}`}
      title={createdAt === undefined ? `${title} - ${statusLabel}` : `${title} - ${statusLabel} - ${minutesAgo(createdAt)}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '7px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 6,
        minHeight: 25,
        borderTop: '1px solid rgba(102, 112, 133, 0.12)',
        fontSize: 11,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: statusColors[status] ?? '#98a2b3',
          boxShadow: `0 0 0 3px ${(statusColors[status] ?? '#98a2b3')}1f`,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <span style={{ color: '#596579', fontSize: 10, fontWeight: 700 }}>
        {statusLabel}
      </span>
    </div>
  )
}
