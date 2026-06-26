# Auction Source Playbook

Use this playbook for any source, including Bring a Trailer, Cars & Bids, Marketplace-style sites, dealer inventory, or niche auction houses.

For each source:

1. Start from search, category, saved search, ending-soon, and newly-listed pages.
2. Use the user's logged-in browser session when needed.
3. Open promising listings in detail pages before deciding.
4. Extract:
   - title, URL, site
   - current bid/ask/status
   - buyer fee or fee assumptions
   - location
   - ending timestamp and human time left
   - bid count, bidder count if available, comment count
   - 3-5 useful image URLs
   - seller notes, title/VIN/history clues, modifications, known flaws
   - optional `dossier` detail when the listing page provides it: a one-paragraph summary, a spec grid (odometer, engine, transmission, drivetrain, exterior, interior, title, seller, lot), the full multi-paragraph seller writeup (`listing`), `equipment`/`service` bullets, recent `bidLog` entries (bidder, amount, time-ago), top `comments` (mark the seller's posts with `seller: true`), and a `beachUse` fit note. Only include detail actually on the page — never invent it.
5. Avoid tiny thumbnails, logos, UI icons, and duplicate resized copies.
6. If a field is blocked or absent, use `check listing` and keep the candidate if it is otherwise relevant.

Do not bypass access controls. If a source resists automation, reduce request volume, use manual inspection, or include a check-listing note.

