import { useState } from "react";
import { authApi, type UserMe } from "../api/authApi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { TextInput } from "../components/TextInput";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (me: UserMe) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const next = mode === "login" ? await authApi.login(email, password) : await authApi.signup(email, password);
      onAuthenticated(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <Card className="auth-card">
        <div>
          <p className="eyebrow">AuditCopilot</p>
          <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
          <p className="muted">Use your account to access the showcase workspace.</p>
        </div>
        {message ? <div className="error-banner">{message}</div> : null}
        <TextInput label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextInput label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button onClick={submit} disabled={busy || !email.trim() || password.length < 8}>
          {mode === "login" ? "Sign In" : "Sign Up"}
        </Button>
        <button className="auth-switch" type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Create a user account" : "Already have an account? Sign in"}
        </button>
      </Card>
    </main>
  );
}
