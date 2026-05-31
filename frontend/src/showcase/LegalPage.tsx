const providerName = String(import.meta.env.VITE_LEGAL_PROVIDER_NAME || "Erdem Capci").trim();
const providerEmail = String(import.meta.env.VITE_LEGAL_PROVIDER_EMAIL || "").trim();
const providerLinkedIn = String(import.meta.env.VITE_LEGAL_PROVIDER_LINKEDIN || "https://www.linkedin.com/in/erdemcapci/").trim();
const githubUrl = "https://github.com/erdemcapci/audit-ai";

function Impressum() {
  return (
    <>
      <p>This page provides provider information for the hosted AuditCopilot showcase.</p>
      <dl className="legal-list">
        <dt>Provider / responsible operator</dt>
        <dd>{providerName}</dd>
        <dt>Contact</dt>
        <dd>
          {providerEmail ? <a href={`mailto:${providerEmail}`}>{providerEmail}</a> : <a href={providerLinkedIn} target="_blank" rel="noopener noreferrer">{providerLinkedIn}</a>}
        </dd>
        <dt>Project repository</dt>
        <dd><a href={githubUrl} target="_blank" rel="noopener noreferrer">{githubUrl}</a></dd>
      </dl>
    </>
  );
}

function Privacy() {
  return (
    <>
      <p>This hosted demo is for evaluation only. Do not enter confidential, personal, client, financial, audit, or sensitive company data.</p>

      <h2>Controller</h2>
      <p>{providerName}</p>
      <p>
        Contact: {providerEmail ? <a href={`mailto:${providerEmail}`}>{providerEmail}</a> : <a href={providerLinkedIn} target="_blank" rel="noopener noreferrer">{providerLinkedIn.replace(/^https?:\/\//, "")}</a>}
      </p>

      <h2>Data processed</h2>
      <p>The hosted demo may store demo usernames, hashed access codes, session identifiers, admin access state, AI access grants, total AI run limits, AI usage counters, and demo project content entered by users.</p>

      <h2>Purpose</h2>
      <p>Data is processed to operate the hosted evaluation demo, provide private demo workspaces, protect public sample audits, control AI access, and prevent abuse.</p>

      <h2>Cookies and sessions</h2>
      <p>The hosted demo uses strictly necessary HTTP-only session cookies for user login, admin login, and anonymous temporary demo sessions. These cookies are required to provide the requested demo functionality and are not used for analytics, advertising, or tracking.</p>
      <p>No non-essential analytics or marketing cookies are used by the app. If that changes, a separate consent mechanism should be added before deployment.</p>

      <h2>AI providers</h2>
      <p>When approved AI generation is used, relevant prompt content and audit context may be sent to the configured LLM provider, such as OpenAI, Anthropic, or a configured Ollama endpoint. Do not use the hosted demo for sensitive content. Run the local version for sensitive use cases.</p>

      <h2>Retention and deletion</h2>
      <p>Demo project content and account data may remain stored in the configured hosted project volume until removed by the operator. Temporary browser/session audits may be deleted or become unavailable without notice.</p>

      <h2>Your rights</h2>
      <p>Depending on applicable law, users may have rights to access, correction, deletion, restriction, objection, and portability. Contact the operator using the contact details above.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <p>AuditCopilot is an experimental evaluation tool. The hosted demo is provided to explore the product, not to perform real audits with sensitive data.</p>

      <h2>No professional advice</h2>
      <p>AuditCopilot does not provide audit, legal, compliance, accounting, risk management, or other professional advice. Qualified auditor review is required before relying on any output.</p>

      <h2>AI output limitations</h2>
      <p>AI-generated outputs may be inaccurate, incomplete, biased, outdated, or unsuitable for your organization. Users are responsible for reviewing and validating all outputs.</p>

      <h2>Data restrictions</h2>
      <p>Do not enter confidential, personal, client, financial, audit, trade secret, regulated, or sensitive company data into the hosted demo. Use the local version for sensitive use cases.</p>

      <h2>Availability</h2>
      <p>The hosted demo may change, be limited, lose temporary demo data, or become unavailable without notice. Public sample data is fictional and provided only for demonstration.</p>

      <h2>Acceptable use</h2>
      <p>Do not attempt to bypass access controls, access another user's project, overload the service, brute-force credentials, or use the demo for unlawful or harmful activity.</p>
    </>
  );
}

export function LegalPage({ page, onBack }: { page: string; onBack: () => void }) {
  const title = page === "impressum" ? "Impressum" : page === "privacy" ? "Privacy" : "Terms";
  return (
    <main className="legal-page">
      <button className="auth-switch" type="button" onClick={onBack}>Back to app</button>
      <h1>{title}</h1>
      {page === "impressum" ? <Impressum /> : null}
      {page === "privacy" ? <Privacy /> : null}
      {page === "terms" ? <Terms /> : null}
    </main>
  );
}
