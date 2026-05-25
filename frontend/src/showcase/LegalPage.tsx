export function LegalPage({ page, onBack }: { page: string; onBack: () => void }) {
  const title = page === "impressum" ? "Impressum" : page === "privacy" ? "Privacy" : "Terms";
  return (
    <main className="legal-page">
      <button className="auth-switch" type="button" onClick={onBack}>Back to app</button>
      <h1>{title}</h1>
      {page === "impressum" ? (
        <p>AuditCopilot hosted demo. Contact: use the GitHub or LinkedIn links in the app footer.</p>
      ) : null}
      {page === "privacy" ? (
        <>
          <p>This hosted demo is not intended for confidential, personal, client, financial, audit, or sensitive company data.</p>
          <p>User login information, demo project content, AI access status, and AI usage counters may be stored in the hosted demo environment.</p>
          <p>When AI is used, relevant prompt and audit context may be sent to the configured LLM provider. Use local mode for sensitive use cases.</p>
        </>
      ) : null}
      {page === "terms" ? (
        <>
          <p>This is an experimental evaluation tool. AI outputs may be inaccurate, incomplete, or unsuitable for your use case.</p>
          <p>AuditCopilot does not provide audit, legal, compliance, or professional advice. Qualified auditor review is required before relying on any output.</p>
        </>
      ) : null}
    </main>
  );
}
