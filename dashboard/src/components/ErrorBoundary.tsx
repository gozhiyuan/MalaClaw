import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; name?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name ?? "unknown"}]`, error, info);
  }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{ padding: "1rem", color: "#f85149", background: "#1c1c1c", borderRadius: 8 }}>
          <strong>{this.props.name ?? "Panel"} error</strong>
          <pre style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
