import { ShieldAlert } from 'lucide-react'
import type { PrivacyScanResult } from '../api'

const KIND_LABELS: Record<string, string> = {
  ssn: 'Social Security number',
  itin: 'ITIN',
  mrn: 'Medical / patient ID',
  drivers_license: 'Driver license',
  email: 'Email',
  phone: 'Phone',
  dob: 'Date of birth',
  address: 'Street address',
  zip: 'ZIP code',
  name: 'Personal name',
  clinical_phi: 'Clinical / diagnosis PHI',
}

type Props = {
  open: boolean
  scan: PrivacyScanResult | null
  busy?: boolean
  onCancel: () => void
  onContinueRedact: () => void
}

export function PrivacyGate({ open, scan, busy = false, onCancel, onContinueRedact }: Props) {
  if (!open || !scan) return null

  const byKind = scan.summary.by_kind || {}
  const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1])
  const snippetHits = (scan.hits || []).slice(0, 2)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/55 p-4 backdrop-blur-sm">
      <div className="panel max-h-[90vh] w-full max-w-lg animate-rise overflow-y-auto p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl tracking-tight">Category 3/4 information detected</h2>
            <p className="mt-2 text-sm text-ink-500">
              {scan.summary.message ||
                'Possible PII/PHI was found. Public Category 1 content may remain. This is an assistive check, not a legal determination.'}
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm">
          <div className="font-semibold text-amber-900 dark:text-amber-200">
            {scan.hit_count} span{scan.hit_count === 1 ? '' : 's'} flagged
          </div>
          <ul className="mt-2 space-y-1 text-amber-950/80 dark:text-amber-100/80">
            {kinds.map(([kind, count]) => (
              <li key={kind} className="flex justify-between gap-3">
                <span>{KIND_LABELS[kind] || kind}</span>
                <span className="font-mono text-xs">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        {snippetHits.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
              Example flagged span{snippetHits.length === 1 ? '' : 's'}
            </p>
            {snippetHits.map((hit) => {
              const preview = hit.preview || '***'
              const segments = highlightPrivacySegments(preview, [
                { start: 0, end: preview.length, kind: hit.kind },
              ])
              return (
                <div
                  key={hit.id}
                  className="rounded-xl border border-ink-200/80 bg-ink-50/80 px-3 py-2.5 text-sm dark:border-ink-700 dark:bg-ink-900/40"
                >
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    {KIND_LABELS[hit.kind] || hit.kind}
                  </div>
                  <p className="whitespace-pre-wrap break-words font-serif text-[15px] leading-relaxed text-ink-800 dark:text-ink-100">
                    {segments.map((seg) =>
                      seg.hit ? (
                        <mark
                          key={seg.key}
                          className="rounded-sm bg-amber-300/70 px-0.5 text-ink-950 dark:bg-amber-500/50 dark:text-ink-50"
                          title={seg.kind}
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={seg.key}>{seg.text}</span>
                      ),
                    )}
                  </p>
                </div>
              )
            })}
            <p className="text-[11px] leading-relaxed text-ink-500">
              Detection is assistive and may miss or over-flag spans. It is not a legal or compliance
              determination. Previews are masked; full spans remain highlighted in the complaint field.
            </p>
          </div>
        )}

        <div className="mb-5 space-y-3 text-xs leading-relaxed text-ink-500">
          <p>
            <strong className="font-semibold text-ink-700 dark:text-ink-200">Cancel — edit text</strong>{' '}
            closes this dialog so you can change the narrative and try again. If you remove the flagged
            spans yourself, redaction is optional.
          </p>
          <p>
            <strong className="font-semibold text-ink-700 dark:text-ink-200">Continue and redact</strong>{' '}
            permanently replaces flagged spans with tokens such as{' '}
            <span className="font-mono">[REDACTED_SSN]</span> in this workspace. Only the redacted text is
            saved or sent for draft generation. Original identifiers are not retained.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel — edit text
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={onContinueRedact}>
            {busy ? 'Redacting…' : 'Continue and redact'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Build highlighted HTML segments for a complaint preview (escaped). */
export function highlightPrivacySegments(
  text: string,
  hits: { start: number; end: number; kind: string }[],
): { key: string; text: string; hit?: boolean; kind?: string }[] {
  if (!hits.length) return [{ key: 'all', text }]
  const ordered = [...hits].sort((a, b) => a.start - b.start)
  const parts: { key: string; text: string; hit?: boolean; kind?: string }[] = []
  let cursor = 0
  ordered.forEach((h, i) => {
    if (h.start > cursor) {
      parts.push({ key: `t${i}`, text: text.slice(cursor, h.start) })
    }
    parts.push({
      key: `h${i}`,
      text: text.slice(h.start, h.end),
      hit: true,
      kind: h.kind,
    })
    cursor = h.end
  })
  if (cursor < text.length) parts.push({ key: 'tail', text: text.slice(cursor) })
  return parts
}
