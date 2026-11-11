import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { homeContent } from "../content/homeContent";

export function HomeScreen({
  onStartNew
}: {
  onStartNew: () => void;
}) {
  return (
    <main className="home-screen">
      <section className="home-entry">
        <div className="home-entry-copy">
          <p className="eyebrow">Open-source assurance workspace</p>
          <p className="home-tagline">From prompts to connected assurance.</p>
          <p className="home-intro">
            Assurenodia helps transform isolated AI conversations into structured, reusable assurance knowledge.
          </p>
          <div className="home-actions">
            <Button type="button" onClick={onStartNew}>Start New Audit</Button>
            <a className="home-link-button" href={homeContent.github.url} target="_blank" rel="noreferrer">
              {homeContent.github.label}
            </a>
          </div>
          <div className="home-feature-badges" aria-label="Product attributes">
            <span>✓ Graph-based</span>
            <span>✓ Open Source</span>
            <span>✓ Local-first</span>
            <span>✓ AI-assisted</span>
          </div>
        </div>
        <div className="home-logo-panel">
          <img src="/Logo.png" alt="Assurenodia" />
        </div>
      </section>

      <section className="home-panel-row">
        <Card className="home-purpose-card">
          <p className="eyebrow">Core idea</p>
          <h2>Why Assurenodia?</h2>
          <p>
            Because audits are bigger than an AI chat. They are connected decisions that evolve over time.
          </p>
        </Card>
        <Card className="home-feedback-card">
          <p className="eyebrow">Building in public</p>
          <h2>Help shape Assurenodia.</h2>
          <p>This project is evolving in the open. Feedback, ideas, workflow examples, and brutal criticism are always welcome.</p>
        </Card>
      </section>

      <section className="home-updates-section">
        <div className="home-section-heading">
          <p className="eyebrow">Updates</p>
          <h2>Building in Public</h2>
          <p>Demo videos, development updates and LinkedIn posts appear here as the project evolves.</p>
        </div>
        {homeContent.videos.length ? (
          <div className="home-video-grid">
            {homeContent.videos.map((video) => (
              <figure className="home-video-card" key={video.youtubeId}>
                <div className="home-video-frame">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
                    title={video.title}
                    loading="lazy"
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
                <figcaption>{video.title}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        {homeContent.videos.length ? (
          <p className="home-video-channel"><a href={homeContent.youtubeChannelUrl} target="_blank" rel="noreferrer">More on the Assurenodia YouTube channel</a></p>
        ) : null}
        {homeContent.buildLog.length ? (
          <div className="home-build-grid">
            {homeContent.buildLog.map((entry) => (
              <article className="home-build-card" key={`${entry.date}-${entry.title}`}>
                <time>{entry.date}</time>
                <h3>{entry.title}</h3>
                <p>{entry.summary}</p>
                {(entry.linkedinUrl || entry.demoUrl) ? (
                  <div className="home-build-links">
                    {entry.linkedinUrl ? <a href={entry.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn post</a> : null}
                    {entry.demoUrl ? <a href={entry.demoUrl} target="_blank" rel="noreferrer">Demo video</a> : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
