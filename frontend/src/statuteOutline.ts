/** Display-only outline for flattened WAC/RCW section text.
 *
 * Does not invent or drop statute words. Cross-references such as
 * "subsection (3) of this section" stay inline; true list items become rows.
 */

export type StatuteOutlineKind = 'arabic' | 'alpha' | 'roman' | 'upper'

export type StatuteOutlineItem = {
  label: string
  body: string
  depth: number
  kind: StatuteOutlineKind
}

export type StatuteOutline = {
  lead: string
  items: StatuteOutlineItem[]
}

const MARKER_RE = /\((\d{1,3}|[a-z]{1,2}|[ivxlcdm]{1,6}|[A-Z])\)/g
const XREF_FOLLOW_RE = /^(of|and|or|through|to)\b|^,/i
const ROMANS = [
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'xi',
  'xii',
  'xiii',
  'xiv',
  'xv',
  'xvi',
  'xvii',
  'xviii',
  'xix',
  'xx',
] as const
const ROMAN_SET = new Set<string>(ROMANS)
const ROMAN_NEXT: Record<string, string> = Object.fromEntries(
  ROMANS.slice(0, -1).map((a, i) => [a, ROMANS[i + 1]]),
)
const KIND_DEPTH: Record<StatuteOutlineKind, number> = {
  arabic: 0,
  alpha: 1,
  roman: 2,
  upper: 3,
}
const AMBIGUOUS = new Set(['i', 'v', 'x'])

function normalizeStatuteText(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function canBreakBefore(before: string): boolean {
  const prev = before.trimEnd()
  if (!prev) return true
  if (/[:;.]$/.test(prev)) return true
  return /\b(?:and|or)$/i.test(prev)
}

function isXrefFollower(after: string): boolean {
  return XREF_FOLLOW_RE.test(after.replace(/^\s+/, ''))
}

function nextAlpha(inner: string): string | null {
  if (inner === 'z') return 'aa'
  if (inner.length === 1 && inner >= 'a' && inner <= 'y') {
    return String.fromCharCode(inner.charCodeAt(0) + 1)
  }
  return null
}

function classify(inner: string, items: StatuteOutlineItem[]): StatuteOutlineKind {
  if (/^\d+$/.test(inner)) return 'arabic'
  if (inner.length === 1 && inner >= 'A' && inner <= 'Z') return 'upper'
  const lower = inner.toLowerCase()
  const last = items[items.length - 1]
  if (inner.length >= 2 && lower === inner && ROMAN_SET.has(lower)) return 'roman'
  if (inner.length >= 2 && lower === inner && /^[a-z]{2}$/.test(inner)) return 'alpha'
  if (inner.length === 1 && inner === lower) {
    if (AMBIGUOUS.has(inner)) {
      const lastInner = last?.label.replace(/[()]/g, '') || ''
      if (last?.kind === 'alpha' && nextAlpha(lastInner) === inner) return 'alpha'
      if (last?.kind === 'roman' && ROMAN_NEXT[lastInner.toLowerCase()] === inner) return 'roman'
      return 'roman'
    }
    return 'alpha'
  }
  return 'alpha'
}

export function parseStatuteOutline(text: string): StatuteOutline {
  const body = normalizeStatuteText(text)
  if (!body) return { lead: '', items: [] }

  const items: StatuteOutlineItem[] = []
  let lead = ''
  let found = false
  let lastEnd = 0
  MARKER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MARKER_RE.exec(body))) {
    const start = match.index
    const inner = match[1]
    const end = start + match[0].length
    const after = body.slice(end)
    if (!canBreakBefore(body.slice(0, start))) continue
    if (isXrefFollower(after)) continue
    if (!after.trim()) continue

    if (!found) {
      lead = body.slice(0, start).trim()
      found = true
    } else {
      const prev = items[items.length - 1]
      prev.body = body.slice(lastEnd, start).trim()
    }
    const kind = classify(inner, items)
    items.push({
      label: `(${inner})`,
      body: '',
      depth: KIND_DEPTH[kind],
      kind,
    })
    lastEnd = end
  }

  if (!items.length) return { lead: body, items: [] }
  items[items.length - 1].body = body.slice(lastEnd).trim()
  return { lead, items }
}

/** Cumulative cite label for a nested outline row, e.g. (3)(a)(i). */
export function outlineItemFullLabel(items: StatuteOutlineItem[], index: number): string {
  const stack: string[] = []
  for (let i = 0; i <= index; i++) {
    const { label, depth } = items[i]
    stack.length = depth
    stack[depth] = label
  }
  return stack.join('')
}
