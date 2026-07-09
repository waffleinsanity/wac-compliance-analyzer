import { useEffect, useState } from 'react'
import { api, type StatsOut } from '../api'
import { ExternalLink, RefreshCw } from 'lucide-react'

export function StatsDashboard() {
  const [stats, setStats] = useState<StatsOut | null>(null)
  const [validation, setValidation] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setStats(await api.stats())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const validate = async (chapter: string) => {
    setValidation('Checking official source…')
    try {
      const res = await api.validate(chapter)
      setValidation(
        `${res.chapter}: ${res.reachable ? 'Reachable' : 'Unreachable'} · ${res.local_code_count} local codes · ${res.notes}`,
      )
    } catch (e) {
      setValidation(e instanceof Error ? e.message : 'Validation failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl">Statistics</h2>
            <p className="text-sm text-ink-500">Lightweight usage patterns across analyses</p>
          </div>
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {stats && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Analyses', stats.total_analyses],
              ['WAC Codes', stats.total_wac_codes],
              ['Hierarchy Nodes', stats.total_nodes],
              ['246-341 Codes', stats.chapter_breakdown['246-341'] || 0],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-2xl bg-ink-50 p-4 dark:bg-ink-950/50">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</div>
                <div className="mt-1 font-display text-3xl">{value as number}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-3 font-semibold">Most selected WACs</h3>
          <ul className="space-y-2">
            {(stats?.top_selected || []).map((r) => (
              <li key={r.wac_id} className="flex justify-between gap-3 text-sm">
                <span className="font-mono">{r.wac_id}</span>
                <span className="text-ink-500">{r.count}</span>
              </li>
            ))}
            {!stats?.top_selected?.length && <li className="text-sm text-ink-400">No data yet</li>}
          </ul>
        </div>
        <div className="panel p-4">
          <h3 className="mb-3 font-semibold">Most matched WACs</h3>
          <ul className="space-y-2">
            {(stats?.top_matched || []).map((r) => (
              <li key={r.wac_id} className="flex justify-between gap-3 text-sm">
                <span className="font-mono">{r.wac_id}</span>
                <span className="text-ink-500">{r.count}</span>
              </li>
            ))}
            {!stats?.top_matched?.length && <li className="text-sm text-ink-400">No data yet</li>}
          </ul>
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="mb-2 font-semibold">Optional web validation</h3>
        <p className="mb-3 text-sm text-ink-500">
          Cross-check local WAC inventory against the Washington Legislature site.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => validate('246-341')}>
            Validate 246-341
          </button>
          <button type="button" className="btn-secondary" onClick={() => validate('246-337')}>
            Validate 246-337
          </button>
          <a
            className="btn-secondary"
            href="https://app.leg.wa.gov/WAC/default.aspx?cite=246-341&full=true"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-4 w-4" /> Official 341
          </a>
          <a
            className="btn-secondary"
            href="https://app.leg.wa.gov/WAC/default.aspx?cite=246-337&full=true"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-4 w-4" /> Official 337
          </a>
        </div>
        {validation && (
          <p className="mt-3 rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-950/50">{validation}</p>
        )}
      </div>
    </div>
  )
}
