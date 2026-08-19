import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'
import type {
  AllegationDutyOption,
  CaseDetail,
  InvestigationReport,
  QuoteFailure,
  StatuteHit,
  WACComparison,
} from '../api'
import { api } from '../api'
import { quoteFailureLabel } from '../investigatorLabels'
import { composeAllegationFromDuties, allegationHasShortcut, normalizeAllegationLine } from '../allegationFormat'
import { applicationStrengthFromMatch } from '../applicationStrength'
import { ApplicationStrengthBadge } from './ApplicationStrengthBadge'
import { IrTemplatePicker } from './IrTemplatePicker'
import { StatuteOutline } from './StatuteOutline'
import { StatuteSearchPanel } from './StatuteSearchPanel'

function dutyLabelFromCite(cite: string, code: string): string {
  const bare = code.replace(/^WAC\s+/i, '').replace(/^RCW\s+/i, '').trim()
  const idx = cite.indexOf(bare)
  if (idx >= 0) return cite.slice(idx + bare.length)
  const m = cite.match(/((?:\([^)]+\))+)$/)
  return m ? m[1] : ''
}

function sortedDutyOptions(
  opts: AllegationDutyOption[],
  selectedCites: string[],
): AllegationDutyOption[] {
  const selected = new Set(selectedCites)
  return [...opts].sort((a, b) => {
    const aSel = selected.has(a.cite) ? 0 : 1
    const bSel = selected.has(b.cite) ? 0 : 1
    if (aSel !== bSel) return aSel - bSel
    if (a.picked_from_outline && !b.picked_from_outline) return 1
    if (!a.picked_from_outline && b.picked_from_outline) return -1
    return (b.score || 0) - (a.score || 0)
  })
}

type Props = {
  comparisons: WACComparison[]
  complaintText: string
  report?: InvestigationReport | null
  onReportChange?: (report: InvestigationReport) => void
  onBack: () => void
  /** Called with confirmed WAC ids after investigator confirms cites. */
  onContinue: (confirmedCodes: string[]) => void
  busy: boolean
  /** Optional research — find additional WACs/RCWs that may apply more strongly. */
  statuteHits?: StatuteHit[]
  searchBusy?: boolean
  onSearchStatutes?: () => void
  onAddCode?: (codeId: string) => void
  selectedIds?: string[]
  caseId?: number | null
  caseDetail?: CaseDetail | null
  onCaseRefresh?: () => void | Promise<void>
}

function hasMatchedDuties(c: WACComparison): boolean {
  return Boolean(
    (c.duty_options && c.duty_options.length > 0) ||
      (c.matched_subsections && c.matched_subsections.length > 0),
  )
}

/** Codes with no matched duties / none application must not be auto-confirmed. */
function autoConfirmable(c: WACComparison): boolean {
  if (!hasMatchedDuties(c)) return false
  return (
    applicationStrengthFromMatch({
      score: c.match_score,
      reason: c.match_reason,
      lowConfidence: c.low_confidence,
    }) !== 'none'
  )
}

function needsManualReview(c: WACComparison): boolean {
  return !autoConfirmable(c)
}

function AccuracyNote({ comparison }: { comparison: WACComparison }) {
  if (comparison.quote_ok === false) {
    return (
      <span className="font-sans text-xs text-rose-700 dark:text-rose-300">Needs statute review</span>
    )
  }
  if (comparison.low_confidence) {
    return (
      <span className="font-sans text-xs text-amber-800 dark:text-amber-300">
        Confirm subsection
      </span>
    )
  }
  if (comparison.quote_ok) {
    return (
      <span className="font-sans text-xs text-ink-500 dark:text-ink-400">Statute verified</span>
    )
  }
  return null
}

