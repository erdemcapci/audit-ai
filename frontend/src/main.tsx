/*
 * Copyright (C) 2026 Erdem Capci
 *
 * This file is part of Assurance Graph and is licensed under AGPLv3-or-later.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";
import "./styles/flow.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
