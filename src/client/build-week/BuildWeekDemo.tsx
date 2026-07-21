import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import "./build-week-demo.css";
import {
  BEACHCAR_MCP_TOOL_SEQUENCE,
  BUILD_WEEK_SCENE_IDS,
  buildWeekDemoFixture,
  recordedLearnedTaste,
  sceneForShortcut,
  sceneFromSearch,
  sceneSearch,
} from "./fixture";
import type { BuildWeekSceneId, RecordedRunEvent } from "./fixture";

type BuildWeekDemoProps = {
  initialScene?: BuildWeekSceneId;
};

const sceneNames: Record<BuildWeekSceneId, string> = {
  proof: "Proof",
  teach: "Teach",
  research: "Research",
  review: "Review",
  learn: "Learn",
};

function PipelineArrow() {
  return (
    <span className="bwd-pipeline-arrow" aria-hidden="true">
      <span />
    </span>
  );
}

function ToolPill({ tool, index }: { tool: string; index: number }) {
  return (
    <div className="bwd-tool-pill">
      <span>{String(index + 1).padStart(2, "0")}</span>
      <code>{tool}</code>
    </div>
  );
}

function RunEvent({ event }: { event: RecordedRunEvent }) {
  return (
    <li className={`bwd-event bwd-event--${event.kind}`}>
      <time>{event.at}</time>
      <span className="bwd-event-kind">{event.kind === "mcp" ? "MCP" : event.kind.toUpperCase()}</span>
      <div>
        <strong>{event.label}</strong>
        <p>{event.detail}</p>
      </div>
    </li>
  );
}

function ProofScene() {
  const { caseStudy, run } = buildWeekDemoFixture;

  return (
    <div className="bwd-scene-grid bwd-proof-grid">
      <div className="bwd-proof-copy">
        <div className="bwd-outcome-stamp">
          <span>FOUND BY BEACHCAR</span>
          <strong>BOUGHT BY ITS USER</strong>
        </div>
        <a className="bwd-case-link" href={caseStudy.url} target="_blank" rel="noreferrer">
          <span>THE CASE STUDY ↗</span>
          <strong>{caseStudy.title}</strong>
        </a>
        <p className="bwd-proof-note">{caseStudy.note}</p>
      </div>

      <div className="bwd-car-stage" aria-label="Beachcar's illustrated pink Surrey identity">
        <span className="bwd-car-stage-label">THE ONE</span>
        <img src={caseStudy.imageSrc} alt="Illustrated pink Willys Surrey, the Beachcar identity" />
        <div className="bwd-car-shadow" />
      </div>

      <div className="bwd-proof-metrics" aria-label="Deterministic replay facts">
        <div>
          <strong>{run.sourcesRead}</strong>
          <span>source types shown</span>
        </div>
        <div>
          <strong>{run.mcpSteps}</strong>
          <span>MCP steps proved</span>
        </div>
        <div className="bwd-cost-metric">
          <strong>{run.beachcarAiCost}</strong>
          <span>Beachcar AI cost</span>
        </div>
      </div>
    </div>
  );
}

function TeachScene() {
  const { taste } = buildWeekDemoFixture;

  return (
    <div className="bwd-scene-grid bwd-teach-grid">
      <section className="bwd-interview-panel" aria-label="Taste interview">
        <div className="bwd-panel-label">A TWO-MINUTE CONVERSATION</div>
        <div className="bwd-chat bwd-chat--codex">
          <span>C</span>
          <p>Forget makes and models for a second. What should the car feel like?</p>
        </div>
        <div className="bwd-chat bwd-chat--user">
          <p>{taste.prompt}</p>
          <span>J</span>
        </div>
        <div className="bwd-chat bwd-chat--codex">
          <span>C</span>
          <p>Got it. I’ll search for character, not just keywords.</p>
        </div>
      </section>

      <PipelineArrow />

      <section className="bwd-memory-panel" aria-label="Structured taste memory">
        <div className="bwd-panel-label">DURABLE BEACHCAR MEMORY</div>
        <div className="bwd-memory-group">
          <span>PRIORITIZE</span>
          <div className="bwd-chip-row">
            {taste.mustHave.map((signal) => (
              <span className="bwd-chip bwd-chip--yes" key={signal}>{signal}</span>
            ))}
          </div>
        </div>
        <div className="bwd-memory-group">
          <span>AVOID</span>
          <div className="bwd-chip-row">
            {taste.avoid.map((signal) => (
              <span className="bwd-chip bwd-chip--no" key={signal}>{signal}</span>
            ))}
          </div>
        </div>
        <div className="bwd-teach-tools">
          <code>get_setup_context</code>
          <span>→</span>
          <code>save_taste_calibration</code>
          <strong>✓ saved</strong>
        </div>
      </section>
    </div>
  );
}

