export type DiagnosticLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type DiagnosticConsoleEntry = {
  level: DiagnosticLogLevel
  message: string
  timestamp: string
  stack?: string
}

export type DiagnosticRuntimeEntry = {
  type: 'error' | 'unhandledrejection' | 'resource'
  message: string
  timestamp: string
  stack?: string
  source?: string
}

export type AppContextSnapshot = {
  workflowStep?: string
  mainTab?: string
  caseDbId?: number | null
  caseIdLabel?: string
  approvedWacCount?: number
  approvedWacIds?: string[]
}

export type BugDiagnosticsSnapshot = {
  capturedAt: string
  page: {
    href: string
    pathname: string
    search: string
    hash: string
    title: string
    referrer: string
  }
  viewport: {
    width: number
    height: number
    devicePixelRatio: number
  }
  screen: {
    width: number
    height: number
  }
  environment: {
    userAgent: string
    language: string
    languages: string[]
    online: boolean
    timezone: string
    cookieEnabled: boolean
  }
  console: DiagnosticConsoleEntry[]
  runtime: DiagnosticRuntimeEntry[]
  app?: AppContextSnapshot
  performance?: {
    navigationType?: string
    jsHeapUsedMB?: number
    jsHeapTotalMB?: number
  }
}

const MAX_CONSOLE = 80
const MAX_RUNTIME = 40
const MAX_MESSAGE = 2000
const MAX_STACK = 4000
const MAX_JSON_CHARS = 100_000

const consoleBuffer: DiagnosticConsoleEntry[] = []
const runtimeBuffer: DiagnosticRuntimeEntry[] = []
let installed = false

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function serializeArg(arg: unknown): string {
  if (arg == null) return String(arg)
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) {
    return arg.stack ? `${arg.name}: ${arg.message}\n${arg.stack}` : `${arg.name}: ${arg.message}`
  }
  try {
    return JSON.stringify(arg)
  } catch {
    return Object.prototype.toString.call(arg)
  }
}

