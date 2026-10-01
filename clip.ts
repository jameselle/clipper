// clipper: turn a long video into short vertical clips, automatically. Run from this folder:
//
//   npm run clip -- transcribe <video> [--model small.en]   words with timestamps (cached next to the video)
//   npm run clip -- render <spec.json>                        render every format in the spec
//   npm run clip -- check <video> [--hook "text"]             QA: format, loudness, black/silence, contact sheet, words kept
//   npm run clip -- new-job <title>                           make a job folder under ./jobs and print its path
//   npm run clip -- from-teleprompter <script-folder> [title] new job whose master.mp4 joins the teleprompter's kept takes
//   npm run review [-- <folder>] [--port 8794]               the review page: watch your cuts, press N where something looks wrong
//   npm run clip -- notes <video|folder> [--all]              the review notes (open ones unless --all), with frame stills
//   npm run clip -- notes-fixed <video> <note-id> "<what changed>"  mark a note fixed after re-rendering
//
// Needs FFmpeg (with libass) and whisper.cpp's whisper-cli. Nothing is ever posted anywhere.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_BRAND, mergeBrand, type Brand } from "./lib/brand";
import { FORMATS, validateSpec, type EditSpec, type Format } from "./lib/spec";
import { formatNotes, listVideos, readNotes, serveReview, updateNote } from "./lib/review";
import { concatArgs, readTakes } from "./lib/teleprompter";
import { buildAss, captionLines, cutawayWindows, keepPieces, outputDuration, outputWords, panCrop, reconcileWords, reframeFilter, type Word } from "./lib/timeline";

const HOME = os.homedir();
/** whisper.cpp's CLI: $CLIPPER_WHISPER, else whisper-cli on the PATH (brew install whisper-cpp), else a HyperFrames build. */
function findWhisper(): string | null {
  if (process.env.CLIPPER_WHISPER) return process.env.CLIPPER_WHISPER;
  const onPath = spawnSync("sh", ["-c", "command -v whisper-cli"], { encoding: "utf8" }).stdout.trim();
  if (onPath) return onPath;
  const hf = path.join(HOME, ".cache", "hyperframes", "whisper", "whisper.cpp", "build", "bin", "whisper-cli");
  return fs.existsSync(hf) ? hf : null;
}
/** Where ggml models are looked for; `npm run models` downloads into the first. */
const MODEL_DIRS = [process.env.CLIPPER_MODELS, path.join(HOME, ".cache", "clipper", "models"), path.join(HOME, ".cache", "hyperframes", "whisper", "models")].filter(Boolean) as string[];

function die(msg: string): never {
  console.error(`clip: ${msg}`);
  process.exit(1);
}

function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !opts.quiet) die(`${path.basename(cmd)} failed:\n${(r.stderr || r.stdout).trim().split("\n").slice(-15).join("\n")}`);
  return r;
}

type Probe = { duration: number; w: number; h: number; fps: number; hasAudio: boolean };

function probe(file: string): Probe {
  if (!fs.existsSync(file)) die(`no such file: ${file}`);
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(r.stdout) as { streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[]; format: { duration: string } };
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) die(`${file} has no video stream`);
  const [n, d] = (v.avg_frame_rate ?? "30/1").split("/").map(Number);
  return { duration: Number(j.format.duration), w: v.width!, h: v.height!, fps: d ? n / d : 30, hasAudio: j.streams.some((s) => s.codec_type === "audio") };
}

// ---------------------------------------------------------------- transcribe

