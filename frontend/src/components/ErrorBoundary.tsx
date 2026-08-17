/*
 * Copyright (C) 2026 Erdem Capci
 *
 * This file is part of Assurenodia and is licensed under AGPLv3-or-later.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Application render failed", error, errorInfo);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="error-fallback">
        <section>
          <p className="eyebrow">Application Error</p>
          <h1>Assurenodia could not render this screen.</h1>
          <p>{this.state.error.message || "An unexpected frontend error occurred."}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
