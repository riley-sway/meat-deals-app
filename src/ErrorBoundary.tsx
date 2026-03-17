import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { crashed: boolean; message: string; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { crashed: true, message: err.message };
  }

  componentDidCatch(err: Error) {
    console.error('[ErrorBoundary]', err);
  }

  render() {
    if (this.state.crashed) {
      return this.props.fallback ?? (
        <div className="map-placeholder">
          <span>🗺️ Map failed to load — {this.state.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
