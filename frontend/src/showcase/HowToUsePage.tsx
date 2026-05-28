const githubUrl = "https://github.com/erdemcapci/audit-ai";
const linkedInUrl = "https://www.linkedin.com/in/erdemcapci/";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="help-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function HowToUsePage({ onBack }: { onBack: () => void }) {
  return (
    <main className="legal-page help-page">
      <button className="auth-switch" type="button" onClick={onBack}>Back to app</button>

      <header className="help-page-header">
        <p className="eyebrow">Guide</p>
        <h1>How to Use AuditCopilot</h1>
        <p>A simple guide for trying the hosted demo and understanding the audit workflow.</p>
      </header>

      <div className="help-warning">
        <strong>Important data warning</strong>
        <p>The hosted demo is for evaluation only. Do not enter confidential, personal, client, financial, audit, or sensitive company data.</p>
        <p>For sensitive use cases, run the open-source version locally with your own organization-approved AI setup.</p>
      </div>

      <Section title="What is AuditCopilot?">
        <p>AuditCopilot is a visual AI-assisted workspace for internal audit.</p>
        <p>It helps auditors turn an audit idea into a connected audit workflow: planning, risks, tests, interviews, document requests, findings, and reporting.</p>
        <p>It is not a GRC system, and it is not meant to replace auditors. It is a workflow-aware assistant for organizing audit thinking and AI-supported drafts.</p>
      </Section>

      <Section title="Ways to try it">
        <div className="help-mode-grid">
          <article>
            <h3>Explore the sample audit</h3>
            <BulletList
              items={[
                "No sign-in required.",
                "Uses fake demo data.",
                "Good for understanding the workflow.",
                "The sample audit is read-only."
              ]}
            />
          </article>
          <article>
            <h3>Create a browser-session demo audit</h3>
            <BulletList
              items={[
                "No sign-in required.",
                "Lets you try creating your own audit workflow.",
                "Tied to your current browser/session.",
                "Not intended for important or confidential data.",
                "May not be available permanently.",
                "AI generation is disabled."
              ]}
            />
          </article>
          <article>
            <h3>Sign in to create private demo audits</h3>
            <BulletList
              items={[
                "Create saved private demo audits.",
                "Other normal users cannot see them.",
                "AI is still not automatically enabled.",
                "AI access requires approval. You can request access by sending a message on LinkedIn; access will be very limited."
              ]}
            />
          </article>
        </div>
      </Section>

      <Section title="What happens when you create a new audit?">
        <p>You start with an audit title and a short audit description. AuditCopilot then gives you a workspace where the audit can be organized into a visual map.</p>
        <p>The map may include:</p>
        <BulletList
          items={[
            "Audit overview",
            "Planning",
            "Objectives",
            "Risks",
            "Tests",
            "Fieldwork",
            "Interviews",
            "Document requests",
            "Issues and findings",
            "Reporting"
          ]}
        />
      </Section>

      <Section title="Understanding the visual audit map">
        <p>The audit map is made of cards and connections.</p>
        <p>Cards represent audit objects such as objectives, risks, tests, interview questions, document requests, findings, report sections, and AI agents.</p>
        <p>Connections show relationships, for example which risk relates to which test, which test relates to which interview question, or which finding relates to a report section.</p>
        <p>You can click cards, edit details, move cards, and follow the audit flow visually.</p>
      </Section>

      <Section title="Planning phase">
        <p>Planning is where you define the audit scope and structure before fieldwork starts.</p>
        <p>Typical planning items include:</p>
        <BulletList items={["Workstreams", "Objectives", "Risks", "Tests"]} />
      </Section>

      <Section title="Fieldwork phase">
        <p>Fieldwork is where you execute the plan.</p>
        <p>Fieldwork may include testing, interviews, document requests, and issues or findings. Tests can connect to interview questions, document requests, and findings.</p>
      </Section>

      <Section title="Reporting phase">
        <p>Reporting helps turn audit work into an executive summary, report sections, and draft report content.</p>
        <p>AI outputs are drafts only. Auditors must review, challenge, and validate them before use.</p>
      </Section>

      <Section title="What are AI agents?">
        <p>AI agents are helper cards that can generate or improve audit content.</p>
        <p>Examples include generating risks, generating tests, creating interview questions, drafting findings, and generating an executive summary.</p>
        <p>Agents use connected audit context where possible, so the output can be more relevant than an isolated prompt.</p>
      </Section>

      <Section title="Why are AI buttons disabled?">
        <p>In the hosted demo, public visitors cannot run real AI, and signed-in users cannot run AI automatically.</p>
        <p>AI access must be approved. Approved users get a limited number of AI runs.</p>
        <p>If you want to try real AI generation in the hosted demo, sign in and contact the project owner to request temporary AI access.</p>
      </Section>

      <Section title="Using your own AI locally">
        <p>The open-source version can be run locally with your own approved AI setup.</p>
        <p>Depending on your setup, you can use Ollama, OpenAI, Claude, or open-source/local models.</p>
        <p>For sensitive data, use the local version with your organization-approved AI setup.</p>
        <p><a href={githubUrl} target="_blank" rel="noopener noreferrer">Open the GitHub repository</a> for setup guidance.</p>
      </Section>

      <Section title="Good things to try first">
        <BulletList
          items={[
            "Open the sample audit.",
            "Click different cards.",
            "Look at how risks, tests, and findings connect.",
            "Create a browser-session demo audit.",
            "Move and edit a few cards.",
            "Review the planning, fieldwork, and reporting areas.",
            "Sign in if you want to create private demo audits.",
            "Request AI access if you want to test real generation."
          ]}
        />
      </Section>

      <Section title="What not to do">
        <BulletList
          items={[
            "Do not enter confidential data.",
            "Do not enter client data.",
            "Do not enter personal data.",
            "Do not rely on AI output without auditor review.",
            "Do not treat generated content as professional advice."
          ]}
        />
      </Section>

      <Section title="Feedback">
        <p>This is still early and actively evolving. Feedback from auditors, audit leaders, and audit data/analytics teams is very welcome.</p>
        <div className="help-actions">
          <button className="button button-primary" type="button" onClick={onBack}><span>Back to app</span></button>
          <a className="button button-secondary" href={githubUrl} target="_blank" rel="noopener noreferrer"><span>GitHub</span></a>
          <a className="button button-ghost" href={linkedInUrl} target="_blank" rel="noopener noreferrer"><span>LinkedIn/contact</span></a>
        </div>
      </Section>
    </main>
  );
}
