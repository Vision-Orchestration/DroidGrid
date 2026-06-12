import { Component, type ReactNode, type ErrorInfo } from "react";

interface EBProps {
  children: ReactNode;
  name?: string;
}

interface EBState {
  hasError: boolean;
  errorMessage: string;
}

// Class component is required for error boundary (getDerivedStateFromError)
export class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary:${this.props.name ?? "root"}]`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[200px]">
          <p className="text-red-400 font-semibold">
            {this.props.name ?? "This panel"} crashed
          </p>
          <pre className="text-xs text-zinc-500 max-w-xl overflow-auto whitespace-pre-wrap">
            {this.state.errorMessage}
          </pre>
          <button
            type="button"
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-white hover:bg-zinc-600 transition-colors"
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
          >
            Restart
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
