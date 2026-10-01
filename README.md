# Clipper

Turn a long video into short vertical clips, automatically. It transcribes the video, picks the moments that work on their own, cuts out dead air, reframes to 9:16, adds word-by-word pop captions and a hook, levels the sound for social, and checks every clip before it hands it over.

It runs on your own computer. The moments are picked by [Claude Code](https://claude.com/claude-code) using the skill in this repo, and everything else is free, open-source tools: FFmpeg and whisper.cpp.

## What it does

- **Finds the clips.** Claude reads the whole transcript and picks 3 to 5 moments that stand alone, hook in the first two seconds, and end on a payoff. Each clip is 20 to 60 seconds long.
- **Cuts pauses, not words.** Silences longer than you set are removed. The QA step checks that every word inside the chosen moment survived.
- **Pop captions.** Words appear as they're spoken, the current word highlighted with a quick pop, the way CapCut captions look. Captions are made from the finished audio, so they match what's actually said. Where Whisper mishears a word the second time, the original transcript's spelling wins.
- **A hook on screen.** Big outlined text for the first seconds, with the key words in your highlight colour.
- **Screen footage over your voice.** Name the words and it puts a screenshot or screen recording on screen while you say them. Your face moves to the bottom half and the captions move to the seam between the two. Screenshots can pan smoothly across the page.
- **Checks every clip:** vertical format, sound present, loudness at about −14 LUFS, no black frames, no dead air, no leftover rotation tag (the cause of sideways phone video), the opening words, and at least 90% of the words kept. It also makes a contact sheet so you can see the framing at a glance.
- **A review page for your notes.** An editor-style page with a media bin, player and timeline (filmstrip, waveform, zoom). Press **N** wherever something looks wrong, or drag across the timeline to note a few seconds at once, and type what you see. Each note keeps the moment or span, the captions on screen and stills of the frames, so Claude fixes exactly what you saw.
- **Works with the free [teleprompter](https://github.com/jameselle/teleprompter).** One command joins your kept takes, section by section, into one video ready to clip.

Nothing is ever posted. You get video files.

## What you need

- A Mac or Linux machine with **Node 20.11 or newer**.
- **FFmpeg** built with libass, for the captions. `brew install ffmpeg` includes it.
- **whisper.cpp**, for the transcripts: `brew install whisper-cpp`, or set `CLIPPER_WHISPER` to the path of your `whisper-cli`.
- **Claude Code**, for picking the clips automatically. Without it, you can still render clips by writing the spec yourself (see below).

## Set it up

```sh
git clone https://github.com/jameselle/clipper.git
cd clipper
npm install
npm run models      # downloads the whisper model (small.en, about 470 MB) once
npm test            # optional: 27 tests, including one full end-to-end render on macOS
```

## Use it with Claude Code

Open the folder in Claude Code and ask:

```
clip ~/Videos/my-podcast.mp4
```

The `clip` skill in `.claude/skills/clip` does the rest. It makes a job folder under `jobs/`, transcribes the video, reads the whole transcript, picks the moments, writes a spec for each clip, renders them, runs QA, fixes anything that fails, and looks at each contact sheet before handing the clips over.

Recorded on the teleprompter? Point it at the script folder instead:

```
clip my teleprompter takes in ~/Movies/Teleprompter/my-script
```

## Review the clips, then let Claude fix them

```sh
npm run review          # http://127.0.0.1:8794, every video under jobs/
```

Pick a clip from Media and watch it. When something looks off (a caption covering a graphic, a cut that lands mid-word, the wrong screenshot), press **N**. The video pauses, a still of that exact frame is grabbed, and you type what's wrong. **Enter** saves it.

To point at a few seconds rather than one frame, **drag across the notes lane** on the timeline (or press **I** at the start and **O** at the end, then **N**). A span note shows as a bar on the timeline and keeps stills from its start, middle and end, plus every caption shown across it.

| Key | Does |
|---|---|
| **Space** | play / pause |
| **N** | note at this moment, or on the marked span |
| **I** / **O** | mark the start / end of a span (**Esc** clears it) |
| **← →** | back / forward 1 s (**Shift** for 5 s) |
| **, .** | one frame back / forward |
| **+ −** | zoom the timeline (**⌘ scroll** too; **Shift Z** fits it) |
| **F** | full screen |

Then tell Claude Code:

```
fix my review notes on jobs/<job>/<clip>-vertical.mp4
```

The `clip` skill reads every note and its frame, changes the spec, re-renders, re-checks, and marks each note fixed with what it changed. Fixed notes stay on the page (tick **show fixed**), and a note written on an earlier render is marked **earlier cut**. Notes are saved beside the video, as `<clip>.review.json` with the frame stills in `<clip>.review/`. The filmstrip, waveform and thumbnails are made by FFmpeg the first time a video is opened and cached in your temp folder. The page only answers on 127.0.0.1 and only reads videos inside the folder you give it. `npm run review -- ~/some/folder` reviews any folder of videos.

## Use it by hand

Every clip is described by a `spec.json`:

```json
{
  "title": "stop-paying-for-a-clipping-app",
  "sources": { "a": "/absolute/path/to/long-video.mp4" },
  "segments": [ { "source": "a", "start": 198.2, "end": 224.4 } ],
  "formats": ["vertical"],
  "reframe": "crop", "focusX": 0.5,
  "tightenPauses": 0.6,
  "captions": true,
  "hook": { "text": "STOP PAYING FOR A CLIPPING APP", "seconds": 2.5, "highlight": "stop paying" },
  "faceY": 0.47,
  "cutaways": [
    { "file": "/absolute/path/to/screenshot.png", "from": "The version I use", "to": "to do.",
      "pan": { "from": [520, 6300, 1200], "to": [520, 6360, 1200] } }
  ]
}
```

```sh
npm run clip -- new-job "my talk"                 # makes jobs/<date>-my-talk and prints the path
npm run clip -- transcribe video.mp4 --out <job>  # every word with its start and end time
npm run clip -- render <job>/1/spec.json          # renders <title>-vertical.mp4 next to the spec
npm run clip -- check <job>/1/<title>-vertical.mp4 --hook "STOP PAYING FOR A CLIPPING APP"
npm run clip -- from-teleprompter ~/Movies/Teleprompter/<script-folder>
```

| Spec field | What it does |
|---|---|
| `segments` | The parts of the source to keep, in order, in seconds. Several segments stitch a setup to its payoff. |
| `formats` | `vertical` (1080×1920), `square`, `landscape`. |
| `reframe`, `focusX` | `crop` keeps the subject centred at `focusX` (0 is left, 1 is right). `fit-blur` fits the whole frame over a blurred copy. |
| `tightenPauses` | Removes silences longer than this many seconds. |
| `hook` | On-screen text for the first seconds. `highlight` colours part of it. |
| `cutaways` | Screen footage over the voice, placed by the words it covers (`from`, `to`), matched against what the finished clip says. |
| `faceY` | Where the face sits (0 is top, 1 is bottom), used for the bottom half during cutaways. |
| `music` | A music bed that ducks under the voice. Only use music you have the rights to. |

## Your look

Put a `brand.json` in the job folder, its parent folder, or the folder you run `clip` from. Anything you leave out uses these defaults:

```json
{
  "font": "Arial Black",
  "fontsDir": "/System/Library/Fonts/Supplemental",
  "primary": "#FFFFFF",
  "outline": "#000000",
  "highlight": "#FFD60A",
  "loudness": -14,
  "captions": "pop",
  "hook": "text"
}
```

`captions` can be `pop` (word by word) or `none` (whole lines at once). `hook` can be `text` (big outlined words that pop in) or `box` (words on a filled highlight box). On Linux, point `fontsDir` at a folder that contains your font.

## Good to know

- Word timings come from whisper.cpp's DTW alignment and are accurate to about 0.1 s.
- A transcript is cached next to its video as `<video>.words.json`, so a second render of the same source is fast.
- `CLIPPER_JOBS` changes where `new-job` makes folders. `CLIPPER_MODELS` changes where models are looked for.

## Licence

MIT. See [LICENSE](LICENSE).
