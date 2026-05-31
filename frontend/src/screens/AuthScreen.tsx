import { useState } from "react";
import { authApi, type UserMe } from "../api/authApi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { TextInput } from "../components/TextInput";

export function AuthScreen({ onAuthenticated, onCancel }: { onAuthenticated: (me: UserMe) => void; onCancel?: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [message, setMessage] = useState("");
  const [createdAccessCode, setCreatedAccessCode] = useState("");
  const [createdAccount, setCreatedAccount] = useState<UserMe | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage("");
    setCreatedAccessCode("");
    setCreatedAccount(null);
    try {
      const next = mode === "login" ? await authApi.login(username, accessCode) : await authApi.signup(username);
      if (mode === "signup" && next.accessCode) {
        setCreatedAccessCode(next.accessCode);
        setCreatedAccount(next);
        setMessage(
          "Your demo account was created. Save this access code. You will need it to sign in again. AI access is not enabled by default. To request AI access, contact the project owner and share your username."
        );
        return;
      }
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
          <h1>{mode === "login" ? "Sign in" : "Create demo account"}</h1>
          <p className="muted">Use a demo username and access code to save private demo audits or request AI access.</p>
        </div>
        {message ? <div className={createdAccessCode ? "message-text" : "error-banner"}>{message}</div> : null}
        {createdAccessCode ? (
          <div className="message-text">
            <strong>Access code:</strong> <code>{createdAccessCode}</code>
          </div>
        ) : null}
        <TextInput label="Username" value={username} onChange={(event) => setUsername(event.target.value)} />
        {mode === "login" ? (
          <TextInput label="Access code" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} />
        ) : null}
        <Button onClick={submit} disabled={busy || !username.trim() || (mode === "login" && !accessCode.trim())}>
          {mode === "login" ? "Sign In" : "Create Demo Account"}
        </Button>
        {createdAccount ? (
          <Button variant="secondary" onClick={() => onAuthenticated(createdAccount)}>
            Continue to app
          </Button>
        ) : null}
        <button className="auth-switch" type="button" onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setMessage("");
          setCreatedAccessCode("");
          setCreatedAccount(null);
        }}>
          {mode === "login" ? "Create a demo account" : "Already have an access code? Sign in"}
        </button>
        {onCancel ? (
          <button className="auth-switch" type="button" onClick={onCancel}>
            Continue exploring without AI
          </button>
        ) : null}
      </Card>
    </main>
  );
}