/** Word-level transcript via whisper.cpp. Cached as <video>.words.json next to the video (or in --out). */
function transcribe(video: string, model = "small.en", outDir?: string): Word[] {
  const cache = path.join(outDir ?? path.dirname(video), `${path.basename(video)}.words.json`);
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs > fs.statSync(video).mtimeMs) return JSON.parse(fs.readFileSync(cache, "utf8")) as Word[];
  const WHISPER = findWhisper() ?? die("whisper-cli not found: install whisper.cpp (brew install whisper-cpp) or set CLIPPER_WHISPER");
  const modelFile = MODEL_DIRS.map((d) => path.join(d, `ggml-${model}.bin`)).find((f) => fs.existsSync(f));
  if (!modelFile) die(`whisper model ggml-${model}.bin not found in ${MODEL_DIRS.join(" or ")}: run npm run models`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clip-"));
  const wav = path.join(tmp, "audio.wav");
  // Lead in with 0.5 s of silence: whisper drops a first word that starts at 0.0 s,
  // and in a clip that first word is the hook. Offsets are shifted back below.
  const LEAD = 0.5;
  run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-af", `adelay=${LEAD * 1000}:all=1`, "-c:a", "pcm_s16le", wav]);
  // DTW token timestamps are far more accurate than segment offsets (0.1 s vs ~1 s of drift on
  // an 81 s test), but whisper.cpp silently skips DTW while flash attention is on: hence -nfa.
  run(WHISPER, ["-m", modelFile, "-f", wav, "-ml", "1", "-sow", "-ojf", "-dtw", model, "-nfa", "-of", path.join(tmp, "out"), "-np"]);
  const j = JSON.parse(fs.readFileSync(path.join(tmp, "out.json"), "utf8")) as {
    transcription: { offsets: { from: number; to: number }; tokens?: { text: string; t_dtw?: number; offsets: { from: number; to: number } }[] }[];
  };
  const words: Word[] = [];
  for (const seg of j.transcription) {
    for (const t of seg.tokens ?? []) {
      const txt = t.text;
      if (!txt.trim() || txt.startsWith("[_") || txt.startsWith("<|") || /^\[.*\]$/.test(txt.trim())) continue;
      const at = (t.t_dtw ?? -1) >= 0 ? t.t_dtw! / 100 : t.offsets.from / 1000;
      const end = t.offsets.to / 1000;
      if (txt.startsWith(" ") || !words.length) words.push({ w: txt.trim(), start: Math.max(0, at - LEAD), end: Math.max(0, end - LEAD) });
      else {
        words[words.length - 1].w += txt; // punctuation and word pieces join the word before
        words[words.length - 1].end = Math.max(words[words.length - 1].end, end - LEAD);
      }
    }
  }
  // A word ends no later than the next one starts (segment offsets overshoot into pauses).
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1]?.start ?? Infinity;
    words[i].end = Math.round(Math.max(words[i].start + 0.05, Math.min(words[i].end, next, words[i].start + 1.2)) * 1000) / 1000;
    words[i].start = Math.round(words[i].start * 1000) / 1000;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(words));
  return words;
}

// ---------------------------------------------------------------- silences

