import React from 'react'

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function RequestLogList({ logs }: { logs?: any[] }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="glass-card p-8 rounded-xl text-center">
        <div className="text-muted-foreground text-sm">暂无日志</div>
      </div>
    )
  }
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-xs uppercase tracking-wider t-hint">
              <th className="text-left px-4 py-3 font-medium">时间</th>
              <th className="text-left px-4 py-3 font-medium">模型</th>
              <th className="text-left px-4 py-3 font-medium">消息</th>
              <th className="text-right px-4 py-3 font-medium">耗时</th>
              <th className="text-center px-4 py-3 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => {
              const success = log.success !== false && log.status !== 'error'
              return (
                <tr key={log.id || i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 t-hint whitespace-nowrap">{formatTime(log.timestamp)}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-cyan-400">{log.model || '-'}</span>
                  </td>
                  <td className="px-4 py-2.5 t-sub max-w-md truncate">{log.message || '-'}</td>
                  <td className="px-4 py-2.5 text-right t-hint whitespace-nowrap">
                    {log.duration ? `${log.duration}ms` : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {success ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        成功
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                        失败
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
