export type Lane = "family" | "solo" | "curiosity";
export type FeedbackAction = "like" | "star" | "hide" | "avoid";

export interface AuctionListing {
  listingKey?: string;
  section: string;
  lane: Lane;
  site: string;
  title: string;
  url: string;
  bid: string;
  total: string;
  location?: string;
  bidNum?: number;
  endsAt?: string;
  ends?: string;
  timeLeft?: string;
  bids?: string | number;
  bidders?: string | number;
  comments?: string | number;
  fair?: string;
  ceiling?: string;
  conf?: string;
  why: string;
  concerns: string;
  currentTake?: string;
  images: string[];
  originalImages?: string[];
  feedback?: FeedbackRecord | null;
  imageStatus?: ImageStatus[];
}

export interface ImageStatus {
  imageKey: string;
  sourceUrl: string;
  url: string;
  copied: boolean;
  status: "pending" | "copied" | "failed";
  error?: string | null;
}

export interface FeedbackRecord {
  listingKey: string;
  action: FeedbackAction;
  tags: string[];
  note?: string | null;
  updatedAt: string;
}

export interface PreferenceEvent {
  id: string;
  listingKey?: string | null;
  eventType: "voice_note" | "text_note" | "viewed";
  note?: string | null;
  transcript?: string | null;
  tags: string[];
  createdAt: string;
}

export interface RunPayload {
  id: string;
  generatedAt: string;
  reportMarkdown?: string | null;
  sourceSummary?: unknown;
  listings: AuctionListing[];
  feedback: FeedbackRecord[];
}

export interface ImportPayload {
  generatedAt?: string;
  reportMarkdown?: string;
  sourceSummary?: unknown;
  listings?: AuctionListing[];
  items?: AuctionListing[];
}

export interface FeedbackExport {
  version: 1;
  kind: "auction-watch-feedback";
  generatedAt: string;
  counts: Record<FeedbackAction, number> & { total: number };
  entries: Array<FeedbackRecord & { listing?: AuctionListing | null }>;
  preferenceEvents?: Array<PreferenceEvent & { listing?: AuctionListing | null }>;
  steering: {
    prioritizeSimilarTo: Array<{ title: string; url: string; tags: string[] }>;
    suppressExactUrls: string[];
    avoidSimilarTo: Array<{ title: string; url: string; tags: string[]; why?: string }>;
    notes: Array<{ title?: string; url?: string; note: string; tags: string[] }>;
  };
}

export interface UserPayload {
  email: string;
}