/** Silent stretches in a file's audio, from FFmpeg's silencedetect. */
function silences(file: string, noiseDb = -35, minDur = 0.3): [number, number][] {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=n=${noiseDb}dB:d=${minDur}`, "-vn", "-f", "null", "-"], { quiet: true });
  const starts = [...r.stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? s] as [number, number]).filter(([s, e]) => e > s);
}

// ---------------------------------------------------------------- render

/** brand.json from the job folder, its parent, or the folder you run clip from; else the defaults. */
function loadBrand(jobDir: string): Brand {
  const file = [path.join(jobDir, "brand.json"), path.join(path.dirname(jobDir), "brand.json"), path.join(process.cwd(), "brand.json")].find((f) => fs.existsSync(f));
  if (!file) return DEFAULT_BRAND;
  try {
    return mergeBrand(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Brand>);
  } catch (e) {
    die(`${file}: ${(e as Error).message}`);
  }
}

function renderFormat(
  spec: EditSpec,
  fmt: Format,
  jobDir: string,
  words: Record<string, Word[]>,
  sil: Record<string, [number, number][]>,
  brand: Brand,
): string {
  const dims = FORMATS[fmt];
  const pieces = keepPieces(spec, words, sil);
  const ids = Object.keys(spec.sources);
  const probes = Object.fromEntries(ids.map((id) => [id, probe(spec.sources[id])]));
  for (const p of pieces) {
    const d = probes[p.source].duration;
    if (p.end > d + 0.05) die(`segment ${p.source} ${p.start}-${p.end}s runs past the end of the source (${d.toFixed(2)}s)`);
  }

  const inputs: string[] = [];
  ids.forEach((id) => inputs.push("-i", spec.sources[id]));
  let musicIdx = -1;
  if (spec.music) {
    musicIdx = ids.length;
    inputs.push("-stream_loop", "-1", "-i", spec.music.file);
  }

  const f: string[] = [];
  pieces.forEach((p, i) => {
    const k = ids.indexOf(p.source);
    const pr = probes[p.source];
    const vf = reframeFilter(pr, fmt, dims, spec.reframe ?? "crop", spec.focusX ?? 0.5, String(i));
    f.push(`[${k}:v]trim=start=${p.start}:end=${p.end},setpts=PTS-STARTPTS,fps=30,${vf},setsar=1[v${i}]`);
    if (pr.hasAudio) f.push(`[${k}:a]atrim=start=${p.start}:end=${p.end},asetpts=PTS-STARTPTS,aresample=48000[a${i}]`);
    else f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${(p.end - p.start).toFixed(3)}[a${i}]`);
  });
  f.push(`${pieces.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${pieces.length}:v=1:a=1[vcat][acat]`);

  const vOut = "vcat";

  // Music ducks under the voice, then everything is levelled for social.
  const dur = outputDuration(pieces);
  let aOut = "acat";
  if (musicIdx >= 0) {
    const vol = spec.music?.volume ?? 0.15;
    f.push(`[${musicIdx}:a]atrim=duration=${dur},volume=${vol},aresample=48000[mus]`);
    f.push(`[acat]asplit=2[voice][key]`);
    f.push(`[mus][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]`);
    f.push(`[voice][duck]amix=inputs=2:duration=first:dropout_transition=0[amix]`);
    aOut = "amix";
  }
  f.push(`[${aOut}]loudnorm=I=${spec.loudness ?? brand.loudness}:TP=-1.5:LRA=11[aout]`);

  const out = path.join(jobDir, `${slugify(spec.title)}-${fmt}.mp4`);
  const wantText = spec.captions !== false || Boolean(spec.hook) || Boolean(spec.cutaways?.length);
  // Pass 1: the cut itself. When text follows, keep it near-lossless for the second encode.
  const cut = wantText ? path.join(jobDir, `.${fmt}.cut.mp4`) : out;
  run("ffmpeg", [
    "-y", "-v", "error", ...inputs,
    "-filter_complex", f.join(";"),
    "-map", `[${vOut}]`, "-map", "[aout]",
    "-t", String(dur),
    "-c:v", "libx264", "-preset", wantText ? "fast" : "medium", "-crf", wantText ? "12" : "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
    cut,
  ]);
  if (!wantText) return out;

  // Pass 2: captions come from transcribing the cut itself, so they match exactly what's
  // heard. Mapping source timestamps across cuts dropped words that landed in a removed pause.
  // Cutaways are placed by the same words, so they need the transcript even without captions.
  const cutaways = spec.cutaways ?? [];
  const heard =
    spec.captions === false && !cutaways.length
      ? []
      : reconcileWords(transcribe(cut, "small.en", fs.mkdtempSync(path.join(os.tmpdir(), "clip-cap-"))), outputWords(pieces, words).map((w) => w.w));
  const lines = captionLines(heard);
  let windows: { start: number; end: number }[] = [];
  try {
    windows = cutawayWindows(lines, cutaways);
  } catch (e) {
    die(`${(e as Error).message}\n  what the cut says: ${heard.map((w) => w.w).join(" ")}`);
  }
  const vertical = dims.h > dims.w;
  const ass = path.join(jobDir, `${fmt}.ass`);
  fs.writeFileSync(
    ass,
    buildAss(
      dims,
      spec.captions === false ? [] : lines,
      { font: brand.font, primary: brand.primary, outline: brand.outline, highlight: brand.highlight, animate: brand.captions, hook: brand.hook },
      spec.hook,
      { seams: vertical ? windows : [] },
    ),
  );
  const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const subs = `subtitles='${esc(ass)}':fontsdir='${esc(brand.fontsDir)}'`;
  const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out];
  if (!windows.length) {
    run("ffmpeg", ["-y", "-v", "error", "-i", cut, "-vf", subs, ...enc]);
  } else {
    // Vertical: the footage fills the top half and the face moves to the bottom half. Other shapes: full frame.
    const panel = vertical ? { w: dims.w, h: Math.round(dims.h / 2) } : { w: dims.w, h: dims.h };
    const on = windows.map((w) => `between(t,${w.start},${w.end})`).join("+");
    const ins: string[] = ["-i", cut];
    const g: string[] = [];
    let last = "0:v";
    if (vertical) {
      const centre = (spec.faceY ?? 0.5) * dims.h;
      const y0 = Math.round(Math.min(Math.max(centre - panel.h / 2, 0), dims.h - panel.h));
      g.push(`[0:v]split[base][f]`, `[f]crop=${dims.w}:${panel.h}:0:${y0}[face]`, `[base][face]overlay=0:${panel.h}:enable='${on}'[split]`);
      last = "split";
    }
    cutaways.forEach((c, i) => {
      if (!fs.existsSync(c.file)) die(`cutaway ${i + 1}: no such file ${c.file}`);
      const { start, end } = windows[i];
      const d = Number((end - start).toFixed(3));
      const image = /\.(png|jpe?g|webp)$/i.test(c.file);
      if (image) ins.push("-loop", "1", "-framerate", "30", "-t", String(d), "-i", c.file);
      else ins.push("-i", c.file);
      const cover = `scale=${panel.w}:${panel.h}:force_original_aspect_ratio=increase,crop=${panel.w}:${panel.h}`;
      const fit = image && c.pan ? `${panCrop(c.pan, panel, d)},scale=${panel.w}:${panel.h}:flags=lanczos` : cover;
      const shot = image ? fit : `trim=duration=${d},setpts=PTS-STARTPTS,fps=30,${fit},tpad=stop_mode=clone:stop_duration=${d}`;
      g.push(`[${i + 1}:v]${shot},setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${start}/TB[c${i}]`);
      g.push(`[${last}][c${i}]overlay=0:0:enable='between(t,${start},${end})'[o${i}]`);
      last = `o${i}`;
    });
    if (vertical) {
      g.push(`[${last}]drawbox=x=0:y=${panel.h - 3}:w=iw:h=6:color=0x0b0c0e:t=fill:enable='${on}'[seam]`);
      last = "seam";
    }
    g.push(`[${last}]${subs}[vout]`);
    run("ffmpeg", ["-y", "-v", "error", ...ins, "-filter_complex", g.join(";"), "-map", "[vout]", "-map", "0:a", ...enc]);
  }
  fs.rmSync(cut, { force: true });
  return out;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";

