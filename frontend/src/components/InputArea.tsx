import { useRef, useState } from 'react'
import { FileUp, Loader2, Play, Trash2 } from 'lucide-react'

type Props = {
  text: string
  onTextChange: (v: string) => void
  examples: { name: string }[]
  onLoadExample: (name: string) => Promise<void>
  onAnalyze: () => Promise<void>
  onUpload: (files: FileList) => Promise<void>
  busy: boolean
  selectedCount: number
  includeInformational: boolean
  onIncludeInformational: (v: boolean) => void
}

export function InputArea({
  text,
  onTextChange,
  examples,
  onLoadExample,
  onAnalyze,
  onUpload,
  busy,
  selectedCount,
  includeInformational,
  onIncludeInformational,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="border-b border-ink-200/80 p-4 dark:border-ink-700/80">
        <h2 className="font-display text-xl">Compliance Document</h2>
        <p className="text-sm text-ink-500">
          Paste text or upload Example PDFs/DOCX · {selectedCount} WACs authorized
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex.name}
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              onClick={() => void onLoadExample(ex.name)}
            >
              {ex.name.replace(/\.[^.]+$/, '')}
            </button>
          ))}
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" /> Upload
          </button>
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onTextChange('')}>
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md"
            multiple
            onChange={(e) => e.target.files && void onUpload(e.target.files)}
          />
        </div>
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
          if (e.dataTransfer.files?.length) void onUpload(e.dataTransfer.files)
        }}
      >
        <textarea
          className="input h-full min-h-[280px] resize-y font-mono text-[13px] leading-relaxed"
          placeholder="Paste investigative report, policies, or other compliance documentation…"
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
          className="btn-primary min-w-[160px]"
          disabled={busy || !text.trim() || selectedCount === 0}
          onClick={() => void onAnalyze()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? 'Analyzing…' : 'Run analysis'}
        </button>
      </div>
    </div>
  )
}
