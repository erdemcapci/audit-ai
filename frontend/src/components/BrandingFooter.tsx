const LINKEDIN_URL = "https://www.linkedin.com/in/erdemcapci/";

export function LinkedInLogoLink({ label = "LinkedIn profile" }: { label?: string }) {
  return (
    <a
      className="linkedin-logo-link"
      href={LINKEDIN_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20.45 20.45h-3.56v-5.58c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.67H9.34V8.99h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.29ZM5.32 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.02H3.54V8.99H7.1v11.46ZM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0Z" />
      </svg>
    </a>
  );
}

export function CreatorLink() {
  return (
    <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
      Erdem Capci
    </a>
  );
}

export function FeedbackLink({ children = "Feedback" }: { children?: string }) {
  return (
    <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function BrandingFooter() {
  return (
    <footer className="app-footer">
      <span>AuditCopilot</span>
      <span>Created by <CreatorLink /></span>
    </footer>
  );
}
