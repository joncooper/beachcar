# Beachcar Build Week video

## Final internal review

The current editorial master is [Beachcar-Build-Week-internal-review.mp4](../Beachcar-Build-Week-internal-review.mp4), with an uploadable [SRT caption file](../Beachcar-Build-Week-internal-review.srt).

- Duration: **161.8 seconds (2:41.8)**
- Video: **H.264 High, 1920×1080, 30 fps, Rec.709**
- Audio: **AAC mono, 48 kHz**, ElevenLabs Chris, normalized to approximately **−17 LUFS / −1.4 dBTP**
- Tracks: **2** (one enabled video track, one enabled audio track)
- Captions: **47** matching burned-in and SRT cues
- Validation: `/usr/bin/avmediainfo` reported **0 media errors**

This file is **internal review only**. Its Chris narration was generated while the ElevenLabs account was on the free tier. ElevenLabs requires a paid plan for commercial use and says that upgrading does not retroactively license earlier free-tier output. Before competition upload, upgrade to at least Starter, regenerate the same nine sections, rebuild, normalize, and name that licensed export `Beachcar-Build-Week-final.mp4`.

The final editor uses rights-safe web replay captures and iPhone Simulator captures from `.tmp/video/captures`. It contains no listing-gallery image. The iPhone handoff uses the generated Surrey art and synthetic `friend@example.com` data. Source names visible in the deterministic research contract are plain-text context labels rather than copied marketplace branding.

### Rebuild the edit

The builder expects nine ordered Chris MP3s in a private working directory:

```text
01-outcome.mp3
02-alerts.mp3
03-changed.mp3
04-gpt.mp3
05-continuity.mp3
06-five.mp3
07-learning.mp3
08-codex.mp3
09-close.mp3
```

On macOS:

```sh
mkdir -p /tmp/beachcar-swift-module-cache

SWIFT_MODULECACHE_PATH=/tmp/beachcar-swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/beachcar-swift-module-cache \
swift docs/build-week/video-src/build_final_cut.swift \
  "$PWD" \
  "$PWD/.tmp/video/audio/chris/sections-fast" \
  "$PWD/.tmp/video/captures" \
  "$PWD/docs/build-week/Beachcar-Build-Week-internal-review.mp4"

ffmpeg -i docs/build-week/Beachcar-Build-Week-internal-review.mp4 \
  -map 0:v:0 -map 0:a:0 -c:v copy \
  -af 'loudnorm=I=-16:TP=-1.5:LRA=11' \
  -c:a aac -b:a 192k -ar 48000 -ac 1 -movflags +faststart \
  docs/build-week/Beachcar-Build-Week-internal-review-normalized.mp4
```

`build_final_cut.swift` derives all section, shot, and caption timing from the actual MP3 durations, fails above 175 seconds, writes the companion SRT, and requires access to the macOS H.264 encoder. The checked internal master used the 1.12× Chris speed setting so the delivery remained natural and safely below three minutes.

## Original rough cut

The playable rough cut is [Beachcar-Build-Week-rough-cut.mp4](../Beachcar-Build-Week-rough-cut.mp4).

## Export

- Duration: **170.800 seconds (2:50.800)**
- Video: **H.264, 1920×1080, 30 fps**
- Audio: **AAC mono**, synthesized macOS Samantha voice
- Tracks: **2** (one enabled video track, one enabled audio track)
- Validation: `/usr/bin/avmediainfo` reported **0 media errors**
- Decoded audio check: 16-bit peak **28,698**, RMS **4,940.22**

The top-right `ROUGH CUT · SYNTHESIZED NARRATION` label is intentional. Replace the synthesized voice with the creator's final recording before the public submission.

## Rights-safe provenance

This cut contains no Bring a Trailer page capture, marketplace logo, listing-gallery photo, or photo-derived Beachcar asset.

It uses only:

- the original generated Beachcar Surrey artwork in `assets/brand/beachcar-icon.png`;
- rights-safe deck previews `slide-01`, `02`, `03`, `04`, `06`, and `07`;
- the original iPhone UI capture embedded in slide 03;
- the current deterministic `/demo` learning UI embedded in slide 06; and
- original typography and graphics rendered from `src/client/build-week/fixture.ts` for the replay, shortlist, and Build Week sections.

The continuity graphic is explicitly labeled `DETERMINISTIC REPLAY · TESTED CONTRACT`. It keeps fixture ID `demo_replay_surrey_path` across the fixture replay and review state, and separately identifies the golden-path smoke test as a synthetic publish/read-back check through the same MCP. It explicitly says the fixture is not a captured production run.

No frame claims verified candidates, a matching production run on the phone, or a captured production search. Candidate counts are labeled `5 FIXTURE CANDIDATES`.

Do not substitute `surrey-key-art.png`, `surrey-mark.webp`, `SurreyHero`, the old Build Week photo cards, or any gallery reference without documented publication permission.

## Rebuild

On macOS:

```sh
mkdir -p /tmp/beachcar-swift-module-cache

say -v Samantha -r 175 \
  -f docs/build-week/video-src/narration-rough-cut.txt \
  -o /tmp/beachcar-narration.aiff

SWIFT_MODULECACHE_PATH=/tmp/beachcar-swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/beachcar-swift-module-cache \
swift docs/build-week/video-src/build_rough_cut.swift \
  "$PWD" \
  /tmp/beachcar-narration.aiff \
  "$PWD/docs/build-week/Beachcar-Build-Week-rough-cut.mp4"

SWIFT_MODULECACHE_PATH=/tmp/beachcar-swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/beachcar-swift-module-cache \
swift docs/build-week/video-src/inspect_media.swift \
  docs/build-week/Beachcar-Build-Week-rough-cut.mp4 \
  /tmp/beachcar-rough-cut-frames
```

`build_rough_cut.swift` uses AVFoundation and VideoToolbox; it does not depend on ffmpeg. `inspect_media.swift` decodes the final AAC audio to measure its level and extracts ten representative PNG frames for visual review.