function pushConsole(level: DiagnosticLogLevel, args: unknown[]) {
  const message = truncate(args.map(serializeArg).join(' '), MAX_MESSAGE)
  const err = args.find((a): a is Error => a instanceof Error)
  consoleBuffer.push({
    level,
    message,
    timestamp: new Date().toISOString(),
    stack: err?.stack ? truncate(err.stack, MAX_STACK) : undefined,
  })
  while (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift()
}

function pushRuntime(entry: Omit<DiagnosticRuntimeEntry, 'timestamp'> & { timestamp?: string }) {
  runtimeBuffer.push({
    ...entry,
    message: truncate(entry.message, MAX_MESSAGE),
    stack: entry.stack ? truncate(entry.stack, MAX_STACK) : undefined,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  })
  while (runtimeBuffer.length > MAX_RUNTIME) runtimeBuffer.shift()
}

export function recordClientDiagnosticError(
  message: string,
  opts?: { source?: string; stack?: string },
): void {
  if (typeof window === 'undefined') return
  pushRuntime({
    type: 'error',
    message,
    source: opts?.source,
    stack: opts?.stack,
  })
  pushConsole('error', [message])
}

export function installClientDiagnostics(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  const levels: DiagnosticLogLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      try {
        if (level === 'error' || level === 'warn' || level === 'log' || level === 'info') {
          pushConsole(level, args)
        }
      } catch {
        /* never break console */
      }
      original(...args)
    }
  }

  window.addEventListener('error', (event) => {
    const target = event.target
    if (target && target !== window && target instanceof HTMLElement) {
      const tag = target.tagName?.toLowerCase() ?? 'element'
      const src =
        (target as HTMLImageElement).currentSrc ||
        (target as HTMLScriptElement).src ||
        (target as HTMLLinkElement).href ||
        ''
      pushRuntime({
        type: 'resource',
        message: `Resource error on <${tag}>`,
        source: src || undefined,
      })
      return
    }
    pushRuntime({
      type: 'error',
      message: event.message || 'Unhandled error',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error ? `${reason.name}: ${reason.message}` : serializeArg(reason)
    pushRuntime({
      type: 'unhandledrejection',
      message: message || 'Unhandled promise rejection',
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })
}

function buildPerformanceHint(): BugDiagnosticsSnapshot['performance'] | undefined {
  if (typeof window === 'undefined' || !window.performance) return undefined
  const perf = window.performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
  }
  const nav = perf.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
  const out: BugDiagnosticsSnapshot['performance'] = {}
  if (nav?.type) out.navigationType = nav.type
  if (typeof perf.memory?.usedJSHeapSize === 'number') {
    out.jsHeapUsedMB = Math.round((perf.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
    out.jsHeapTotalMB = Math.round((perf.memory.totalJSHeapSize / (1024 * 1024)) * 10) / 10
  }
  return Object.keys(out).length ? out : undefined
}

export function captureBugDiagnostics(app?: AppContextSnapshot): BugDiagnosticsSnapshot {
  if (typeof window === 'undefined') {
    return {
      capturedAt: new Date().toISOString(),
      page: { href: '', pathname: '', search: '', hash: '', title: '', referrer: '' },
      viewport: { width: 0, height: 0, devicePixelRatio: 1 },
      screen: { width: 0, height: 0 },
      environment: {
        userAgent: '',
        language: '',
        languages: [],
        online: true,
        timezone: '',
        cookieEnabled: false,
      },
      console: [],
      runtime: [],
      app,
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    page: {
      href: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      title: document.title,
      referrer: document.referrer || '',
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    screen: {
      width: window.screen?.width ?? 0,
      height: window.screen?.height ?? 0,
    },
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: [...(navigator.languages ?? [])],
      online: navigator.onLine,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      cookieEnabled: navigator.cookieEnabled,
    },
    console: [...consoleBuffer],
    runtime: [...runtimeBuffer],
    app,
    performance: buildPerformanceHint(),
  }
}

export function diagnosticsToJson(snapshot: BugDiagnosticsSnapshot): string {
  let json = JSON.stringify(snapshot)
  if (json.length <= MAX_JSON_CHARS) return json

  const trimmed: BugDiagnosticsSnapshot = {
    ...snapshot,
    console: [...snapshot.console],
    runtime: [...snapshot.runtime],
  }
  while (json.length > MAX_JSON_CHARS && (trimmed.console.length > 5 || trimmed.runtime.length > 5)) {
    if (trimmed.console.length >= trimmed.runtime.length && trimmed.console.length > 5) {
      trimmed.console.shift()
    } else if (trimmed.runtime.length > 5) {
      trimmed.runtime.shift()
    } else {
      break
    }
    json = JSON.stringify(trimmed)
  }
  if (json.length > MAX_JSON_CHARS) {
    return JSON.stringify({
      ...trimmed,
      console: trimmed.console.slice(-10),
      runtime: trimmed.runtime.slice(-10),
      truncated: true,
    })
  }
  return json
}

export function summarizeDiagnostics(snapshot: BugDiagnosticsSnapshot): string {
  const errors = snapshot.console.filter((e) => e.level === 'error').length
  const warns = snapshot.console.filter((e) => e.level === 'warn').length
  const runtime = snapshot.runtime.length
  return `${errors} console error(s), ${warns} warning(s), ${runtime} runtime event(s)`
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

const OVERLAY_ATTR = 'data-bug-report-overlay'
const MAX_SCREENSHOT_CHARS = 5_500_000

function isOverlayNode(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false
  return node.hasAttribute(OVERLAY_ATTR) || Boolean(node.closest(`[${OVERLAY_ATTR}]`))
}

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * Capture the visible application (not the bug-report dialog) as a JPEG data URL.
 * Hides `[data-bug-report-overlay]` for one paint so the screenshot matches what
 * the investigator was looking at.
 */
export async function captureAppScreenshot(): Promise<string> {
  const { toJpeg } = await import('html-to-image')
  const root = (document.getElementById('root') as HTMLElement | null) || document.body
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(`[${OVERLAY_ATTR}]`))
  const previous = overlays.map((el) => ({
    el,
    visibility: el.style.visibility,
    pointerEvents: el.style.pointerEvents,
  }))
  for (const el of overlays) {
    el.style.visibility = 'hidden'
    el.style.pointerEvents = 'none'
  }
  await nextPaint()
  try {
    const dataUrl = await toJpeg(root, {
      quality: 0.82,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      cacheBust: true,
      filter: (node) => !isOverlayNode(node),
    })
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('Screenshot capture returned an empty image')
    }
    if (dataUrl.length > MAX_SCREENSHOT_CHARS) {
      throw new Error('Screenshot is too large — try uploading a cropped image instead')
    }
    return dataUrl
  } catch (err) {
    if (err instanceof Error && /too large/i.test(err.message)) throw err
    throw new Error(
      err instanceof Error && err.message
        ? `Could not capture the current screen (${err.message})`
        : 'Could not capture the current screen',
    )
  } finally {
    for (const { el, visibility, pointerEvents } of previous) {
      el.style.visibility = visibility
      el.style.pointerEvents = pointerEvents
    }
  }
}
