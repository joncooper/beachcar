# Beachcar Build Week media permissions

Status: **Public cut remains rights-safe by default. The Bring a Trailer gallery is excluded unless written permission is received.**

This is a production checklist, not legal advice. A public webpage is not a license, and owning the car does not transfer copyright in the seller's or photographer's images.

## Default decision

Ship the public video, deck, README, and Devpost images using only:

- original generated Beachcar Surrey illustration and iconography with retained generation provenance;
- fresh Beachcar web and native app captures that contain owned or generated sample imagery;
- fresh Codex, browser-control, MCP, test, and iOS Simulator captures with secrets and third-party page content removed;
- photos or footage the creator personally records after purchase, subject to any recognizable-person, private-property, or music releases;
- original narration and silence, or music/sound with a documented publication license.

The public default does **not** show a Bring a Trailer page, logo, listing screenshot, gallery image, seller-supplied image, photographer's watermark, or copied listing prose. The public listing may be linked as corroboration in the video description and repository.

## Current asset classification

| Asset | Working status | Public-cut action |
| --- | --- | --- |
| `assets/brand/beachcar-icon.png`, `public/icon.svg`, `public/icon-512.png` | Original Beachcar art; the raster source retains GPT Image generation provenance and was created without a third-party edit source | Allowed. Keep the original generation record with the release evidence. |
| `assets/brand/build-week/beachcar-title-card.png` | Composites the held `surrey-key-art.png` asset | **Hold.** Replace with the current deck title treatment or regenerated icon before any public use. |
| Fresh `/demo` captures using the generated icon | Original Beachcar UI | Allowed. Keep `DETERMINISTIC REPLAY` visible and check for external thumbnails. |
| Fresh iPhone/Codex/MCP/Simulator captures | Creator-generated product footage | Allowed after privacy, secret, and embedded-image review. |
| Creator-shot post-purchase car footage | Creator-owned only if personally recorded | Allowed after confirming who recorded it and clearing recognizable people, property, and ambient music. |
| `assets/brand/surrey-key-art.png`, `public/surrey-key-art.png`, `public/surrey-mark.webp` | Provenance requires review; may derive from listing photography | Hold. Do not use publicly unless it is proven wholly generated or separately cleared. |
| `assets/brand/build-week/beachcar-proof-card.png`, `beachcar-gallery-card.png` | Contains Bring a Trailer listing photography | Hold for the permission-ready alternate only. |
| `assets/brand/build-week/gallery-reference/*` and any local gallery downloads | Third-party listing photography | Reference only. Do not commit, redistribute, upload, or place in a public edit without written permission. |
| Marketplace logos, page captures, and copied listing copy | Third-party marks and content | Exclude by default. A factual car name, short source attribution, or ordinary text link is sufficient. |
| Commercial music, social audio, stock video, fonts, or sound effects | Unknown until license recorded | Exclude until the license explicitly covers a public competition video, YouTube, Devpost, and promotional reuse. |

When provenance is uncertain, classify the asset as **hold**. Do not infer permission from a missing watermark, a public URL, a download button, or car ownership.

## Permission-ready gallery alternate

The user reports that the listing contains 87 photographs. That breadth is useful for choosing a concise visual story, but the alternate cut should use no more than five cleared images:

1. one studio hero for the 0:00 cold open;
2. one grille or headlamp detail behind the “taste is harder” beat;
3. one striped-seat or dashboard detail inside the dossier beat;
4. optionally one second interior/detail image if the narration needs a visual bridge;
5. one outdoor rear three-quarter or profile for the closing human-impact beat.

Do not use a slideshow of the whole gallery. Do not download additional candidates while permission is pending. Record desired selections by their public listing position and a plain-language description, not by copying the files into the repository.

### Permissions-ready visual shortlist

The user observed 87 photos in the gallery, while the listing's current embedded gallery metadata contains 116 items. The visible order may reflect a different display subset or may change as the listing changes, so an ordinal alone is not a reliable permission identifier. Use the attachment ID and filename together in every request and approval.

