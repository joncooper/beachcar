# Beachcar Build Week video

## Local upload master

The upload master is the local production file `docs/build-week/Beachcar-Build-Week-final.mp4`. It is intentionally ignored by Git and is not a repository download. After upload, use the verified public YouTube URL as the film link. The repository retains a reference/localization [SRT companion](../Beachcar-Build-Week-final.srt) and [YouTube thumbnail](../Beachcar-Build-Week-thumbnail.jpg).

- Duration: **100.80 seconds (1:40.80)**
- Video: **H.264 High, 1920×1080, CFR 30 fps, Rec.709**
- Audio: **AAC mono, 48 kHz**, ElevenLabs Chris, generated under the active Creator subscription
- Loudness: **−16.7 LUFS / −1.4 dBTP**
- Captions: **26** burned-in cues, with matching SRT timing retained for reference, localization, or a separately exported captionless master
- Picture: seven permission-covered real photographs of the purchased Surrey, two privacy-reviewed iPhone captures, and two privacy-scrubbed captures of the working local demo replay

The film contains no generated car, auction-page capture, dummy email, password, token, or private notification. The product-proof beat is an overt editorial board made from real detail photographs—not a simulated live result—and clearly communicates fit, price doubt, and summer risk without contradicting the narration. During “Codex helped me build Beachcar too,” the film shows the actual working local `/demo` replay moving from Teach to Research, with an explicit local/no-login label and click cue. The reveal caption begins at **55.258s** and the first complete-Surrey frame lands at **55.500s**. The purchase captions are waveform-aligned too: “I bought it” runs **62.963–64.618s**, and “This is actually my car now” begins at **64.618s**. The real outdoor payoff changes angle at the start of the spoken purchase line. The closing lockup includes **APPS FOR YOUR LIFE**. The older internal review and Samantha rough cut remain historical editing artifacts only.

**Caption upload warning:** the MP4 already contains burned-in captions. The SRT is a timing reference and localization source; do not enable it alongside this master on YouTube, or viewers will see duplicate captions. Export a captionless master before using the SRT as a selectable YouTube caption track.

## Private inputs

The builder expects these six Creator-tier Chris MP3s in a private working directory:

```text
01-found.mp3
02-taste.mp3
03-agent.mp3
04-gpt.mp3
05-garage.mp3
06-close.mp3
```

It also expects six to eight permission-cleared files under `<captures>/owner-car/`, the two iPhone capture paths, and the privacy-scrubbed `demo/teach.jpg` and `demo/research.jpg` captures declared in `build_final_cut.swift`. Narration and raw gallery masters remain ignored private production inputs; the final photo decisions and permission basis are recorded in `../photo-permissions.md`.

## Rebuild

On macOS:

```sh
mkdir -p /tmp/beachcar-swift-module-cache

SWIFT_MODULECACHE_PATH=/tmp/beachcar-swift-module-cache \
CLANG_MODULE_CACHE_PATH=/tmp/beachcar-swift-module-cache \
swift docs/build-week/video-src/build_final_cut.swift \
  "$PWD" \
  "$PWD/.tmp/video/audio/chris/real-recut/sections-creator-story" \
  "$PWD/.tmp/video/captures" \
  "$PWD/.tmp/video/Beachcar-Build-Week-final-raw.mp4"
```

`build_final_cut.swift` derives section, shot, and caption timing from the actual MP3 durations, writes the companion SRT, enforces a 90–120 second story window, and requires access to the macOS H.264 encoder. Normalize the rendered narration to a YouTube-appropriate target near −16 LUFS with true peak at or below −1.5 dBTP, copy the verified MP4 to the ignored local upload path and the SRT companion to its tracked path above, then rerun strict decode, loudness, CFR, subtitle, and visual checks.

For submission, link the public, signed-out-verified YouTube upload. For working-project access, use a verified hosted experience or a permanent final-commit GitHub permalink to [the judge guide](../judge-guide.md); do not present the local MP4 path as either public access route.

## Rights and identity

The public cut and submission identity use only deterministic crops/resizes of the real, permission-covered Surrey photographs. The website and iPhone hero use the studio photograph; the app and site icon use the real wheel detail. Generated Surrey artwork is excluded from the public film and active submission identity. See [photo-permissions.md](../photo-permissions.md) for the recorded permission boundary.
