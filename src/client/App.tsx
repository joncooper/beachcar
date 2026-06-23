import {
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock3,
  ExternalLink,
  Gavel,
  ImageOff,
  List,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clearFeedback, getLatestRun, getMe, putFeedback, setAuthTokenGetter } from "./api";
import { signInWithGoogle, useClerkBrowser } from "./clerk-browser";
import type { BrowserClerk } from "./clerk-browser";
import type { AuctionListing, FeedbackAction, FeedbackRecord, Lane, RunPayload, UserPayload } from "../shared/types";

type ViewFilter = "all" | Lane | "starred" | "ending";
type ViewMode = "deck" | "list";

const laneLabels: Record<Lane, string> = {
  family: "Family",
  solo: "Solo",
  curiosity: "Curiosity",
};

const actionLabels: Record<FeedbackAction, string> = {
  like: "Liked",
  star: "Starred",
  hide: "Hidden",
  avoid: "Avoid similar",
};

const actionClasses: Record<FeedbackAction, string> = {
  like: "is-liked",
  star: "is-starred",
  hide: "is-hidden",
  avoid: "is-avoid",
};

const appName = import.meta.env.VITE_APP_NAME || "Beach Car Watch";

function listingKey(listing: AuctionListing): string {
  return listing.listingKey || listing.url || listing.title;
}

function isHiddenAction(action?: FeedbackAction | null): boolean {
  return action === "hide" || action === "avoid";
}

function normalizeCount(value: unknown): string {
  if (value === undefined || value === null || value === "") return "check";
  return String(value);
}

function isEndingSoon(listing: AuctionListing): boolean {
  if (listing.endsAt) {
    const hours = (new Date(listing.endsAt).getTime() - Date.now()) / 36e5;
    return Number.isFinite(hours) && hours <= 30;
  }
  return /today|hour|m$|h\b/i.test(listing.timeLeft || "");
}

