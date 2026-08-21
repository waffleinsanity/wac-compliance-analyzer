import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

type State = { error: Error | null }

/** Keeps the rest of the app usable when a panel throws while rendering a draft. */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PanelErrorBoundary', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        className="m-4 border-l-2 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-950 dark:bg-rose-950/30 dark:text-rose-100"
      >
        <p className="font-semibold">
          {this.props.fallbackTitle || 'This panel failed to render'}
        </p>
        <p className="mt-1 text-xs opacity-90">
          Your case data is still on the server. Use Compare or Intake, or try Recall after reopening
          the case.
        </p>
        <p className="mt-2 font-mono text-[11px] opacity-80">{this.state.error.message}</p>
        {this.props.onReset && (
          <button
            type="button"
            className="btn-secondary mt-3 !h-8 !px-3 text-xs"
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
          >
            Try again
          </button>
        )}
      </div>
    )
  }
}