function cmdRender(specFile: string | undefined) {
  if (!specFile) die("usage: render <spec.json>");
  const res = validateSpec(JSON.parse(fs.readFileSync(specFile, "utf8")));
  if (!res.ok) die(`spec is invalid:\n  - ${res.errors.join("\n  - ")}`);
  const spec = res.spec;
  const jobDir = path.dirname(path.resolve(specFile));
  const brand = loadBrand(jobDir);
  const words: Record<string, Word[]> = {};
  for (const [id, file] of Object.entries(spec.sources)) {
    words[id] = spec.captions === false && !spec.tightenPauses ? [] : transcribe(file, "small.en", jobDir);
  }
  // Transcripts often put the last word a little past the file's end: trim small overruns,
  // refuse anything that starts beyond the source.
  spec.segments = spec.segments.map((g) => {
    const d = probe(spec.sources[g.source]).duration;
    if (g.start >= d) die(`segment ${g.source} starts at ${g.start}s, past the end of the source (${d.toFixed(2)}s)`);
    if (g.end > d + 1) die(`segment ${g.source} ends at ${g.end}s, well past the end of the source (${d.toFixed(2)}s)`);
    return { ...g, end: Math.min(g.end, Math.floor(d * 1000) / 1000) };
  });
  const sil: Record<string, [number, number][]> = {};
  if (spec.tightenPauses) for (const [id, file] of Object.entries(spec.sources)) if (probe(file).hasAudio) sil[id] = silences(file);
  const outs = spec.formats.map((fmt) => renderFormat(spec, fmt, jobDir, words, sil, brand));
  for (const o of outs) console.log(`rendered ${o}`);
}

