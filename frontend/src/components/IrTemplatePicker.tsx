import { useEffect, useRef, useState } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { api, type CaseDetail, type IrTemplate } from '../api'

type Props = {
  caseId: number | null
  caseDetail?: CaseDetail | null
  onCaseRefresh?: () => void | Promise<void>
  /** Compact toolbar variant vs Compare panel */
  compact?: boolean
  disabled?: boolean
}

export function IrTemplatePicker({
  caseId,
  caseDetail,
  onCaseRefresh,
  compact = false,
  disabled = false,
}: Props) {
  const [library, setLibrary] = useState<IrTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const caseInputRef = useRef<HTMLInputElement>(null)

  const bound = caseDetail?.ir_template ?? null
  const selectValue = bound?.id != null ? String(bound.id) : ''

  const refreshLibrary = async () => {
    try {
      const rows = await api.listIrTemplates()
      setLibrary(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    }
  }

  useEffect(() => {
    void refreshLibrary()
  }, [caseDetail?.ir_template_id, caseDetail?.updated_at])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await onCaseRefresh?.()
      await refreshLibrary()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Template update failed')
    } finally {
      setBusy(false)
    }
  }

  const onSelect = (value: string) => {
    if (!caseId) {
      setError('Save the case first to attach a custom template.')
      return
    }
    const id = value ? Number(value) : null
    void run(async () => {
      await api.bindCaseIrTemplate(caseId, id)
    })
  }

  const onLibraryUpload = (file: File | null) => {
    if (!file) return
    void run(async () => {
      const tpl = await api.uploadIrTemplate(file)
      if (caseId) {
        await api.bindCaseIrTemplate(caseId, tpl.id)
      }
    })
  }

  const onCaseUpload = (file: File | null) => {
    if (!file || !caseId) {
      if (!caseId) setError('Save the case first to upload a case template.')
      return
    }
    void run(async () => {
      await api.uploadCaseIrTemplate(caseId, file)
    })
  }

  const exportLabel = bound?.name || 'Built-in blank'

  return (
    <div
      className={
        compact
          ? 'min-w-0 max-w-full'
          : 'rounded-xl border border-ink-200/80 bg-card/60 px-4 py-3 dark:border-ink-700'
      }
    >
      <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
        {!compact && (
          <div>
            <p className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-tide-600 dark:text-tide-400">
              IR template
            </p>
            <p className="mt-0.5 font-sans text-xs text-ink-500">
              Export fills your DOCX shell (letterhead kept) with edited sections and Compare notes.
              Missing DOH headings will block Download.
            </p>
          </div>
        )}

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {compact && (
            <span className="shrink-0 font-sans text-[11px] text-ink-500" title="DOCX export template">
              Export uses:
            </span>
          )}
          <select
            className={
              compact
                ? 'input !h-8 max-w-[14rem] !py-0 text-xs'
                : 'input max-w-md text-sm'
            }
            value={selectValue}
            disabled={disabled || busy || !caseId}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Investigation Report template"
          >
            <option value="">Built-in blank</option>
            {library.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_default ? ' (default)' : ''}
                {t.source === 'case' ? ' · case' : ''}
                {t.core_count < 3 ? ' · needs headings' : ''}
              </option>
            ))}
          </select>

          <input
            ref={libraryInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null
              e.target.value = ''
              onLibraryUpload(f)
            }}
          />
          <input
            ref={caseInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null
              e.target.value = ''
              onCaseUpload(f)
            }}
          />

          <button
            type="button"
            className={compact ? 'btn-ghost !h-8 !px-2 text-xs' : 'btn-secondary text-xs'}
            disabled={disabled || busy}
            onClick={() => libraryInputRef.current?.click()}
            title="Upload to your template library and bind to this case"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
            {compact ? 'Library' : 'Upload to library'}
          </button>
          <button
            type="button"
            className={compact ? 'btn-ghost !h-8 !px-2 text-xs' : 'btn-ghost text-xs'}
            disabled={disabled || busy || !caseId}
            onClick={() => caseInputRef.current?.click()}
            title="Upload a template only for this case"
          >
            {compact ? 'This case' : 'Upload for this case'}
          </button>
        </div>

        {!compact && (
          <p className="font-sans text-xs text-ink-500">
            Export uses: <span className="font-medium text-ink-800 dark:text-ink-100">{exportLabel}</span>
            {bound && bound.section_keys.length > 0 && (
              <>
                {' '}
                · detected: {bound.section_keys.join(', ')}
              </>
            )}
          </p>
        )}
        {compact && bound && (
          <span className="truncate font-sans text-[11px] text-ink-500" title={bound.name}>
            {bound.name}
          </span>
        )}
      </div>

      {(bound?.warnings?.length || 0) > 0 && (
        <ul className="mt-2 list-inside list-disc font-sans text-[11px] text-amber-800 dark:text-amber-200">
          {bound!.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 font-sans text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      {!caseId && (
        <p className="mt-2 font-sans text-[11px] text-ink-500">
          Save the case to attach a custom template.
        </p>
      )}
    </div>
  )
}