/** Map a quote-integrity failure to a comparison index when possible. */
function findComparisonIndex(comparisons: WACComparison[], failure: QuoteFailure): number {
  const cite = failure.cite?.trim()
  if (cite) {
    const byCite = comparisons.findIndex(
      (c) =>
        c.code === cite ||
        c.matched_subsections?.some((s) => s === cite || s.startsWith(cite) || cite.startsWith(s)),
    )
    if (byCite >= 0) return byCite
  }

  const field = failure.field || ''
  const fromAllegation = field.startsWith('allegation:')
    ? field.slice('allegation:'.length).trim()
    : ''
  const candidates = [fromAllegation, cite].filter(Boolean) as string[]

  for (const token of candidates) {
    const idx = comparisons.findIndex(
      (c) =>
        c.code === token ||
        c.wac_id === token ||
        c.code.endsWith(token) ||
        token.includes(c.code),
    )
    if (idx >= 0) return idx
  }
  return -1
}

export function ReviewStep({
  comparisons,
  complaintText,
  report,
  onReportChange,
  onBack,
  onContinue,
  busy,
  statuteHits = [],
  searchBusy = false,
  onSearchStatutes,
  onAddCode,
  selectedIds = [],
  caseId = null,
  caseDetail = null,
  onCaseRefresh,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [showPdf, setShowPdf] = useState(false)
  const [showFullCode, setShowFullCode] = useState(false)
  const [outlineBusy, setOutlineBusy] = useState(false)
  const [pendingOutlineLabel, setPendingOutlineLabel] = useState<string | null>(null)
  const total = comparisons.length
  const active = comparisons[activeIdx] || null

  const codeKey = (c: WACComparison) => c.wac_id || c.code

  const dutyOptsFor = (c: WACComparison): AllegationDutyOption[] => {
    if (!report) return c.duty_options || []
    const row = report.comparisons.find((r) => (r.wac_id || r.code) === (c.wac_id || c.code))
    return row?.duty_options?.length ? row.duty_options : c.duty_options || []
  }

  const [confirmed, setConfirmed] = useState<Set<string>>(() => {
    const prior = report?.confirmed_allegation_codes || []
    if (!(report?.compare_cites_confirmed && prior.length)) return new Set()
    const allowed = new Set(
      comparisons.filter(autoConfirmable).map((c) => c.wac_id || c.code),
    )
    return new Set(prior.filter((k) => allowed.has(k)))
  })

  /** Per-comparison selected duty cites (start with included_by_default). */
  const [selectedDuties, setSelectedDuties] = useState<Record<string, string[]>>({})
  const [dutiesSyncedKey, setDutiesSyncedKey] = useState('')

  const starterCitesFor = (c: WACComparison): string[] => {
    const opts = c.duty_options || []
    if (!opts.length) return []
    const starters = opts.filter((o) => o.included_by_default).map((o) => o.cite)
    return starters.length ? starters : opts.slice(0, 2).map((o) => o.cite)
  }

  const clauseCount = (text: string) =>
    (text.match(/(?:\([0-9a-z]+\))+/gi) || []).length

  /**
   * Always align the visible allegation line to the starting two duties when
   * Compare loads a draft that still has the old multi-clause dump (or no
   * duty_options sync yet). Prevents stale case JSON from looking like the
   * checkbox UX did nothing.
   */
  useEffect(() => {
    if (!report || !onReportChange || !comparisons.length) return
    const fingerprint = comparisons
      .map((c) => `${c.wac_id || c.code}:${(c.duty_options || []).map((o) => o.cite).join(',')}`)
      .join('|')
    if (!fingerprint || fingerprint === dutiesSyncedKey) return

    const nextSelected: Record<string, string[]> = {}
    let changed = false
    let nextComparisons = report.comparisons
    let nextAllegations = report.allegations || []
    let nextConclusions = report.conclusions || []

    for (const c of comparisons) {
      const key = c.wac_id || c.code
      const opts = c.duty_options || []
      if (!opts.length) continue
      const starters = starterCitesFor(c)
      nextSelected[key] = starters
      const chosen = opts.filter((o) => starters.includes(o.cite))
      const line = composeAllegationFromDuties(
        c.code,
        c.title,
        chosen.map((o) => ({ label: o.label, duty_phrase: o.duty_phrase })),
      )
      const stale =
        allegationHasShortcut(c.allegation_draft || '') ||
        clauseCount(c.allegation_draft || '') > Math.max(starters.length, 2) ||
        (c.allegation_draft || '').trim() !== line.trim()
      if (!stale) continue
      changed = true
      const matched = chosen.map((o) => o.cite)
      nextComparisons = nextComparisons.map((row) =>
        (row.wac_id || row.code) === key
          ? { ...row, allegation_draft: line, matched_subsections: matched }
          : row,
      )
      nextAllegations = nextAllegations.map((a) =>
        a.wac_code === c.code
          ? { ...a, allegation_text: line, matched_subsections: matched }
          : a,
      )
      nextConclusions = nextConclusions.map((row) =>
        row.wac_code === c.code ? { ...row, allegation_text: line } : row,
      )
    }

    setSelectedDuties((prev) => ({ ...prev, ...nextSelected }))
    setDutiesSyncedKey(fingerprint)
    if (changed) {
      onReportChange({
        ...report,
        comparisons: nextComparisons,
        allegations: nextAllegations,
        conclusions: nextConclusions,
        compare_cites_confirmed: false,
      })
    }
  }, [comparisons, report, onReportChange, dutiesSyncedKey])

  const applyDutySelection = (
    comparison: WACComparison,
    cites: string[],
    opts?: AllegationDutyOption[],
  ) => {
    if (!report || !onReportChange) return
    const dutyOpts = opts || dutyOptsFor(comparison)
    const chosen: AllegationDutyOption[] = dutyOpts.filter((o) => cites.includes(o.cite))
    const line = composeAllegationFromDuties(
      comparison.code,
      comparison.title,
      chosen.map((o) => ({ label: o.label, duty_phrase: o.duty_phrase })),
    )
    const matched = chosen.map((o) => o.cite)
    const key = comparison.wac_id || comparison.code
    const nextComparisons = report.comparisons.map((c) =>
      (c.wac_id || c.code) === key
        ? {
            ...c,
            allegation_draft: line,
            matched_subsections: matched.length ? matched : c.matched_subsections,
            duty_options: dutyOpts.length ? dutyOpts : c.duty_options,
          }
        : c,
    )
    const nextAllegations = (report.allegations || []).map((a) =>
      a.wac_code === comparison.code
        ? {
            ...a,
            allegation_text: line,
            matched_subsections: matched.length ? matched : a.matched_subsections,
            duty_options: dutyOpts.length ? dutyOpts : a.duty_options,
          }
        : a,
    )
    const nextConclusions = (report.conclusions || []).map((c) =>
      c.wac_code === comparison.code ? { ...c, allegation_text: line } : c,
    )
    onReportChange({
      ...report,
      comparisons: nextComparisons,
      allegations: nextAllegations,
      conclusions: nextConclusions,
      compare_cites_confirmed: false,
    })
    setConfirmed((prev) => {
      const next = new Set(prev)
      next.delete(comparison.wac_id || comparison.code)
      return next
    })
  }

  const toggleDuty = (comparison: WACComparison, cite: string) => {
    const key = comparison.wac_id || comparison.code
    const opts = dutyOptsFor(comparison)
    setSelectedDuties((prev) => {
      const current = new Set(prev[key] || starterCitesFor(comparison))
      if (current.has(cite)) {
        if (current.size <= 1) return prev
        current.delete(cite)
      } else {
        current.add(cite)
      }
      const ordered = opts.map((o) => o.cite).filter((c) => current.has(c))
      for (const c of current) {
        if (!ordered.includes(c)) ordered.push(c)
      }
      applyDutySelection(comparison, ordered, opts)
      return { ...prev, [key]: ordered }
    })
  }

  const toggleOutlineDuty = async (comparison: WACComparison, fullLabel: string) => {
    if (!report || !onReportChange || outlineBusy) return
    const key = codeKey(comparison)
    let opts = dutyOptsFor(comparison)
    const existing = opts.find((o) => o.label === fullLabel)
    const current = selectedDuties[key] || starterCitesFor(comparison)

    if (existing && current.includes(existing.cite)) {
      if (current.length <= 1) return
      const ordered = current.filter((c) => c !== existing.cite)
      setSelectedDuties((prev) => ({ ...prev, [key]: ordered }))
      applyDutySelection(comparison, ordered, opts)
      return
    }

    let opt = existing
    if (!opt) {
      setOutlineBusy(true)
      setPendingOutlineLabel(fullLabel)
      try {
        opt = await api.resolveDutyOption({ code: comparison.code, label: fullLabel })
      } catch {
        return
      } finally {
        setOutlineBusy(false)
        setPendingOutlineLabel(null)
      }
      if (!opts.some((o) => o.label === opt!.label)) {
        opts = [...opts, opt!]
      }
    }

    const nextSet = new Set(current)
    nextSet.add(opt.cite)
    const ordered = opts.map((o) => o.cite).filter((c) => nextSet.has(c))
    for (const c of nextSet) {
      if (!ordered.includes(c)) ordered.push(c)
    }
    setSelectedDuties((prev) => ({ ...prev, [key]: ordered }))
    applyDutySelection(comparison, ordered, opts)
  }

  useEffect(() => {
    const keys = comparisons.map((c) => c.wac_id || c.code).join('|')
    setConfirmed((prev) => {
      const confirmable = new Set(comparisons.filter(autoConfirmable).map((c) => c.wac_id || c.code))
      if (report?.compare_cites_confirmed && (report.confirmed_allegation_codes || []).length) {
        return new Set((report.confirmed_allegation_codes || []).filter((k) => confirmable.has(k)))
      }
      const allowedList = comparisons.map((c) => c.wac_id || c.code)
      const next = new Set<string>()
      for (const k of prev) {
        if (allowedList.includes(k)) next.add(k)
      }
      return next
    })
    void keys
  }, [comparisons, report?.compare_cites_confirmed, report?.confirmed_allegation_codes])

  const allConfirmed = total > 0 && comparisons.every((c) => confirmed.has(codeKey(c)))
  const manualReviewCodes = useMemo(
    () => comparisons.filter(needsManualReview),
    [comparisons],
  )
  const unconfirmedManualCount = manualReviewCodes.filter((c) => !confirmed.has(codeKey(c))).length

  const toggleConfirmActive = () => {
    if (!active) return
    const key = codeKey(active)
    setConfirmed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const confirmAll = () => {
    setConfirmed(new Set(comparisons.filter(autoConfirmable).map(codeKey)))
  }

  const goTo = (idx: number, opts?: { openPdf?: boolean }) => {
    if (!total) return
    const next = ((idx % total) + total) % total
    setActiveIdx(next)
    const target = comparisons[next]
    setShowPdf(opts?.openPdf === true || target?.quote_ok === false)
    setShowFullCode(false)
  }

  const goPrev = () => goTo(activeIdx - 1)
  const goNext = () => goTo(activeIdx + 1)

  useEffect(() => {
    if (!total) {
      setActiveIdx(0)
      return
    }
    if (activeIdx >= total) setActiveIdx(0)
  }, [total, activeIdx])

  // Default-open Exact PDF panel when the active allegation has a broken quote.
  useEffect(() => {
    if (active?.quote_ok === false) setShowPdf(true)
  }, [active?.wac_id, active?.quote_ok])

  useEffect(() => {
    if (total < 2) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) {
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      setActiveIdx((i) => {
        const next = e.key === 'ArrowLeft' ? i - 1 : i + 1
        const idx = ((next % total) + total) % total
        const target = comparisons[idx]
        setShowPdf(target?.quote_ok === false)
        setShowFullCode(false)
        return idx
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total, comparisons])

  const grouped = useMemo(() => {
    const map: Record<string, WACComparison[]> = { BHA: [], RTF: [], RCW: [], Other: [] }
    for (const c of comparisons) {
      const key =
        c.chapter === '246-341'
          ? 'BHA'
          : c.chapter === '246-337'
            ? 'RTF'
            : c.chapter.startsWith('71.')
              ? 'RCW'
              : 'Other'
      map[key].push(c)
    }
    return map
  }, [comparisons])

  const quoteFailures = report?.quote_integrity?.failures ?? []

  const excerpts = active?.complaint_excerpts?.length
    ? active.complaint_excerpts.slice(0, 2)
    : complaintText.trim()
      ? [complaintText.slice(0, 280)]
      : []

  const allegationLen = active?.allegation_draft?.length ?? 0

  const activeDutyOpts = active ? dutyOptsFor(active) : []
  const activeSelectedCites = useMemo(() => {
    if (!active) return [] as string[]
    return selectedDuties[codeKey(active)] || starterCitesFor(active)
  }, [active, selectedDuties])

  const selectedOutlineLabels = useMemo(() => {
    if (!active) return new Set<string>()
    const labels = new Set<string>()
    for (const cite of activeSelectedCites) {
      const opt = activeDutyOpts.find((o) => o.cite === cite)
      labels.add(opt?.label || dutyLabelFromCite(cite, active.code))
    }
    return labels
  }, [active, activeSelectedCites, activeDutyOpts])

  if (!comparisons.length) {
    return (
      <div className="animate-rise border border-dashed border-ink-300 px-6 py-12 text-center font-sans text-sm text-ink-500 dark:border-ink-600">
        Generate a draft report first to compare authorized WACs against the complaint.
      </div>
    )
  }

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-200 pb-4 dark:border-ink-700">
        <div>
          <p className="compare-meta">Step 2 · Compare</p>
          <h2 className="mt-1 font-display text-[1.75rem] tracking-tight text-ink-900 dark:text-ink-50 lg:text-3xl">
            Working allegations
          </h2>
          <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-ink-500">
            One allegation line per approved code ({total} total). Confirm each cite (or confirm all)
            before opening the report editor. Application strength shows how clearly each code fits the
            complaint.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || allConfirmed}
            onClick={confirmAll}
            title={
              manualReviewCodes.length
                ? 'Confirms matched cites only — codes with no clear application need individual review'
                : 'Confirm all allegation cites at once'
            }
          >
            Confirm all matched cites
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !allConfirmed}
            title={allConfirmed ? undefined : 'Confirm each allegation cite before continuing'}
            onClick={() => onContinue(comparisons.map(codeKey))}
          >
            Open Documents <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!allConfirmed && (
        <div
          role="status"
          className="border-l-2 border-amber-600 bg-amber-50/90 px-3 py-2.5 font-sans text-sm text-amber-950 dark:bg-amber-950/35 dark:text-amber-100"
        >
          <p>
            Confirm each allegation cite before continuing ({confirmed.size}/{total} confirmed).
          </p>
          {unconfirmedManualCount > 0 && (
            <p className="mt-1 text-xs opacity-90">
              {unconfirmedManualCount === 1
                ? '1 code has no clear application'
                : `${unconfirmedManualCount} codes have no clear application`}{' '}
              — open it, review the allegation line, then check the confirm box. Confirm all matched
              cites skips these.
            </p>
          )}
          <p className="mt-1 text-xs opacity-80">
            Rebuilding the draft clears confirmation so dropped cites are reviewed again.
          </p>
        </div>
      )}

      <IrTemplatePicker
        caseId={caseId}
        caseDetail={caseDetail}
        onCaseRefresh={onCaseRefresh}
        disabled={busy}
      />

      {quoteFailures.length > 0 && (
        <div className="border-l-2 border-amber-600 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/35 dark:text-amber-100">
          <p className="font-medium leading-snug">
            Statute wording issues ({quoteFailures.length}). Jump to the allegation and check it
            against the approved code text before exporting. If this draft was built before a recent
            update, go back to Intake and rebuild the report.
          </p>
          <ul className="mt-2 space-y-1.5">
            {quoteFailures.map((f, i) => {
              const idx = findComparisonIndex(comparisons, f)
              const label = f.cite || `Issue ${i + 1}`
              const preview = (f.quote_preview || '').trim()
              const canNav = idx >= 0
              return (
                <li key={`${f.field}-${f.cite ?? ''}-${i}`}>
                  <button
                    type="button"
                    disabled={!canNav}
                    onClick={() => canNav && goTo(idx, { openPdf: true })}
                    className={clsx(
                      'w-full border-b border-amber-200/60 px-1 py-2 text-left transition last:border-0 dark:border-amber-800/40',
                      canNav
                        ? 'hover:bg-amber-100/50 dark:hover:bg-amber-900/30'
                        : 'cursor-default opacity-70',
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="compare-cite font-semibold">{label}</span>
                      <span className="font-sans text-xs text-amber-800 dark:text-amber-200">
                        {quoteFailureLabel(f.reason)}
                      </span>
                    </div>
                    {preview && (
                      <p className="mt-1 line-clamp-2 font-serif text-xs leading-snug text-ink-600 dark:text-ink-300">
                        {preview}
                      </p>
                    )}
                    {!canNav && (
                      <p className="mt-1 font-sans text-[11px] text-amber-700/80 dark:text-amber-300/80">
                        No matching allegation in this compare list.
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[11.5rem_minmax(0,1fr)]">
        <aside className="max-h-[42vh] overflow-y-auto border-r border-ink-200 pr-3 dark:border-ink-700 lg:sticky lg:top-3 lg:max-h-[78vh]">
          {Object.entries(grouped).map(([label, items]) => {
            if (!items.length) return null
            return (
              <div key={label} className="mb-4">
                <div className="compare-rail-label">{label}</div>
                <ul className="space-y-0">
                  {items.map((c) => {
                    const idx = comparisons.findIndex((x) => x.wac_id === c.wac_id)
                    const activeItem = idx === activeIdx
                    return (
                      <li key={c.wac_id}>
                        <button
                          type="button"
                          onClick={() => goTo(idx)}
                          className={clsx(
                            'w-full border-l-2 px-2.5 py-2 text-left transition',
                            activeItem
                              ? 'border-tide-600 bg-tide-500/8'
                              : 'border-transparent hover:bg-ink-100/70 dark:hover:bg-ink-800/40',
                          )}
                        >
                          <div className="font-mono text-xs font-semibold tracking-tight">
                            {confirmed.has(codeKey(c))
                              ? '✓ '
                              : needsManualReview(c)
                                ? '! '
                                : ''}
                            {c.code}
                          </div>
                          <div className="mt-0.5 line-clamp-2 font-sans text-[11px] leading-snug text-ink-500">
                            {c.title}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <ApplicationStrengthBadge
                              score={c.match_score}
                              reason={c.match_reason}
                              lowConfidence={c.low_confidence}
                              source="ir_match"
                              short
                              tone="quiet"
                            />
                            <AccuracyNote comparison={c} />
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </aside>

        {active && (
          <div className="space-y-5">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                className="btn-ghost shrink-0 self-center !px-2"
                onClick={goPrev}
                disabled={total < 2}
                aria-label="Previous approved WAC"
                title="Previous approved WAC (←)"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <section className="doc-surface min-w-0 flex-1 overflow-hidden !rounded-none border-x-0 border-t-0 border-b-0 shadow-none sm:!rounded-md sm:border">
                <header className="border-b border-ink-200 px-5 py-4 dark:border-ink-700">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="compare-meta">
                      Allegation{' '}
                      <span className="normal-case tracking-normal text-ink-700 dark:text-ink-200">
                        {activeIdx + 1} of {total}
                      </span>
                      <span className="mx-1.5 text-ink-300 dark:text-ink-600" aria-hidden>
                        ·
                      </span>
                      <span className="compare-cite font-semibold normal-case tracking-normal text-ink-800 dark:text-ink-100">
                        {active.code}
                      </span>
                    </p>
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <ApplicationStrengthBadge
                        score={active.match_score}
                        reason={active.match_reason}
                        lowConfidence={active.low_confidence}
                        source="ir_match"
                        tone="quiet"
                      />
                      <AccuracyNote comparison={active} />
                    </div>
                  </div>
                  <h3 className="mt-2 font-display text-xl leading-snug tracking-tight text-ink-900 dark:text-ink-50">
                    {active.title}
                  </h3>
                  {active.low_confidence && (
                    <p className="mt-2 font-sans text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                      Limited match to the complaint — confirm the selected subsection fits the intake
                      before relying on this allegation line. Optional research below can surface
                      codes with stronger application.
                    </p>
                  )}
                  {needsManualReview(active) && (
                    <p
                      role="note"
                      className="mt-2 border-l-2 border-amber-600 bg-amber-50/80 px-2.5 py-2 font-sans text-xs leading-relaxed text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
                    >
                      {!hasMatchedDuties(active)
                        ? 'No duty phrases matched this complaint. Review the allegation line, adjust subsections if needed, then confirm below — or remove this code from approved WACs on Intake.'
                        : 'No clear application to this complaint. Confirm you still want this cite in the report, or go back and adjust approved WACs.'}
                    </p>
                  )}
                </header>

                <article className="compare-allegation-body">
                  <p className="compare-allegation-text whitespace-pre-wrap">
                    {normalizeAllegationLine(active.allegation_draft) ||
                      'No allegation draft generated for this code.'}
                  </p>
                  {allegationLen > 480 && (
                    <p className="mt-3 font-sans text-xs text-amber-800 dark:text-amber-300">
                      This allegation line is long — consider editing it down in the report editor.
                    </p>
                  )}
                </article>

                {!!(activeDutyOpts.length || active.matched_subsections?.length) && (
                  <div className="border-t border-ink-200 px-5 py-3 dark:border-ink-700">
                    <p className="compare-meta mb-1.5">Adjust subsections in this allegation</p>
                    {activeDutyOpts.length === 0 ? (
                      <p className="font-sans text-sm text-amber-800 dark:text-amber-300">
                        No exact duty phrases were matched for this code yet. Pick subsections from
                        the full code text below, or rebuild the draft from Intake.
                      </p>
                    ) : (
                      <>
                        <p className="mb-2 font-sans text-xs leading-relaxed text-ink-500">
                          Check subsections to include in the allegation line. Add any others from
                          the full code outline below.
                        </p>
                        <ul className="space-y-2">
                          {sortedDutyOptions(activeDutyOpts, activeSelectedCites).map((opt) => {
                            const key = codeKey(active)
                            const checked = activeSelectedCites.includes(opt.cite)
                            return (
                              <li key={opt.cite}>
                                <label className="flex cursor-pointer items-start gap-2.5 font-sans text-sm text-ink-700 dark:text-ink-200">
                                  <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={checked}
                                    disabled={
                                      busy ||
                                      outlineBusy ||
                                      (checked && activeSelectedCites.length <= 1)
                                    }
                                    onChange={() => toggleDuty(active, opt.cite)}
                                  />
                                  <span className="min-w-0">
                                    <span className="compare-cite font-semibold">{opt.cite}</span>
                                    <span className="ml-2 text-[11px] uppercase tracking-wide text-ink-400">
                                      {opt.band}
                                      {opt.included_by_default ? ' · starting' : ''}
                                      {opt.picked_from_outline ? ' · from full code' : ''}
                                    </span>
                                    <span className="mt-0.5 block font-serif text-[13px] leading-snug text-ink-600 dark:text-ink-300">
                                      {opt.duty_phrase}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}

                {!hasMatchedDuties(active) && (
                  <div className="border-t border-ink-200 px-5 py-3 dark:border-ink-700">
                    <p className="compare-meta mb-1.5">Subsections</p>
                    <p className="font-sans text-sm text-amber-800 dark:text-amber-300">
                      No duty phrases matched. Expand Exact PDF subsection text below to pick
                      subsections from the full code, or rebuild from Intake.
                    </p>
                  </div>
                )}

                <div className="border-t border-ink-200 bg-ink-50/50 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/25">
                  <p className="compare-meta mb-2">Gate to Report</p>
                  <label className="flex cursor-pointer items-start gap-2.5 font-sans text-sm text-ink-700 dark:text-ink-200">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={confirmed.has(codeKey(active))}
                      onChange={toggleConfirmActive}
                    />
                    <span>
                      {needsManualReview(active)
                        ? 'I reviewed this cite — confirm for Report'
                        : 'Cite confirmed for this code'}
                      {confirmed.has(codeKey(active))
                        ? ' — included for Report'
                        : ' — required before opening Report'}
                    </span>
                  </label>
                </div>
              </section>

              <button
                type="button"
                className="btn-ghost shrink-0 self-center !px-2"
                onClick={goNext}
                disabled={total < 2}
                aria-label="Next approved WAC"
                title="Next approved WAC (→)"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <section className="space-y-3 border-t border-ink-200 pt-4 dark:border-ink-700">
              <h4 className="font-display text-base text-ink-800 dark:text-ink-100">
                Complaint excerpts
              </h4>
              <p className="compare-meta -mt-1">Tied to this code from the intake text</p>
              {excerpts.length ? (
                <ul className="space-y-4">
                  {excerpts.map((ex, i) => (
                    <li key={i} className="compare-excerpt">
                      <p className="compare-excerpt-text">{ex}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-sans text-sm text-ink-400">
                  No complaint excerpts linked to this code.
                </p>
              )}
            </section>

            <section className="border-t border-ink-200 dark:border-ink-700">
              <button
                type="button"
                className="flex w-full items-center justify-between py-3.5 text-left font-sans text-sm font-medium text-ink-800 dark:text-ink-100"
                onClick={() => setShowPdf((v) => !v)}
                aria-expanded={showPdf}
              >
                <span>
                  Exact PDF subsection text
                  {active.quote_ok === false && (
                    <span className="ml-2 font-sans text-xs font-normal text-rose-700 dark:text-rose-300">
                      — review against approved code text
                    </span>
                  )}
                </span>
                {showPdf ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showPdf && (
                <div className="space-y-3 border-t border-ink-200 pb-2 pt-4 dark:border-ink-700">
                  {active.matched_subsections?.length ? (
                    active.matched_subsections.map((cite, i) => (
                      <div key={cite} className="space-y-1.5 border-l-2 border-tide-600/40 pl-3 dark:border-tide-400/30">
                        <div className="compare-cite font-semibold text-tide-800 dark:text-tide-300">
                          {cite}
                        </div>
                        {active.matched_subsection_texts?.[i] && (
                          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                            {active.matched_subsection_texts[i]}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="font-sans text-sm text-ink-400">No matched subsections for this code.</p>
                  )}
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 font-sans text-xs"
                    onClick={() => setShowFullCode((v) => !v)}
                  >
                    {showFullCode ? 'Hide full code text' : 'Show full selected code text'}
                  </button>
                  {showFullCode && (
                    <StatuteOutline
                      text={active.wac_text || active.wac_summary || ''}
                      selectedLabels={selectedOutlineLabels}
                      onToggleDuty={(label) => void toggleOutlineDuty(active, label)}
                      busy={busy || outlineBusy}
                      pendingLabel={pendingOutlineLabel}
                    />
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {onSearchStatutes && onAddCode && (
        <details className="group border-t border-ink-200 pt-3 dark:border-ink-700">
          <summary className="cursor-pointer list-none font-sans text-sm font-medium text-ink-600 marker:content-none dark:text-ink-300 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-2">
              <span>
                Optional research — stronger WAC/RCW fits?
                <span className="mt-0.5 block text-xs font-normal text-ink-400">
                  Same duty-overlap ranking and strength scale as approved codes above. Not authorization.
                </span>
              </span>
              <span className="text-xs text-ink-400 group-open:hidden">Show</span>
              <span className="hidden text-xs text-ink-400 group-open:inline">Hide</span>
            </span>
          </summary>
          <div className="mt-3">
            <StatuteSearchPanel
              hits={statuteHits}
              busy={searchBusy}
              onSearch={onSearchStatutes}
              onAddCode={onAddCode}
              selectedIds={selectedIds}
              comparisons={comparisons}
              compact
            />
          </div>
        </details>
      )}
    </div>
  )
}