// ---------------------------------------------------------------- check (QA)

type Check = { name: string; ok: boolean; detail: string };

function cmdCheck(video: string | undefined, hook?: string) {
  if (!video) die("usage: check <video> [--hook \"text\"]");
  const checks: Check[] = [];
  const p = probe(video);
  const shape = Object.entries(FORMATS).find(([, d]) => d.w === p.w && d.h === p.h)?.[0];
  checks.push({ name: "format", ok: Boolean(shape), detail: `${p.w}x${p.h}${shape ? ` (${shape})` : " — not a known format"}` });
  checks.push({ name: "duration", ok: p.duration >= 3 && p.duration <= 600, detail: `${p.duration.toFixed(2)} s` });
  checks.push({ name: "audio", ok: p.hasAudio, detail: p.hasAudio ? "present" : "missing" });
  // A rotation tag on a render means players turn it again: upright frames come out sideways.
  const rot = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream_side_data=rotation", "-of", "csv=p=0", video], { quiet: true }).stdout.trim();
  const turned = rot !== "" && Number(rot) % 360 !== 0;
  checks.push({ name: "no rotation tag", ok: !turned, detail: turned ? `tagged ${rot}°: players will turn it sideways` : "none" });

  const loud = run("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-af", "ebur128", "-f", "null", "-"], { quiet: true });
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(loud.stderr.split("Summary:").pop() ?? "")?.[1]);
  checks.push({ name: "loudness", ok: lufs >= -17 && lufs <= -11, detail: `${Number.isFinite(lufs) ? lufs : "?"} LUFS (target -14)` });

  const bd = run("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vf", "blackdetect=d=0.5:pix_th=0.1", "-an", "-f", "null", "-"], { quiet: true });
  const blacks = [...bd.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${m[1]}–${m[2]}s`);
  checks.push({ name: "no black frames", ok: blacks.length === 0, detail: blacks.length ? blacks.join(", ") : "none" });

  const sd = run("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-af", "silencedetect=n=-45dB:d=2", "-vn", "-f", "null", "-"], { quiet: true });
  const deadAir = [...sd.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => `${Number(m[1]).toFixed(1)}s`);
  checks.push({ name: "no dead air (>2 s)", ok: deadAir.length === 0, detail: deadAir.length ? `from ${deadAir.join(", ")}` : "none" });

  // Contact sheet: 9 frames evenly spaced, for a visual check by whoever reviews (Claude).
  const sheet = video.replace(/\.mp4$/, "") + ".sheet.png";
  const every = Math.max(p.duration / 9, 0.1);
  run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=1/${every.toFixed(3)},scale=360:-2,tile=3x3:padding=6:color=black`, "-frames:v", "1", sheet]);
  checks.push({ name: "contact sheet", ok: fs.existsSync(sheet), detail: sheet });

  // The hook must actually be said or shown in the first seconds: re-read the opening.
  const opening = transcribe(video, "small.en", fs.mkdtempSync(path.join(os.tmpdir(), "clip-qa-")))
    .filter((w) => w.start < 4)
    .map((w) => w.w)
    .join(" ");
  checks.push({ name: "opening words", ok: opening.length > 0, detail: opening || "(nothing said in the first 4 s)" });
  if (hook) checks.push({ name: "hook on screen", ok: true, detail: `burned in: "${hook}" (verify on the contact sheet)` });

  // Nothing lost or clipped mid-word: the render's words should match what the edit kept.
  const specFile = path.join(path.dirname(video), "spec.json");
  if (fs.existsSync(specFile)) {
    const res = validateSpec(JSON.parse(fs.readFileSync(specFile, "utf8")));
    if (res.ok) {
      const src: Record<string, Word[]> = {};
      for (const [id, file] of Object.entries(res.spec.sources)) src[id] = transcribe(file, "small.en", path.dirname(video));
      const sil: Record<string, [number, number][]> = {};
      if (res.spec.tightenPauses) for (const [id, file] of Object.entries(res.spec.sources)) if (probe(file).hasAudio) sil[id] = silences(file);
      // Everything said inside the chosen segments must survive: pause-cutting may never drop a word.
      const expected = res.spec.segments
        .flatMap((g) => (src[g.source] ?? []).filter((w) => (w.start + w.end) / 2 >= g.start && (w.start + w.end) / 2 <= g.end))
        .map((w) => norm(w.w))
        .filter(Boolean);
      const got = transcribe(video, "small.en", fs.mkdtempSync(path.join(os.tmpdir(), "clip-qa-"))).map((w) => norm(w.w)).filter(Boolean);
      const score = expected.length ? lcs(expected, got) / expected.length : 1;
      const missing = expected.filter((w) => !got.includes(w));
      checks.push({
        name: "words kept",
        ok: score >= 0.9,
        detail: `${Math.round(score * 100)}% of ${expected.length} expected words heard in the render${missing.length ? ` (missing: ${missing.slice(0, 8).join(" ")})` : ""}`,
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  const result = { video, ok, checkedAt: new Date().toISOString(), checks };
  fs.writeFileSync(path.join(path.dirname(video), "qa.json"), JSON.stringify(result, null, 2));
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(20)} ${c.detail}`);
  console.log(ok ? "PASS" : "FAIL");
  if (!ok) process.exit(2);
}

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "Ninety-two" and "92" are the same word to a viewer: compare numbers as digits. */
function numberWord(w: string): string | null {
  const parts = w.toLowerCase().replace(/[^a-z-]/g, "").split("-").filter(Boolean);
  if (!parts.length) return null;
  let total = 0;
  for (const p of parts) {
    if (UNITS.includes(p)) total += UNITS.indexOf(p);
    else if (TENS.includes(p)) total += TENS.indexOf(p) * 10;
    else if (p === "hundred") total = (total || 1) * 100;
    else return null;
  }
  return String(total);
}

const norm = (w: string) => numberWord(w) ?? w.toLowerCase().replace(/[^a-z0-9']/g, "");

/** Longest common subsequence length: order-aware word overlap. */
function lcs(a: string[], b: string[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function newJob(title: string | undefined): string {
  if (!title) die("usage: new-job <title>");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const dir = path.join(process.env.CLIPPER_JOBS ?? path.join(process.cwd(), "jobs"), `${stamp}-${slugify(title)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cmdNewJob(title: string | undefined) {
  console.log(newJob(title));
}

/** A job whose master.mp4 is the teleprompter's kept takes joined in script order. The takes stay
 *  where the teleprompter saved them; sections.json records where each one starts in the master. */
function cmdFromTeleprompter(folder: string | undefined, title: string | undefined) {
  if (!folder) die("usage: from-teleprompter <script-folder> [title]");
  const dir = path.resolve(folder.replace(/^~(?=\/)/, HOME));
  if (!fs.existsSync(dir)) die(`no such folder: ${dir}`);
  const takes = readTakes(dir);
  for (const w of takes.warnings) console.error(`warning: ${w}`);
  if (takes.problems.length) die(`can't build the master:\n  ${takes.problems.join("\n  ")}`);
  if (!takes.sections.length) die(`no kept takes in ${dir}`);
  const job = newJob(title || path.basename(dir).replace(/^\d+-/, ""));
  const master = path.join(job, "master.mp4");
  run("ffmpeg", concatArgs(takes.sections.map((s) => s.file), master));
  let at = 0;
  const sections = takes.sections.map((s) => {
    const d = probe(s.file).duration;
    const row = { section: s.section, take: s.take, source: s.file, start: Number(at.toFixed(3)), duration: Number(d.toFixed(3)) };
    at += d;
    return row;
  });
  fs.writeFileSync(path.join(job, "sections.json"), JSON.stringify({ from: dir, sections }, null, 2) + "\n");
  const m = probe(master);
  console.log(JSON.stringify({ job, master, sections: sections.length, duration: Number(m.duration.toFixed(2)), size: `${m.w}x${m.h}`, warnings: takes.warnings }, null, 2));
}

// ---------------------------------------------------------------- main

const [cmd, ...args] = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

switch (cmd) {
  case "transcribe": {
    const words = transcribe(pos[0] ?? die("usage: transcribe <video>"), opt("--model") ?? "small.en", opt("--out"));
    console.log(JSON.stringify({ words: words.length, duration: words.at(-1)?.end ?? 0, text: words.map((w) => w.w).join(" ") }, null, 2));
    break;
  }
  case "render":
    cmdRender(pos[0]);
    break;
  case "check":
    cmdCheck(pos[0], opt("--hook"));
    break;
  case "new-job":
    cmdNewJob(pos.join(" "));
    break;
  case "from-teleprompter":
    cmdFromTeleprompter(pos[0], pos.slice(1).join(" "));
    break;
  case "review": {
    const root = path.resolve(pos[0] ?? process.env.CLIPPER_JOBS ?? path.join(process.cwd(), "jobs"));
    if (!fs.existsSync(root)) die(`no folder ${root}: make a job first (npm run clip -- new-job <title>), or pass a folder of videos`);
    const port = Number(opt("--port") ?? 8794);
    serveReview({ root, port, title: "Clipper review" }).on("listening", () =>
      console.log(`review page: http://127.0.0.1:${port}  (videos under ${root}; Ctrl-C to stop)`));
    break;
  }
  case "notes": {
    const target = path.resolve(pos[0] ?? die("usage: notes <video|folder> [--all]"));
    const all = args.includes("--all");
    if (fs.statSync(target).isDirectory()) {
      const withNotes = listVideos(target).filter((v) => (all ? v.total : v.open));
      if (!withNotes.length) console.log(`no ${all ? "" : "open "}review notes under ${target}`);
      for (const v of withNotes) console.log(formatNotes(path.join(target, v.v), readNotes(path.join(target, v.v)), all) + "\n");
    } else console.log(formatNotes(target, readNotes(target), all));
    break;
  }
  case "notes-fixed": {
    const [video, id, ...fix] = pos;
    if (!video || !id) die('usage: notes-fixed <video> <note-id> "<what changed>"');
    const n = updateNote(path.resolve(video), id, { status: "fixed", fix: fix.join(" ") || undefined });
    console.log(`fixed [${n.id}] ${n.text}`);
    break;
  }
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("//"))).join("\n").replace(/^\/\/ ?/gm, ""));
    if (cmd && cmd !== "help") process.exit(1);
}