function searchBlob(listing: AuctionListing): string {
  return [
    listing.title,
    listing.site,
    listing.section,
    listing.lane,
    listing.bid,
    listing.total,
    listing.fair,
    listing.ceiling,
    listing.why,
    listing.concerns,
    listing.currentTake,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function mergedFeedback(run: RunPayload | null): Map<string, FeedbackRecord> {
  const map = new Map<string, FeedbackRecord>();
  for (const feedback of run?.feedback || []) map.set(feedback.listingKey, feedback);
  for (const listing of run?.listings || []) {
    if (listing.feedback) map.set(listingKey(listing), listing.feedback);
  }
  return map;
}

function generatedTime(run: RunPayload | null): string {
  if (!run?.generatedAt) return "No run";
  return new Date(run.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function shortText(value?: string, fallback = "check"): string {
  return value?.trim() || fallback;
}

function compactTime(value?: string): string {
  if (!value) return "check";
  return value
    .replace(/^today,\s*/i, "")
    .replace(/\bdays?\b/gi, "d")
    .replace(/\bhours?\b/gi, "h")
    .replace(/\bminutes?\b/gi, "m")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locationText(listing: AuctionListing): string {
  return listing.location || "Location: check listing";
}

function splitConcernText(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/,\s+|;\s+|\.\s+/)
    .map((item) => item.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .slice(0, 5);
}

export function App(props: { clerkPublishableKey: string }) {
  const auth = useClerkBrowser(props.clerkPublishableKey);
  const [run, setRun] = useState<RunPayload | null>(null);
  const [user, setUser] = useState<UserPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("deck");
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [feedbackByKey, setFeedbackByKey] = useState<Map<string, FeedbackRecord>>(new Map());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [photoTouchStart, setPhotoTouchStart] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn || !auth.clerk) return;
    setLoading(true);
    setAuthTokenGetter(() => auth.clerk?.session?.getToken() || Promise.resolve(null));
    let cancelled = false;
    async function load() {
      try {
        const [nextRun, nextUser] = await Promise.all([getLatestRun(), getMe().catch(() => null)]);
        if (cancelled) return;
        setRun(nextRun);
        setUser(nextUser);
        setFeedbackByKey(mergedFeedback(nextRun));
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the latest run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [auth.clerk, auth.isLoaded, auth.isSignedIn]);

  const visibleListings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (run?.listings || []).filter((listing) => {
      const key = listingKey(listing);
      const feedback = feedbackByKey.get(key);
      if (!showHidden && isHiddenAction(feedback?.action)) return false;
      if (filter === "starred" && feedback?.action !== "star") return false;
      if (filter === "ending" && !isEndingSoon(listing)) return false;
      if (filter === "family" || filter === "solo" || filter === "curiosity") {
        if (listing.lane !== filter) return false;
      }
      if (normalizedQuery && !searchBlob(listing).includes(normalizedQuery)) return false;
      return true;
    });
  }, [feedbackByKey, filter, query, run?.listings, showHidden]);

  const selectedListing = visibleListings[selectedIndex] || visibleListings[0] || null;
  const selectedKey = selectedListing ? listingKey(selectedListing) : "";
  const selectedFeedback = selectedListing ? feedbackByKey.get(selectedKey) || null : null;
  const selectedImages = selectedListing?.images?.length ? selectedListing.images : [];
  const currentImage = selectedImages[imageIndex] || selectedImages[0] || "";

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(visibleListings.length - 1, 0)));
  }, [visibleListings.length]);

  useEffect(() => {
    setImageIndex(0);
  }, [selectedKey]);

  useEffect(() => {
    setImageIndex((current) => Math.min(current, Math.max(selectedImages.length - 1, 0)));
  }, [selectedImages.length]);

  const moveListing = useCallback(
    (direction: -1 | 1) => {
      if (!visibleListings.length) return;
      setSelectedIndex((current) => (current + direction + visibleListings.length) % visibleListings.length);
      setImageIndex(0);
      setMode("deck");
    },
    [visibleListings.length],
  );

  const moveImage = useCallback(
    (direction: -1 | 1) => {
      if (!selectedImages.length) return;
      setImageIndex((current) => (current + direction + selectedImages.length) % selectedImages.length);
    },
    [selectedImages.length],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") moveListing(-1);
      if (event.key === "ArrowRight") moveListing(1);
      if (event.key === "[") moveImage(-1);
      if (event.key === "]") moveImage(1);
      if (event.key.toLowerCase() === "f") setFilterOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveImage, moveListing]);

  async function mark(action: FeedbackAction) {
    if (!selectedListing) return;
    if (selectedFeedback?.action === action) {
      await clearMark();
      return;
    }

    const key = listingKey(selectedListing);
    setPendingAction(`${key}:${action}`);
    const previous = feedbackByKey.get(key);
    const optimistic: FeedbackRecord = {
      listingKey: key,
      action,
      tags: [selectedListing.lane, selectedListing.currentTake || selectedListing.section].filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    setFeedbackByKey((current) => new Map(current).set(key, optimistic));
    try {
      const saved = await putFeedback(key, action, { tags: optimistic.tags });
      setFeedbackByKey((current) => new Map(current).set(key, saved));
    } catch (markError) {
      setFeedbackByKey((current) => {
        const next = new Map(current);
        if (previous) next.set(key, previous);
        else next.delete(key);
        return next;
      });
      setError(markError instanceof Error ? markError.message : "Could not save feedback");
    } finally {
      setPendingAction(null);
    }
  }

  async function clearMark() {
    if (!selectedListing) return;
    const key = listingKey(selectedListing);
    const previous = feedbackByKey.get(key);
    setPendingAction(`${key}:clear`);
    setFeedbackByKey((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    try {
      await clearFeedback(key);
    } catch (clearError) {
      setFeedbackByKey((current) => {
        const next = new Map(current);
        if (previous) next.set(key, previous);
        return next;
      });
      setError(clearError instanceof Error ? clearError.message : "Could not clear feedback");
    } finally {
      setPendingAction(null);
    }
  }

  function onPhotoTouchEnd(clientX: number, clientY: number) {
    if (photoTouchStart === null) return;
    const deltaX = clientX - photoTouchStart.x;
    const deltaY = clientY - photoTouchStart.y;
    setPhotoTouchStart(null);
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    moveImage(deltaX < 0 ? 1 : -1);
  }

  const counts = useMemo(() => {
    const all = run?.listings.length || 0;
    const starred = [...feedbackByKey.values()].filter((feedback) => feedback.action === "star").length;
    const hidden = [...feedbackByKey.values()].filter((feedback) => isHiddenAction(feedback.action)).length;
    const ending = (run?.listings || []).filter(isEndingSoon).length;
    return { all, visible: visibleListings.length, starred, hidden, ending };
  }, [feedbackByKey, run?.listings, visibleListings.length]);

  if (!auth.isLoaded || (auth.isSignedIn && loading)) {
    return (
      <main className="shell is-loading">
        <div className="loading-card">
          <Sparkles aria-hidden="true" />
          <p>Loading today&apos;s auction watch...</p>
        </div>
      </main>
    );
  }

  if (!auth.isSignedIn) {
    return (
      <main className="shell is-loading">
        <section className="auth-card">
          <p className="eyebrow">Private Auction Watch</p>
          <h1>{appName}</h1>
          <p>Sign in with Google to review today&apos;s shortlist and save your stars, skips, and avoid signals.</p>
          {auth.error ? <p className="auth-error">{auth.error}</p> : null}
          <button className="source-link" type="button" onClick={() => void signInWithGoogle(auth.clerk)}>
            Sign in with Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={mode === "deck" ? "shell is-deck" : "shell is-list"}>
      <header className="app-header">
        <div className="brand-line">
          <strong>{appName}</strong>
          <span>{generatedTime(run)}</span>
        </div>
        <div className="header-actions">
          <button className={mode === "deck" ? "icon-toggle is-active" : "icon-toggle"} type="button" onClick={() => setMode("deck")}>
            <span>Deck</span>
          </button>
          <button className={mode === "list" ? "icon-toggle is-active" : "icon-toggle"} type="button" onClick={() => setMode("list")}>
            <List size={17} aria-hidden="true" />
            <span>List</span>
          </button>
          <button className="icon-button" type="button" onClick={() => setFilterOpen(true)} aria-label="Filters">
            <SlidersHorizontal size={19} aria-hidden="true" />
          </button>
          <div className="private-button" title={user?.email || auth.email || "Signed in"}>
            <ShieldCheck size={16} aria-hidden="true" />
            <ClerkUserButton clerk={auth.clerk} />
          </div>
        </div>
      </header>

      {filterOpen ? (
        <FilterSheet
          counts={counts}
          filter={filter}
          query={query}
          setFilter={setFilter}
          setFilterOpen={setFilterOpen}
          setQuery={setQuery}
          setShowHidden={setShowHidden}
          showHidden={showHidden}
        />
      ) : null}

      {error ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : null}

      {selectedListing ? (
        mode === "deck" ? (
          <section className="deck-view" aria-label="Review listing">
            <article className="review-card">
              <div
                className="photo-stage"
                onTouchStart={(event) => {
                  const touch = event.changedTouches[0];
                  setPhotoTouchStart(touch ? { x: touch.clientX, y: touch.clientY } : null);
                }}
                onTouchEnd={(event) => {
                  const touch = event.changedTouches[0];
                  onPhotoTouchEnd(touch?.clientX ?? 0, touch?.clientY ?? 0);
                }}
              >
                {currentImage ? (
                  <img src={currentImage} alt={selectedListing.title} loading="eager" />
                ) : (
                  <div className="empty-photo">
                    <ImageOff size={30} aria-hidden="true" />
                    <span>No image yet</span>
                  </div>
                )}
                {selectedImages.length > 1 ? (
                  <>
                    <button className="image-button is-left" type="button" onClick={() => moveImage(-1)} aria-label="Previous photo">
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <button className="image-button is-right" type="button" onClick={() => moveImage(1)} aria-label="Next photo">
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </>
                ) : null}
                <div className="photo-meta">
                  <span>Photo {selectedImages.length ? `${imageIndex + 1}/${selectedImages.length}` : "0/0"}</span>
                  <Dots count={selectedImages.length} active={imageIndex} />
                </div>
              </div>

              <div className="decision-strip">
                <span>{selectedIndex + 1} / {visibleListings.length}</span>
                <span className={`badge lane-${selectedListing.lane}`}>{laneLabels[selectedListing.lane]}</span>
                <span className={isEndingSoon(selectedListing) ? "time-chip is-urgent" : "time-chip"}>
                  {compactTime(selectedListing.timeLeft || selectedListing.ends)}
                </span>
                <strong>{shortText(selectedListing.total)}</strong>
              </div>

              <section className="listing-primer">
                <div className="title-row">
                  <div>
                    <h1>{selectedListing.title}</h1>
                    <p className="location-line">
                      <MapPin size={15} aria-hidden="true" />
                      <span>{locationText(selectedListing)}</span>
                    </p>
                    <p>{selectedListing.currentTake || selectedListing.why}</p>
                  </div>
                  {selectedFeedback ? <span className={`feedback-dot ${actionClasses[selectedFeedback.action]}`}>{actionLabels[selectedFeedback.action]}</span> : null}
                </div>

                <div className="valuation-row">
                  <Metric label="Current" value={selectedListing.bid} />
                  <Metric label="Fair" value={selectedListing.fair || "Needs comps"} />
                  <Metric label="Stop" value={selectedListing.ceiling || "Set later"} highlight />
                </div>

                <div className="mini-stats">
                  <span>
                    <Gavel size={15} aria-hidden="true" /> {normalizeCount(selectedListing.bids)} bids
                  </span>
                  <span>
                    <MessageCircle size={15} aria-hidden="true" /> {normalizeCount(selectedListing.comments)} comments
                  </span>
                  <span title={locationText(selectedListing)}>
                    <MapPin size={15} aria-hidden="true" /> {selectedListing.location || selectedListing.site}
                  </span>
                </div>
              </section>

              <section className="sticky-listing-strip">
                {selectedListing.images[0] ? <img src={selectedListing.images[0]} alt="" loading="lazy" /> : <span className="mini-empty">No img</span>}
                <div>
                  <strong>{selectedListing.title}</strong>
                  <small>
                    {selectedListing.total} · {compactTime(selectedListing.timeLeft || selectedListing.ends)} · {selectedListing.location || selectedListing.site}
                  </small>
                </div>
                <span>{selectedIndex + 1}/{visibleListings.length}</span>
              </section>

              <section className="details-sheet">
                <DiligenceSection title="Why it fits" body={selectedListing.why} tone="good" />
                <DiligenceList title="Concerns" items={splitConcernText(selectedListing.concerns)} tone="warn" />
                <section className="detail-section">
                  <p>Valuation</p>
                  <div className="valuation-row is-flat">
                    <Metric label="Current" value={selectedListing.bid} />
                    <Metric label="Fair" value={selectedListing.fair || "Needs comps"} />
                    <Metric label="Stop" value={selectedListing.ceiling || "Set later"} highlight />
                    <Metric label="Confidence" value={selectedListing.conf || "check"} />
                  </div>
                </section>
                <section className="detail-section">
                  <p>Auction stats</p>
                  <div className="stat-line">
                    <Stat icon={<BadgeDollarSign />} label="Total" value={selectedListing.total} />
                    <Stat icon={<Clock3 />} label="Ends" value={compactTime(selectedListing.timeLeft || selectedListing.ends)} />
                    <Stat icon={<MapPin />} label="Location" value={selectedListing.location || "check listing"} />
                  </div>
                </section>
              </section>
            </article>
          </section>
        ) : (
          <ListView
            counts={counts}
            feedbackByKey={feedbackByKey}
            listings={visibleListings}
            selectedIndex={selectedIndex}
            setFilterOpen={setFilterOpen}
            setMode={setMode}
            setSelectedIndex={setSelectedIndex}
          />
        )
      ) : (
        <section className="empty-state">
          <CircleSlash size={34} aria-hidden="true" />
          <h2>No listings match this view</h2>
          <p>Try clearing search, switching filters, or showing hidden listings.</p>
          <button className="source-link" type="button" onClick={() => setFilterOpen(true)}>
            Adjust filters
          </button>
        </section>
      )}

      {selectedListing ? (
        <ReviewRail
          feedback={selectedFeedback}
          listing={selectedListing}
          moveListing={moveListing}
          onMark={(action) => void mark(action)}
          pending={pendingAction !== null}
        />
      ) : null}
    </main>
  );
}

function FilterSheet(props: {
  counts: { all: number; visible: number; starred: number; hidden: number; ending: number };
  filter: ViewFilter;
  query: string;
  showHidden: boolean;
  setFilter: (filter: ViewFilter) => void;
  setFilterOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setShowHidden: (show: boolean) => void;
}) {
  return (
    <div className="filter-overlay">
      <button className="filter-backdrop" type="button" onClick={() => props.setFilterOpen(false)} aria-label="Close filters" />
      <section className="filter-sheet" aria-label="Filters">
        <div className="sheet-grabber" />
        <div className="sheet-title">
          <strong>Filters</strong>
          <button type="button" onClick={() => props.setFilterOpen(false)}>
            Done
          </button>
        </div>
        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="Thing, Vespa, rust, cheap..." />
        </label>
        <div className="filter-grid">
          <FilterChip active={props.filter === "all"} onClick={() => props.setFilter("all")} label={`All ${props.counts.all}`} />
          <FilterChip active={props.filter === "family"} onClick={() => props.setFilter("family")} label="Family" />
          <FilterChip active={props.filter === "solo"} onClick={() => props.setFilter("solo")} label="Solo" />
          <FilterChip active={props.filter === "curiosity"} onClick={() => props.setFilter("curiosity")} label="Curiosity" />
          <FilterChip active={props.filter === "ending"} onClick={() => props.setFilter("ending")} label={`Ending ${props.counts.ending}`} />
          <FilterChip active={props.filter === "starred"} onClick={() => props.setFilter("starred")} label={`Starred ${props.counts.starred}`} />
        </div>
        <label className="toggle">
          <input checked={props.showHidden} onChange={(event) => props.setShowHidden(event.target.checked)} type="checkbox" />
          <span>Show hidden and avoid-similar</span>
          <small>{props.counts.hidden}</small>
        </label>
      </section>
    </div>
  );
}

function ListView(props: {
  counts: { all: number; visible: number; ending: number };
  feedbackByKey: Map<string, FeedbackRecord>;
  listings: AuctionListing[];
  selectedIndex: number;
  setFilterOpen: (open: boolean) => void;
  setMode: (mode: ViewMode) => void;
  setSelectedIndex: (index: number) => void;
}) {
  return (
    <section className="scan-view" aria-label="Scan listings">
      <div className="scan-toolbar">
        <button type="button" onClick={() => props.setFilterOpen(true)}>
          Today {props.counts.visible} picks
        </button>
        <button type="button" onClick={() => props.setFilterOpen(true)}>
          Ending soon {props.counts.ending}
        </button>
      </div>
      <div className="listing-list">
        {props.listings.map((listing, index) => {
          const key = listingKey(listing);
          const feedback = props.feedbackByKey.get(key);
          return (
            <button
              className={index === props.selectedIndex ? "scan-row is-active" : "scan-row"}
              key={key}
              type="button"
              onClick={() => {
                props.setSelectedIndex(index);
                props.setMode("deck");
              }}
            >
              {listing.images[0] ? <img src={listing.images[0]} alt="" loading="lazy" /> : <span className="mini-empty">No img</span>}
              <span className="scan-copy">
                <span>
                  <strong>{listing.title}</strong>
                  <i className={`badge lane-${listing.lane}`}>{laneLabels[listing.lane]}</i>
                </span>
                <small>
                  <MapPin size={13} aria-hidden="true" /> {listing.location || "Location check"}
                </small>
                <small>{listing.currentTake || listing.section}</small>
                <em>{listing.fair || "Fair value check"}</em>
              </span>
              <span className="scan-price">
                <strong>{listing.total}</strong>
                <small className={isEndingSoon(listing) ? "is-urgent" : ""}>{compactTime(listing.timeLeft || listing.ends)}</small>
                <Star className={feedback?.action === "star" ? "is-lit" : ""} size={21} aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ReviewRail(props: {
  feedback: FeedbackRecord | null;
  listing: AuctionListing;
  pending: boolean;
  moveListing: (direction: -1 | 1) => void;
  onMark: (action: FeedbackAction) => void;
}) {
  return (
    <nav className="review-rail" aria-label="Review actions">
      <button type="button" onClick={() => props.moveListing(-1)} aria-label="Previous listing">
        <ChevronLeft aria-hidden="true" />
      </button>
      <button
        className={props.feedback?.action === "avoid" ? "rail-action is-selected is-avoid-action" : "rail-action"}
        disabled={props.pending}
        type="button"
        onClick={() => props.onMark("avoid")}
      >
        <CircleSlash size={20} aria-hidden="true" />
        <span>Avoid</span>
      </button>
      <button
        className={props.feedback?.action === "hide" ? "rail-action is-selected" : "rail-action"}
        disabled={props.pending}
        type="button"
        onClick={() => props.onMark("hide")}
      >
        <X size={20} aria-hidden="true" />
        <span>Hide</span>
      </button>
      <button
        className={props.feedback?.action === "star" ? "rail-action is-selected is-star-action" : "rail-action"}
        disabled={props.pending}
        type="button"
        onClick={() => props.onMark("star")}
      >
        <Star size={20} aria-hidden="true" />
        <span>Star</span>
      </button>
      <a className="rail-action open-action" href={props.listing.url} target="_blank" rel="noreferrer">
        <ExternalLink size={20} aria-hidden="true" />
        <span>Open</span>
      </a>
      <button type="button" onClick={() => props.moveListing(1)} aria-label="Next listing">
        <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  );
}

function FilterChip(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={props.active ? "chip is-active" : "chip"} type="button" onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function Dots(props: { count: number; active: number }) {
  if (props.count <= 1) return null;
  return (
    <span className="photo-dots" aria-hidden="true">
      {Array.from({ length: Math.min(props.count, 5) }, (_, index) => (
        <i className={index === props.active ? "is-active" : ""} key={index} />
      ))}
    </span>
  );
}

function Metric(props: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={props.highlight ? "metric is-highlight" : "metric"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function DiligenceSection(props: { title: string; body?: string; tone?: "good" | "warn" }) {
  if (!props.body) return null;
  return (
    <section className={`detail-section ${props.tone ? `is-${props.tone}` : ""}`}>
      <p>{props.title}</p>
      <div>{props.body}</div>
    </section>
  );
}

function DiligenceList(props: { title: string; items: string[]; tone?: "good" | "warn" }) {
  if (!props.items.length) return null;
  return (
    <section className={`detail-section ${props.tone ? `is-${props.tone}` : ""}`}>
      <p>{props.title}</p>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ClerkUserButton(props: { clerk: BrowserClerk | null }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.clerk?.mountUserButton || !ref.current) return;
    const node = ref.current;
    props.clerk.mountUserButton(node, { afterSignOutUrl: "/" });
    return () => props.clerk?.unmountUserButton?.(node);
  }, [props.clerk]);

  if (!props.clerk?.mountUserButton) {
    return (
      <button className="mini-signout" type="button" onClick={() => void props.clerk?.signOut({ redirectUrl: "/" })}>
        Sign out
      </button>
    );
  }

  return <div className="clerk-user-button" ref={ref} />;
}

function Stat(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="stat">
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
