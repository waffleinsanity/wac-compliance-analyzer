import { useRef, useState } from 'react'
import { FileUp, Loader2, Play, Trash2 } from 'lucide-react'

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
  examples: { name: string }[]
  onLoadExample: (name: string) => Promise<void>
  onExtractFile: (file: File) => Promise<void>
  onAnalyze: () => void
  selectedCount: number
  busy: boolean
  includeInformational: boolean
  onIncludeInformational: (v: boolean) => void
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
  examples,
  onLoadExample,
  onExtractFile,
  onAnalyze,
  selectedCount,
  busy,
  includeInformational,
  onIncludeInformational,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-ink-200/80 p-4 dark:border-ink-700/80">
        <h2 className="font-display text-xl">Complaint / allegation intake</h2>
        <p className="text-sm text-ink-500">
          Paste the raw complaint narrative · becomes Intake Details in the Investigative Report ·{' '}
          {selectedCount} WACs authorized
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex.name}
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              disabled={busy}
              onClick={() => void onLoadExample(ex.name)}
            >
              {ex.name.replace(/\.[^.]+$/, '')}
            </button>
          ))}
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <FileUp className="h-3.5 w-3.5" /> Upload
          </button>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={busy}
            onClick={() => onTextChange('')}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onExtractFile(f)
            }}
          />
        </div>
      </div>

      <div className="grid gap-3 border-b border-ink-200/80 p-4 sm:grid-cols-2 dark:border-ink-700/80">
        <label className="block">
          <span className="label">Case number</span>
          <input
            className="input"
            value={caseId}
            onChange={(e) => onCaseIdChange(e.target.value)}
            placeholder="e.g. 2024-0142"
          />
        </label>
        <label className="block">
          <span className="label">Date of investigation</span>
          <input
            className="input"
            value={investigationDate}
            onChange={(e) => onInvestigationDateChange(e.target.value)}
            placeholder="MM/DD/YYYY"
          />
        </label>
        <label className="block">
          <span className="label">Subject / facility</span>
          <input
            className="input"
            value={facilityAddress}
            onChange={(e) => onFacilityAddressChange(e.target.value)}
            placeholder="Facility name or address"
          />
        </label>
        <label className="block">
          <span className="label">Credential number</span>
          <input
            className="input"
            value={credentialNumber}
            onChange={(e) => onCredentialNumberChange(e.target.value)}
            placeholder="Credential #"
          />
        </label>
      </div>

      <div
        className={`flex-1 p-4 transition ${dragOver ? 'bg-tide-500/10' : ''}`}
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
        <textarea
          className="input h-full min-h-[260px] resize-y font-mono text-[13px] leading-relaxed"
          placeholder="Paste the raw complaint or allegation narrative…"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/80 p-4 dark:border-ink-700/80">
        <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input
            type="checkbox"
            className="accent-ink-700"
            checked={includeInformational}
            onChange={(e) => onIncludeInformational(e.target.checked)}
          />
          Include informational / insufficient findings
        </label>
        <button
          type="button"
          className="btn-primary min-w-[180px]"
          disabled={busy || !text.trim() || selectedCount === 0}
          onClick={onAnalyze}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? 'Generating IR…' : 'Generate IR'}
        </button>
      </div>
    </div>
  )
}
