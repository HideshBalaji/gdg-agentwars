import { Component, type ReactNode } from 'react';

/** Keeps a bad event from blanking the control room during a live demo. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg text-fg">
        <div className="text-lg font-semibold tracking-tight">Ghost Dispatcher hit a rendering error</div>
        <pre className="max-w-xl whitespace-pre-wrap rounded-md border border-line bg-surface p-3 font-mono text-xs text-red">{this.state.error.message}</pre>
        <button className="h-8 rounded-md bg-fg px-3 text-sm font-medium text-bg" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
