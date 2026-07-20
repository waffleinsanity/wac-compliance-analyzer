import { useMemo, useRef, useState } from 'react'
import { FileUp, Loader2, Mic, MicOff, Play, ShieldAlert, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { PrivacyHit } from '../api'
import { DateField } from './DateField'
import { highlightPrivacySegments } from './PrivacyGate'

type Props = {
  text: string
  onTextChange: (v: string) => void
  caseId: string
  onCaseIdChange: (v: string) => void
  investigationDate: string
  onInvestigationDateChange: (v: string) => void
  facilityAddress: string
  onFacilityAddressChange: (v: string) => void
  credentialNumber: string
  onCredentialNumberChange: (v: string) => void
  onExtractFile: (file: File) => Promise<void>
  onAnalyze: () => void
  selectedCount: number
  busy: boolean
  canEdit?: boolean
  privacyHits?: PrivacyHit[]
  onBlurScan?: () => void
}

export function ComplaintStep({
  text,
  onTextChange,
  caseId,
  onCaseIdChange,
  investigationDate,
  onInvestigationDateChange,
  facilityAddress,
  onFacilityAddressChange,
  credentialNumber,
  onCredentialNumberChange,
  onExtractFile,
  onAnalyze,
  selectedCount,
  busy,
  canEdit = true,
  privacyHits = [],
  onBlurScan,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [listening, setListening] = useState(false)
  const ready = Boolean(text.trim() && selectedCount > 0)

  const segments = useMemo(
    () => highlightPrivacySegments(text, privacyHits),
    [text, privacyHits],
  )

  const toggleVoiceNotes = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        continuous: boolean
        interimResults: boolean
        onresult: ((ev: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null
        onerror: (() => void) | null
        onend: (() => void) | null
        start: () => void
        stop: () => void
      }
      webkitSpeechRecognition?: new () => {
        continuous: boolean
        interimResults: boolean
        onresult: ((ev: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null
        onerror: (() => void) | null
        onend: (() => void) | null
        start: () => void
        stop: () => void
      }
    }
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) {
      window.alert('Voice notes are not supported in this browser. Paste or type instead.')
      return
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setListening(false)
      return
    }
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (event) => {
      let chunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) chunk += event.results[i][0].transcript
      }
      if (chunk.trim()) {
        const sep = text.trim() ? `${text.trim()}\n` : ''
        onTextChange(`${sep}${chunk.trim()}`)
      }
    }
    rec.onerror = () => {
      setListening(false)
      recognitionRef.current = null
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 animate-rise">
      {privacyHits.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-950 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">
              Possible Category 3/4 information detected ({privacyHits.length})
            </div>
            <p className="mt-0.5 text-xs opacity-90">
              Highlighted spans may be PII/PHI. Drafting or saving will ask you to redact them first.
              Public Category 1 content may remain.
            </p>
          </div>
        </div>
      )}

      <div className="doc-surface flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-ink-700">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tide-600 dark:text-tide-400">
              Step 1 · Intake
            </p>
            <h2 className="font-display mt-1 text-xl text-ink-900 dark:text-ink-50">
              Complaint / allegation
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-500">
              Paste the intake narrative. Approved WACs in the left rail define what enters the report.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1 text-xs"
              disabled={busy || !canEdit}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-3.5 w-3.5" /> Upload
            </button>
            <button
              type="button"
              className={clsx('btn-ghost !px-2.5 !py-1 text-xs', listening && 'text-rose-600')}
              disabled={busy || !canEdit}
              onClick={toggleVoiceNotes}
              title="Dictate notes into the complaint field (you still edit before drafting)"
            >
              {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              {listening ? 'Stop' : 'Voice'}
            </button>
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1 text-xs"
              disabled={!canEdit}
              onClick={() => onTextChange('')}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => e.target.files?.[0] && void onExtractFile(e.target.files[0])}
          />
        </div>

        <div
          className={clsx(
            'relative min-h-0 flex-1 p-4 transition',
            dragOver && 'bg-tide-500/8',
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void onExtractFile(f)
          }}
        >
          {privacyHits.length > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-4 overflow-hidden whitespace-pre-wrap break-words font-serif text-[17px] leading-[1.7] text-transparent"
            >
              {segments.map((seg) =>
                seg.hit ? (
                  <mark
                    key={seg.key}
                    className="rounded-sm bg-amber-300/70 text-transparent dark:bg-amber-500/50"
                    title={seg.kind}
                  >
                    {seg.text}
                  </mark>
                ) : (
                  <span key={seg.key}>{seg.text}</span>
                ),
              )}
            </div>
          )}
          <textarea
            readOnly={!canEdit}
            disabled={!canEdit}
            className="input relative h-full min-h-[320px] w-full resize-none border-0 bg-transparent px-1 py-1 font-serif text-[17px] leading-[1.7] shadow-none ring-0 focus:ring-0 xl:min-h-0"
            placeholder="Paste or type the state complaint / allegation here…"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={() => onBlurScan?.()}
            aria-label="Complaint or allegation narrative"
          />
        </div>

        <div className="space-y-3 border-t border-ink-200/70 bg-card/40 px-5 py-4 dark:border-ink-700">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
              Case metadata
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              Fill these before drafting so the report shell has the right case context.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label" htmlFor="case-id">
                Case ID
              </label>
              <input
                id="case-id"
                className="input font-mono"
                placeholder="2020-XXXX"
                value={caseId}
                onChange={(e) => onCaseIdChange(e.target.value)}
                readOnly={!canEdit}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="label" htmlFor="inv-date">
                Investigation date(s)
              </label>
              <DateField
                id="inv-date"
                placeholder="MM/DD/YYYY"
                value={investigationDate}
                onChange={onInvestigationDateChange}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="label" htmlFor="facility">
                Facility address
              </label>
              <input
                id="facility"
                className="input"
                value={facilityAddress}
                onChange={(e) => onFacilityAddressChange(e.target.value)}
                readOnly={!canEdit}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="label" htmlFor="credential">
                Credential number
              </label>
              <input
                id="credential"
                className="input font-mono"
                placeholder="BHA.FS.XXXXXXXX"
                value={credentialNumber}
                onChange={(e) => onCredentialNumberChange(e.target.value)}
                readOnly={!canEdit}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/60 pt-3 dark:border-ink-700">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-xs text-ink-400">{text.length.toLocaleString()} chars</span>
              {selectedCount === 0 && canEdit && (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  Select approved WACs in the left rail before drafting.
                </p>
              )}
              {!text.trim() && selectedCount > 0 && canEdit && (
                <p className="mt-1 text-xs text-ink-500">Add complaint text to enable drafting.</p>
              )}
            </div>
            <button
              type="button"
              className="btn-primary min-w-[220px]"
              disabled={busy || !ready || !canEdit}
              onClick={onAnalyze}
              title={
                !canEdit
                  ? 'Viewer role cannot draft reports'
                  : selectedCount === 0
                    ? 'Select officially approved WACs for this case first'
                    : 'Draft report using only the approved WACs you selected'
              }
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? 'Building report…' : 'Draft report from approved WACs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