| Current embedded ordinal | Attachment ID | Filename | Composition and possible use |
| --- | --- | --- | --- |
| 5 | `116963057` | `036A3158-02184-scaled.jpg` | Tighter front three-quarter studio view; preferred hero and the gallery master nearest the user-selected featured image. |
| 8 | `116963112` | `036A3095-02202-scaled.jpg` | Rear three-quarter studio view with the striped spare and canopy; a distinctive reveal or closing angle. |
| 13 | `116963011` | `036A3163-02172-scaled.jpg` | Clean side profile; useful as a graphic silhouette, transition, or product-loop backdrop. |
| 20 | `116962991` | `036A3181-02166-scaled.jpg` | Symmetrical grille-and-headlamp close-up; a high-impact identity detail behind the taste beat. |
| 49 | `116963062` | `036A3134-02186-scaled.jpg` | Pink-and-white canopy-stripe macro; a strong texture bridge between story chapters. |
| 57 | `116963066` | `036A3155-02187-scaled.jpg` | Striped seating and pink bodywork; the clearest visual for the taste or dossier beat. |
| 73 | `116963065` | `036A3122-02187-scaled.jpg` | Cockpit with steering wheel, dashboard, and striped bench; a human point-of-view or learning beat. |
| 110 | `118460362` | `1960_jeep_cj-3b_IMG_7265-62829-scaled.jpg` | Natural-light front three-quarter view; the best contrast to the studio set for the real-world outcome. |

The gallery metadata shows only the generic title “1960 Willys DJ-3A Surrey.” No per-photo caption, photographer credit, or ownership statement is visible. The page identifies the seller as PrivateCollectionMotors and the footer states “© 2026 Bring a Trailer Media, LLC. All Rights Reserved,” but neither fact alone establishes who can license each photo. Confirm the actual photographer or copyright holder in writing.

Ask to clear no more than five final images from this shortlist. The recommended first request is ordinals 5, 8, 20, 57, and 110, identified by attachment ID and filename; keep the other three as substitution options rather than expanding the public edit.

## Permission must cover

Written approval should identify the copyright holder and grant Beachcar permission to:

- use the specifically identified images in the OpenAI Build Week submission;
- publish them in a public YouTube video, Devpost entry, presentation deck, repository documentation, website, and related project promotion;
- crop, resize, color-correct, animate, add titles, and combine the images with product footage;
- publish worldwide for the duration of judging and continued portfolio availability;
- allow OpenAI, Devpost, YouTube, and their service providers to host, display, cache, judge, and promote the submitted materials as contemplated by their platform and competition terms;
- use the agreed credit line;
- receive the license directly from the party authorized to grant it.

If the seller, photographer, auction platform, or another agency share rights, obtain every required approval. Keep the complete email thread or signed release outside the public repository, and record only its status and permitted credit here.

## Clearance request draft

Subject: Permission to use selected photos from the 1960 Willys DJ-3A Surrey listing

> I purchased the pink 1960 Willys DJ-3A Surrey featured in the listing below after my personal software project, Beachcar, surfaced it. I am entering Beachcar in OpenAI Build Week and would like permission to use up to five specifically identified listing photographs in a public demo video under three minutes, its thumbnail, a presentation deck, the Devpost entry, project website, and repository documentation.
>
> The images may be cropped, resized, lightly color-corrected, animated with simple camera moves, and overlaid with titles. The project would use the credit line you specify and link to the original listing. The requested permission is non-exclusive, worldwide, and allows the competition video and project materials to remain publicly available after judging.
>
> The permission must also allow OpenAI, Devpost, YouTube, and their service providers to host, display, cache, judge, and promote the submitted materials under the competition and platform terms. Please confirm that you control the necessary rights, identify any additional party whose approval is required, and state the exact credit line. I can send the proposed image positions and final frames for review before publication.

Do not treat a friendly acknowledgement as permission. The reply must clearly authorize the listed uses or attach a license that does.

## Clearance log

| Item | Copyright holder confirmed | Requested | Written approval | Allowed uses and edits | Required credit | Final decision |
| --- | --- | --- | --- | --- | --- | --- |
| BaT listing gallery, up to five selected photos | Pending | Pending | No | Pending | Pending | **Excluded** |
| Generated Surrey illustration | GPT Image generation provenance retained; no third-party edit source | Not applicable | Not applicable | Product and submission identity | None | **Approved** |
| Creator-shot real-car footage | Confirm camera operator | Not applicable | Not applicable | Public submission and promotion | None expected | Pending capture |
| Narration and room tone | Creator | Not applicable | Not applicable | Public submission and promotion | None | Approved once recorded |
| Music or sound effects | None selected | Not applicable | Not applicable | Not applicable | Not applicable | **No music by default** |

## Final rights gate

Before export, freeze the picture and audit every visible frame:

- Every photo and video clip maps to an approved row in the clearance log.
- Every required credit appears for the required duration and is readable at 1080p.
- No auction logo, listing page, copied prose, photographer watermark, or third-party thumbnail slipped into screen recordings.
- No personal notification, token, email, account identifier, face, license plate, or private location appears without intent and permission.
- The YouTube description includes the factual source link and any required credits, but never claims that Beachcar bid on or purchased the car.
- If any approval is ambiguous at export time, use the public rights-safe replacement.
