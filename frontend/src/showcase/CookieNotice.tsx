import { useEffect, useState } from "react";

const COOKIE_NOTICE_KEY = "auditcopilot.cookieNotice.dismissed";

export function CookieNotice({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    setVisible(window.localStorage.getItem(COOKIE_NOTICE_KEY) !== "true");
  }, [enabled]);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, "true");
    setVisible(false);
  }

  return (
    <div className="cookie-notice" role="status" aria-live="polite">
      <p>
        This hosted demo uses necessary session cookies for login, admin access, and temporary demo audits. No analytics or marketing cookies are used.
        {" "}
        <a href="/privacy">Privacy</a>
      </p>
      <button type="button" onClick={dismiss}>Got it</button>
    </div>
  );
}