function ResearchScene() {
  const { timeline, run } = buildWeekDemoFixture;

  return (
    <div className="bwd-research-layout">
      <div className="bwd-pipeline" aria-label="Local research architecture">
        <div className="bwd-pipeline-node bwd-pipeline-node--codex">
          <span>01</span>
          <strong>Local Codex</strong>
          <small>GPT-5.6 plans + judges</small>
        </div>
        <PipelineArrow />
        <div className="bwd-pipeline-node bwd-pipeline-node--browser">
          <span>02</span>
          <strong>Signed-in browser</strong>
          <small>User logs in; Codex reads</small>
        </div>
        <PipelineArrow />
        <div className="bwd-pipeline-node bwd-pipeline-node--mcp">
          <span>03</span>
          <strong>Beachcar MCP</strong>
          <small>Memory in; shortlist out</small>
        </div>
        <div className="bwd-zero-cost">
          <strong>{run.beachcarAiCost}</strong>
          <span>Beachcar AI</span>
        </div>
      </div>

      <div className="bwd-research-detail">
        <section className="bwd-tool-sequence" aria-label="Beachcar MCP tool sequence">
          <div className="bwd-panel-label">EXACT MCP CONTRACT</div>
          <div className="bwd-tool-list">
            {BEACHCAR_MCP_TOOL_SEQUENCE.map((tool, index) => (
              <ToolPill tool={tool} index={index} key={tool} />
            ))}
          </div>
        </section>

        <section className="bwd-run-log" aria-label="Deterministic replay sequence">
          <div className="bwd-panel-label">DEMO REPLAY · FIXED SEQUENCE</div>
          <ol>
            {timeline.map((event) => <RunEvent event={event} key={`${event.at}-${event.label}`} />)}
          </ol>
        </section>
      </div>
    </div>
  );
}

function ReviewScene() {
  const { reviewCards, run } = buildWeekDemoFixture;
  const winner = reviewCards[0];

  return (
    <div className="bwd-review-layout">
      <section className="bwd-phone" aria-label="Beachcar shortlist">
        <div className="bwd-phone-bar">
          <span>BEACHCAR</span>
          <small>{run.date}</small>
        </div>
        <div className="bwd-phone-art">
          <img src={buildWeekDemoFixture.caseStudy.imageSrc} alt="Illustrated pink Beachcar Surrey" />
          <span>97% FIT</span>
        </div>
        <div className="bwd-phone-copy">
          <span>#{winner.rank} · {winner.lane}</span>
          <h3>{winner.title}</h3>
          <p>{winner.why}</p>
          <small><strong>WATCH:</strong> {winner.caveat}</small>
          <small><strong>MARKET:</strong> {winner.market}</small>
          <small><strong>SOURCE:</strong> {winner.sourceLabel}</small>
        </div>
        <div className="bwd-phone-actions" aria-hidden="true">
          <span>Never again</span>
          <strong>Love</strong>
        </div>
      </section>

      <section className="bwd-shortlist">
        <div className="bwd-shortlist-heading">
          <div>
            <div className="bwd-panel-label">FIXED REVIEW STATE</div>
            <h3>DEMO REPLAY · 5 PICKS</h3>
          </div>
          <span className="bwd-verified">TESTED STATE CONTRACT</span>
        </div>
        <div className="bwd-shortlist-stack">
          {reviewCards.map((card) => (
            <article key={card.rank}>
              <span className="bwd-rank">0{card.rank}</span>
              <div>
                <span>{card.lane} · {card.sourceLabel}</span>
                <strong>{card.title}</strong>
                <p>{card.why}</p>
              </div>
              <strong className="bwd-fit">{card.fit}%</strong>
            </article>
          ))}
          <div className="bwd-more-cards">+ 2 more researched picks</div>
        </div>
        <div className="bwd-evidence-note">
          <strong>Not a feed.</strong>
          <span>This fixture shows the reason, caveat, market note, and source slot used by production picks.</span>
        </div>
      </section>
    </div>
  );
}

function MemoryLine({ name, children }: { name: keyof typeof recordedLearnedTaste; children: ReactNode }) {
  return (
    <div className="bwd-memory-line">
      <code>{name}</code>
      <span>{children}</span>
    </div>
  );
}

