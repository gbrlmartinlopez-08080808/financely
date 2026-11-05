import { Component, type ReactNode } from 'react';

/** Last line of defence: a crash anywhere shows a calm screen instead of a white one. Nothing is lost — documents live in storage. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('frogity crashed', e);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 28, textAlign: 'center', background: 'var(--bg, #fff)', color: 'var(--fg, #111)' }}>
        <div>
          <div style={{ fontSize: 44 }}>🐸</div>
          <h2 style={{ margin: '8px 0' }}>Something went wrong</h2>
          <p style={{ opacity: 0.7, maxWidth: 300, margin: '0 auto 18px' }}>Your documents are safe on this phone. Reloading usually fixes it.</p>
          <button className="pill" onClick={() => location.reload()}>
            Reload Frogity
          </button>
        </div>
      </div>
    );
  }
}
