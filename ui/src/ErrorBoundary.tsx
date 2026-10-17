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
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-void text-ink">
        <div className="font-display text-xl">Ghost Dispatcher hit a rendering error</div>
        <pre className="max-w-xl whitespace-pre-wrap text-xs text-alarm-400">{this.state.error.message}</pre>
        <button className="rounded-lg bg-ice-500 px-3 py-1.5 text-sm text-void" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