function LearnScene() {
  const { feedback } = buildWeekDemoFixture;

  return (
    <div className="bwd-learn-layout">
      <section className="bwd-feedback-pair" aria-label="Recorded feedback actions">
        <article className="bwd-feedback-card bwd-feedback-card--love">
          <span className="bwd-action-icon">♥</span>
          <div>
            <span>LOVE</span>
            <strong>{feedback.love.listingTitle}</strong>
            <p>More open-air oddballs with color, charm, and honest simplicity.</p>
          </div>
        </article>
        <article className="bwd-feedback-card bwd-feedback-card--never">
          <span className="bwd-action-icon">×</span>
          <div>
            <span>NEVER AGAIN</span>
            <strong>{feedback.neverAgain.listingTitle}</strong>
            <p>Stop spending attention on anonymous, oversized performance SUVs.</p>
          </div>
        </article>
      </section>

      <PipelineArrow />

      <section className="bwd-learning-output" aria-label="Updated structured taste">
        <div className="bwd-panel-label">WHAT TOMORROW’S CODEX RECEIVES</div>
        <div className="bwd-memory-code">
          <span>{"{"}</span>
          <MemoryLine name="prioritizeSimilarTo">
            {recordedLearnedTaste.prioritizeSimilarTo.join(" · ")}
          </MemoryLine>
          <MemoryLine name="avoidSimilarTo">
            {recordedLearnedTaste.avoidSimilarTo.join(" · ")}
          </MemoryLine>
          <MemoryLine name="suppressExactUrls">
            exact rejected listing
          </MemoryLine>
          <span>{"}"}</span>
        </div>
        <div className="bwd-tomorrow">
          <span>TODAY</span>
          <strong>feedback becomes memory</strong>
          <i>→</i>
          <span>TOMORROW</span>
          <strong>a sharper search plan</strong>
        </div>
      </section>
    </div>
  );
}

const sceneContent: Record<BuildWeekSceneId, () => ReactNode> = {
  proof: ProofScene,
  teach: TeachScene,
  research: ResearchScene,
  review: ReviewScene,
  learn: LearnScene,
};

export function BuildWeekDemo({ initialScene }: BuildWeekDemoProps) {
  const [sceneId, setSceneId] = useState<BuildWeekSceneId>(() => {
    if (initialScene) return initialScene;
    return typeof window === "undefined" ? "proof" : sceneFromSearch(window.location.search);
  });

  const sceneIndex = BUILD_WEEK_SCENE_IDS.indexOf(sceneId);
  const scene = buildWeekDemoFixture.scenes[sceneIndex];
  const SceneContent = sceneContent[sceneId];

  const selectScene = useCallback((nextScene: BuildWeekSceneId) => {
    setSceneId(nextScene);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName ?? "")) return;

      const nextScene = sceneForShortcut(sceneId, event.key);
      if (!nextScene) return;
      event.preventDefault();
      selectScene(nextScene);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sceneId, selectScene]);

  useEffect(() => {
    const nextUrl = `${window.location.pathname}${sceneSearch(sceneId, window.location.search)}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [sceneId]);

  useEffect(() => {
    const handlePopState = () => setSceneId(sceneFromSearch(window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const progress = useMemo(() => `${((sceneIndex + 1) / BUILD_WEEK_SCENE_IDS.length) * 100}%`, [sceneIndex]);

  return (
    <section className={`build-week-demo build-week-demo--${sceneId}`} aria-label="Beachcar Build Week deterministic replay">
      <div className="bwd-progress" aria-hidden="true"><span style={{ width: progress }} /></div>
      <header className="bwd-header">
        <div className="bwd-brand">
          <img src="/icon.svg" alt="" />
          <div>
            <strong>BEACHCAR</strong>
            <span>A personal car-finding agent</span>
          </div>
        </div>
        <div className="bwd-run-meta">
          <span className="bwd-recorded"><i /> {buildWeekDemoFixture.run.label}</span>
          <span>{buildWeekDemoFixture.run.date}</span>
          <span>{buildWeekDemoFixture.run.startedAt}–{buildWeekDemoFixture.run.finishedAt}</span>
          <strong>{buildWeekDemoFixture.run.beachcarAiCost} BEACHCAR AI</strong>
        </div>
      </header>

      <main className="bwd-main">
        <div className="bwd-scene-heading">
          <span>{scene.eyebrow}</span>
          <h1>{scene.title}</h1>
          <p>{scene.summary}</p>
        </div>
        <div className="bwd-scene-content" key={sceneId}>
          <SceneContent />
        </div>
      </main>

      <footer className="bwd-footer">
        <button
          type="button"
          className="bwd-step-button"
          onClick={() => selectScene(sceneForShortcut(sceneId, "ArrowLeft") ?? sceneId)}
          disabled={sceneIndex === 0}
          aria-label="Previous scene"
        >
          ←
        </button>
        <nav className="bwd-scene-nav" aria-label="Demo scenes">
          {BUILD_WEEK_SCENE_IDS.map((id, index) => (
            <button
              type="button"
              className={id === sceneId ? "is-active" : ""}
              onClick={() => selectScene(id)}
              aria-current={id === sceneId ? "step" : undefined}
              key={id}
            >
              <span>{index + 1}</span>
              <strong>{sceneNames[id]}</strong>
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="bwd-step-button"
          onClick={() => selectScene(sceneForShortcut(sceneId, "ArrowRight") ?? sceneId)}
          disabled={sceneIndex === BUILD_WEEK_SCENE_IDS.length - 1}
          aria-label="Next scene"
        >
          →
        </button>
        <div className="bwd-shortcuts" aria-label="Keyboard shortcuts">
          <span>← →</span> move
          <span>1–5</span> jump
          <span>R</span> reset
        </div>
      </footer>
    </section>
  );
}

export default BuildWeekDemo;
