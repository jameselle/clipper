// Review notes on rendered videos: watch a cut, pause where something looks wrong, write what you see.
// Each note keeps the moment (seconds), the caption on screen then, and a still of the frame, so whoever
// fixes the edit sees exactly what the reviewer saw. Notes live next to the video:
//
//   <video>.review.json          the notes
//   <video>.review/<id>.jpg      the frame each note was written on
//
// `serveReview` is the local page (127.0.0.1 only) that writes them. Only node's standard library is used,
// so this file is shared as-is between HQ (lib/studio/review.ts) and the clipper (lib/review.ts).

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { REVIEW_PAGE } from "./review-page";

export type ReviewNote = {
  id: string;
  /** Seconds into the video: where the note starts. */
  t: number;
  /** Where it ends, for a note about a span ("from here to here"). Absent for a single moment. */
  end?: number;
  text: string;
  status: "open" | "fixed";
  createdAt: string;
  /** The caption on screen at `t` (for a span: every caption shown across it, joined with " / "). */
  caption?: string;
  /** File name of the frame still at `t`, inside `<video>.review/`. */
  frame?: string;
  /** For a span: stills from its middle and its end, inside `<video>.review/`. */
  frames?: string[];
  /** The video's modified time when the note was written: a later render makes it an "earlier cut" note. */
  render: string;
  fixedAt?: string;
  /** What was changed, written by whoever fixed it. */
  fix?: string;
};

export type ReviewVideo = { v: string; name: string; folder: string; size: number; mtime: string; open: number; total: number };

const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** Every .mp4 under `root` (newest first), as paths relative to it. Hidden files and `.review` folders are skipped. */
export function listVideos(root: string, maxDepth = 6): ReviewVideo[] {
  const out: ReviewVideo[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name) && !e.name.endsWith(".review")) walk(full, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".mp4")) {
        const st = fs.statSync(full);
        const notes = readNotes(full);
        const rel = path.relative(root, full).split(path.sep).join("/");
        out.push({
          v: rel,
          name: e.name,
          folder: path.dirname(rel),
          size: st.size,
          mtime: st.mtime.toISOString(),
          open: notes.filter((n) => n.status === "open").length,
          total: notes.length,
        });
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** A video path from the page, made absolute. Refuses anything outside `root`, not an .mp4, or missing. */
export function resolveVideo(root: string, rel: string): string {
  if (!rel || rel.includes("\0")) throw new Error("no video given");
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("that video is outside the review folder");
  if (!full.toLowerCase().endsWith(".mp4")) throw new Error("only .mp4 videos can be reviewed");
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("no such video");
  return full;
}

export const notesFile = (video: string) => video.replace(/\.mp4$/i, ".review.json");
export const framesDir = (video: string) => video.replace(/\.mp4$/i, ".review");
const renderStamp = (video: string) => fs.statSync(video).mtime.toISOString();

/** A span to delete from the video, on the timeline of the render being watched. */
export type ReviewCut = { id: string; t: number; end: number; createdAt: string };
type ReviewDoc = { video: string; notes: ReviewNote[]; cuts?: ReviewCut[]; speed?: number };

function readDoc(video: string): ReviewDoc {
  try {
    const raw = JSON.parse(fs.readFileSync(notesFile(video), "utf8"));
    return {
      video: path.basename(video),
      notes: Array.isArray(raw?.notes) ? raw.notes : [],
      cuts: Array.isArray(raw?.cuts) ? raw.cuts : [],
      ...(typeof raw?.speed === "number" ? { speed: raw.speed } : {}),
    };
  } catch {
    return { video: path.basename(video), notes: [], cuts: [] };
  }
}

function writeDoc(video: string, doc: ReviewDoc) {
  const out: ReviewDoc = { video: path.basename(video), notes: [...doc.notes].sort((a, b) => a.t - b.t) };
  if (doc.cuts?.length) out.cuts = [...doc.cuts].sort((a, b) => a.t - b.t);
  if (doc.speed !== undefined) out.speed = doc.speed;
  if (!out.notes.length && !out.cuts && out.speed === undefined) return void fs.rmSync(notesFile(video), { force: true }); // nothing left: no empty file
  const tmp = notesFile(video) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
  fs.renameSync(tmp, notesFile(video));
}

export function readNotes(video: string): ReviewNote[] {
  return readDoc(video).notes;
}

function writeNotes(video: string, notes: ReviewNote[]) {
  writeDoc(video, { ...readDoc(video), notes });
}

/** The edits waiting to be applied: spans to delete, and the speed to post at (absent: unchanged). */
export function readEdits(video: string): { cuts: ReviewCut[]; speed?: number } {
  const d = readDoc(video);
  return { cuts: d.cuts ?? [], ...(d.speed !== undefined ? { speed: d.speed } : {}) };
}

export function addCut(video: string, input: { t: number; end: number }): ReviewCut {
  const t = r2(Number(input.t));
  const end = r2(Number(input.end));
  if (!(Number.isFinite(t) && t >= 0 && Number.isFinite(end))) throw new Error("a cut needs a start and an end");
  if (end - t < 0.05) throw new Error("a cut must be longer than 0.05 s");
  const cut: ReviewCut = { id: newId(), t, end, createdAt: new Date().toISOString() };
  const doc = readDoc(video);
  writeDoc(video, { ...doc, cuts: [...(doc.cuts ?? []), cut] });
  return cut;
}

export function deleteCut(video: string, id: string) {
  const doc = readDoc(video);
  if (!(doc.cuts ?? []).some((c) => c.id === id)) throw new Error("no such cut");
  writeDoc(video, { ...doc, cuts: (doc.cuts ?? []).filter((c) => c.id !== id) });
}

/** The speed to post at, from 0.5 to 3 (null: leave the render's speed as it is). */
export function setExportSpeed(video: string, speed: number | null) {
  const doc = readDoc(video);
  if (speed === null) delete doc.speed;
  else {
    if (!(typeof speed === "number" && speed >= 0.5 && speed <= 3)) throw new Error("speed: 0.5 to 3");
    doc.speed = Math.round(speed * 100) / 100;
  }
  writeDoc(video, doc);
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** `end`: for a note about a span. `frameJpeg`: the frame at `t` as base64 JPEG (a data: URL prefix is fine). */
export function addNote(video: string, input: { t: number; end?: number; text: string; frameJpeg?: string }): ReviewNote {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("the note is empty");
  if (!(Number.isFinite(input.t) && input.t >= 0)) throw new Error("the time is missing");
  const note: ReviewNote = {
    id: newId(),
    t: r2(input.t),
    text,
    status: "open",
    createdAt: new Date().toISOString(),
    render: renderStamp(video),
  };
  if (input.end !== undefined && input.end !== null) {
    if (!(Number.isFinite(input.end) && r2(input.end) > note.t)) throw new Error("a span must end after it starts");
    note.end = r2(input.end);
  }
  const caption = note.end === undefined ? captionAt(video, note.t) : captionsAcross(video, note.t, note.end);
  if (caption) note.caption = caption;
  if (input.frameJpeg) {
    const data = Buffer.from(input.frameJpeg.replace(/^data:image\/jpeg;base64,/, ""), "base64");
    if (data.length > 0 && data.length < 8_000_000 && data[0] === 0xff && data[1] === 0xd8) {
      fs.mkdirSync(framesDir(video), { recursive: true });
      note.frame = `${note.id}.jpg`;
      fs.writeFileSync(path.join(framesDir(video), note.frame), data);
    }
  }
  writeNotes(video, [...readNotes(video), note]);
  return note;
}

export function updateNote(video: string, id: string, patch: { status?: "open" | "fixed"; text?: string; fix?: string }): ReviewNote {
  const notes = readNotes(video);
  const note = notes.find((n) => n.id === id);
  if (!note) throw new Error("no such note");
  if (patch.text !== undefined) {
    const text = String(patch.text).trim();
    if (!text) throw new Error("the note is empty");
    note.text = text;
  }
  if (patch.fix !== undefined) note.fix = String(patch.fix).trim() || undefined;
  if (patch.status === "fixed" && note.status !== "fixed") {
    note.status = "fixed";
    note.fixedAt = new Date().toISOString();
  } else if (patch.status === "open") {
    note.status = "open";
    delete note.fixedAt;
  }
  writeNotes(video, notes);
  return note;
}

export function deleteNote(video: string, id: string) {
  const notes = readNotes(video);
  const note = notes.find((n) => n.id === id);
  if (!note) throw new Error("no such note");
  for (const f of [note.frame, ...(note.frames ?? [])]) if (f) fs.rmSync(path.join(framesDir(video), path.basename(f)), { force: true });
  writeNotes(video, notes.filter((n) => n.id !== id)); // the last of everything: no empty file is left
  try {
    fs.rmdirSync(framesDir(video)); // only succeeds when no frames are left
  } catch {
    // frames remain, or there never was a folder
  }
}

/** Notes made on an earlier render of this file (it has been re-rendered since). */
export function isEarlierCut(video: string, note: ReviewNote): boolean {
  return note.render !== renderStamp(video);
}

/** The caption file a render wrote beside the video: `<title>-<format>.mp4` → `<format>.ass`. */
export function captionFileFor(video: string): string | null {
  const m = path.basename(video).match(/-(vertical|landscape|square)\.mp4$/i);
  if (!m) return null;
  const ass = path.join(path.dirname(video), `${m[1].toLowerCase()}.ass`);
  return fs.existsSync(ass) ? ass : null;
}

const assTime = (s: string) => {
  const [h, m, sec] = s.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
};

/** The caption (or hook) on screen at `t` seconds, from an .ass file's text. */
export function captionInAss(ass: string, t: number): string | undefined {
  let hook: string | undefined;
  for (const line of ass.split(/\r?\n/)) {
    const m = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),(Caption|Hook),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/);
    if (!m) continue;
    const [, a, b, style, text] = m;
    if (t < assTime(a) || t >= assTime(b)) continue;
    const plain = text.replace(/\{[^}]*\}/g, "").replace(/\\N/g, " ").replace(/\s+/g, " ").trim();
    if (style === "Caption") return plain;
    hook = plain;
  }
  return hook;
}

export function captionAt(video: string, t: number): string | undefined {
  const ass = captionFileFor(video);
  return ass ? captionInAss(fs.readFileSync(ass, "utf8"), t) : undefined;
}

/** Every distinct caption shown between `a` and `b` seconds, in order, joined with " / ". */
export function captionsAcross(video: string, a: number, b: number): string | undefined {
  const file = captionFileFor(video);
  if (!file) return undefined;
  const ass = fs.readFileSync(file, "utf8");
  const seen: string[] = [];
  for (let t = a; t <= b + 1e-9; t += 0.1) {
    const c = captionInAss(ass, Math.min(t, b));
    if (c && seen.at(-1) !== c && !(seen.at(-1) ?? "").startsWith(c)) {
      // A karaoke line grows word by word: keep the fullest version of each line.
      if (seen.length && c.startsWith(seen.at(-1)!)) seen[seen.length - 1] = c;
      else seen.push(c);
    }
  }
  return seen.length ? seen.join(" / ") : undefined;
}

/** For a span note: stills from its middle and its end (FFmpeg), saved beside its first frame. */
export async function addSpanFrames(video: string, id: string): Promise<ReviewNote | null> {
  const ff = findTool("ffmpeg");
  const note = readNotes(video).find((n) => n.id === id);
  if (!ff || !note || note.end === undefined) return note ?? null;
  fs.mkdirSync(framesDir(video), { recursive: true });
  const frames: string[] = [];
  for (const [label, at] of [["mid", (note.t + note.end) / 2], ["end", Math.max(note.t, note.end - 0.05)]] as const) {
    const name = `${note.id}-${label}.jpg`;
    try {
      await runTool(ff, ["-y", "-v", "error", "-ss", at.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=-2:720", "-q:v", "4", path.join(framesDir(video), name)]);
      frames.push(name);
    } catch {
      // keep whatever stills we got
    }
  }
  if (!frames.length) return note;
  const notes = readNotes(video);
  const current = notes.find((n) => n.id === id);
  if (!current) return null;
  current.frames = frames;
  writeNotes(video, notes);
  return current;
}

export const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** Plain-text summary of a video's notes, for the CLI (and for Claude to work from). */
export function formatNotes(video: string, notes: ReviewNote[], all = false): string {
  const shown = all ? notes : notes.filter((n) => n.status === "open");
  if (!shown.length) return `${video}\n  no ${all ? "" : "open "}notes`;
  const lines = [video];
  for (const n of shown) {
    const flags = [n.status === "fixed" ? "fixed" : "", isEarlierCut(video, n) ? "earlier cut" : ""].filter(Boolean).join(", ");
    const when = n.end === undefined ? clock(n.t) : `${clock(n.t)}–${clock(n.end)}`;
    lines.push(`  [${n.id}] ${when}${flags ? ` (${flags})` : ""}  ${n.text}`);
    if (n.caption) lines.push(`      ${n.end === undefined ? "caption" : "captions"}: "${n.caption}"`);
    if (n.frame) lines.push(`      frame:   ${path.join(framesDir(video), n.frame)}`);
    for (const f of n.frames ?? []) lines.push(`      frame:   ${path.join(framesDir(video), f)}`);
    if (n.fix) lines.push(`      fix:     ${n.fix}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- applying cuts and speed
// A render writes `<format>.map.json` beside itself: the spec it came from, the speed it plays at, and
// which stretch of which source each part of the (1x) output is. That turns "delete 0:40-0:44 of what I'm
// watching" into new spec segments.

type MapPiece = { source: string; start: number; end: number; outStart: number };
export type RenderMap = { spec: string; speed: number; pieces: MapPiece[]; cutaways: { start: number; end: number }[] };

export function mapFileFor(video: string): string | null {
  const m = path.basename(video).match(/-(vertical|landscape|square)\.mp4$/i);
  if (!m) return null;
  const f = path.join(path.dirname(video), `${m[1].toLowerCase()}.map.json`);
  return fs.existsSync(f) ? f : null;
}

export function readMap(video: string): RenderMap | null {
  const f = mapFileFor(video);
  try {
    return f ? (JSON.parse(fs.readFileSync(f, "utf8")) as RenderMap) : null;
  } catch {
    return null;
  }
}

/** Cuts on the watched render (which plays at `map.speed`) → the segments that remain, the cutaways a cut
 *  swallows (at least half inside it), and how many seconds of the 1x edit go. */
export function planEdits(map: RenderMap, cuts: { t: number; end: number }[]) {
  const k = map.speed || 1;
  const spans = cuts.map((c) => [c.t * k, c.end * k] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const segments: { source: string; start: number; end: number }[] = [];
  let removed = 0;
  for (const p of map.pieces) {
    const a = p.outStart;
    const b = p.outStart + (p.end - p.start);
    let at = a;
    for (const [x, y] of merged) {
      if (y <= at || x >= b) continue;
      const from = Math.max(x, at);
      const to = Math.min(y, b);
      if (from - at >= 0.05) segments.push({ source: p.source, start: r3(p.start + (at - a)), end: r3(p.start + (from - a)) });
      removed += to - from;
      at = to;
    }
    if (b - at >= 0.05) segments.push({ source: p.source, start: r3(p.start + (at - a)), end: r3(p.end) });
  }
  const inside = (w: { start: number; end: number }) =>
    merged.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(y, w.end) - Math.max(x, w.start)), 0);
  const dropCutaways = map.cutaways.map((w, i) => (w.end > w.start && inside(w) >= (w.end - w.start) / 2 ? i : -1)).filter((i) => i >= 0);
  return { segments, dropCutaways, removed: r3(removed) };
}

/** Writes the cuts and speed into the spec (the old one kept as spec.before-edits-<time>.json), renders it
 *  through `render`, then clears the applied edits. If the render fails, the spec goes back as it was. */
export async function applyEdits(video: string, render: (specFile: string) => Promise<string | void>): Promise<{ removed: number; droppedCutaways: string[]; speed?: number; qa?: string }> {
  const map = readMap(video);
  if (!map || !fs.existsSync(map.spec)) throw new Error("this video has no edit map yet: render it once more with Studio, then cuts can be applied");
  const edits = readEdits(video);
  if (!edits.cuts.length && edits.speed === undefined) throw new Error("nothing to apply: mark a cut or choose an export speed first");
  const before = fs.readFileSync(map.spec, "utf8");
  const spec = JSON.parse(before);
  let removed = 0;
  const droppedCutaways: string[] = [];
  if (edits.cuts.length) {
    const plan = planEdits(map, edits.cuts);
    if (!plan.segments.length) throw new Error("those cuts would delete the whole video");
    spec.segments = plan.segments;
    removed = plan.removed;
    if (Array.isArray(spec.cutaways)) {
      for (const i of plan.dropCutaways) if (spec.cutaways[i]) droppedCutaways.push(`${path.basename(spec.cutaways[i].file)} ("${spec.cutaways[i].from}")`);
      spec.cutaways = spec.cutaways.filter((_: unknown, i: number) => !plan.dropCutaways.includes(i));
    }
  }
  // Always explicit, 1x included: a spec without a speed inherits the business's default.
  if (edits.speed !== undefined) spec.speed = edits.speed;
  const stampNow = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(path.dirname(map.spec), `spec.before-edits-${stampNow}.json`), before);
  fs.writeFileSync(map.spec, JSON.stringify(spec, null, 2) + "\n");
  let qa: string | void;
  try {
    qa = await render(map.spec);
  } catch (e) {
    fs.writeFileSync(map.spec, before);
    throw e;
  }
  const doc = readDoc(video);
  delete doc.speed;
  writeDoc(video, { ...doc, cuts: [] });
  return { removed, droppedCutaways, ...(edits.speed !== undefined ? { speed: edits.speed } : {}), ...(qa ? { qa } : {}) };
}

// ---------------------------------------------------------------- media for the page (FFmpeg)
// Posters, the filmstrip and the waveform are made by FFmpeg on first request and cached in the temp
// folder by file + modified time, so nothing is written beside the videos. Without FFmpeg the page still
// works; the timeline just shows plain tracks.

const HOME = os.homedir();
const toolCache = new Map<string, string | null>();
function findTool(name: "ffmpeg" | "ffprobe"): string | null {
  if (toolCache.has(name)) return toolCache.get(name)!;
  const env = process.env[name === "ffmpeg" ? "REVIEW_FFMPEG" : "REVIEW_FFPROBE"];
  const dirs = [...String(process.env.PATH ?? "").split(path.delimiter), path.join(HOME, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const found = env && fs.existsSync(env) ? env : dirs.map((d) => path.join(d, name)).find((f) => d(f)) ?? null;
  function d(f: string) {
    try {
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  }
  toolCache.set(name, found);
  return found;
}

let running = 0;
const waiting: (() => void)[] = [];
/** Runs a tool with at most 3 at once; resolves with stdout, rejects on a non-zero exit. */
function runTool(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
      child.on("error", (e) => done(() => reject(e)));
      child.on("close", (code) => done(() => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${path.basename(bin)} exited ${code}`)))));
    };
    const done = (f: () => void) => {
      running--;
      waiting.shift()?.();
      f();
    };
    if (running < 3) go();
    else waiting.push(go);
  });
}

const CACHE = path.join(os.tmpdir(), "review-cache");
const inflight = new Map<string, Promise<string | null>>();
/** The cached file for (video, kind), made once by `make(out)`. Null when it can't be made. */
function cached(video: string, kind: string, ext: string, make: (out: string) => Promise<unknown>): Promise<string | null> {
  const key = crypto.createHash("sha1").update(`${video}|${fs.statSync(video).mtimeMs}|${kind}`).digest("hex");
  const out = path.join(CACHE, `${key}.${ext}`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const pending = inflight.get(out);
  if (pending) return pending;
  fs.mkdirSync(CACHE, { recursive: true });
  const tmp = `${out}.part.${ext}`;
  const job = make(tmp)
    .then(() => (fs.existsSync(tmp) && fs.statSync(tmp).size > 0 ? (fs.renameSync(tmp, out), out) : null))
    .catch(() => null)
    .finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}

export type VideoMeta = { duration: number; width: number; height: number; fps: number; audio: boolean };
const metaCache = new Map<string, VideoMeta>();
export async function videoMeta(video: string): Promise<VideoMeta | null> {
  const probe = findTool("ffprobe");
  if (!probe) return null;
  const key = `${video}|${fs.statSync(video).mtimeMs}`;
  if (metaCache.has(key)) return metaCache.get(key)!;
  try {
    const j = JSON.parse(await runTool(probe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", video]));
    const v = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === "video") ?? {};
    const [n, d] = String(v.avg_frame_rate ?? "30/1").split("/").map(Number);
    const meta: VideoMeta = {
      duration: Number(j.format?.duration ?? v.duration ?? 0),
      width: Number(v.width ?? 0),
      height: Number(v.height ?? 0),
      fps: d ? Math.round((n / d) * 100) / 100 : 30,
      audio: (j.streams ?? []).some((s: { codec_type: string }) => s.codec_type === "audio"),
    };
    metaCache.set(key, meta);
    return meta;
  } catch {
    return null;
  }
}

const hw = process.platform === "darwin" ? ["-hwaccel", "videotoolbox"] : [];

/** A small still for the media list and the planner: at `at` seconds (a chosen cover), else a third of the
 *  way in (at most 1 s). */
export function poster(video: string, at?: number): Promise<string | null> {
  const ff = findTool("ffmpeg");
  if (!ff) return Promise.resolve(null);
  const t = at !== undefined && Number.isFinite(at) && at >= 0 ? Math.round(at * 10) / 10 : undefined;
  return cached(video, t === undefined ? "poster" : `poster@${t}`, "jpg", async (out) => {
    const dur = (await videoMeta(video))?.duration ?? 3;
    const seek = t === undefined ? Math.min(1, dur / 3) : Math.min(t, Math.max(0, dur - 0.05));
    await runTool(ff, ["-y", "-v", "error", "-ss", seek.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out]);
  });
}

// ---------------------------------------------------------------- the planner
// Plans: which videos go out, in what order, pinned or not, with which cover. One file per review folder.

/** `trial`: posted as an Instagram trial reel (shown to non-followers only; never on the profile grid unless it graduates). */
export type PlanItem = { v: string; pinned?: boolean; trial?: boolean; date?: string; cover?: number; title?: string };
export type Plan = { id: string; name: string; handles: { instagram?: string; tiktok?: string; youtube?: string }; items: PlanItem[] };

export const plansFile = (root: string) => path.join(root, ".review-planner.json");

export function readPlans(root: string): Plan[] {
  try {
    const raw = JSON.parse(fs.readFileSync(plansFile(root), "utf8"));
    return Array.isArray(raw?.plans) ? (raw.plans as Plan[]) : [];
  } catch {
    return [];
  }
}

const str = (x: unknown, max: number, what: string): string | undefined => {
  if (x === undefined || x === null || x === "") return undefined;
  if (typeof x !== "string") throw new Error(`${what}: text`);
  const t = x.trim();
  if (t.length > max) throw new Error(`${what}: ${max} characters at most`);
  return t || undefined;
};

/** Checks a whole set of plans, as the page sends it; throws naming the first problem. */
export function validatePlans(root: string, raw: unknown): Plan[] {
  if (!Array.isArray(raw)) throw new Error("plans: a list");
  if (raw.length > 50) throw new Error("plans: 50 at most");
  const base = path.resolve(root);
  const ids = new Set<string>();
  return raw.map((p: Record<string, unknown>, i) => {
    const where = `plan ${i + 1}`;
    const id = String(p?.id ?? "");
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(`${where}: id must be lower-case letters, digits and dashes`);
    if (ids.has(id)) throw new Error(`${where}: the id "${id}" is used twice`);
    ids.add(id);
    const name = str(p.name, 60, `${where} name`) ?? id;
    const h = (p.handles ?? {}) as Record<string, unknown>;
    const handle = (x: unknown, what: string) => {
      const t = str(x, 40, `${where} ${what} handle`);
      return t ? (t.startsWith("@") ? t : `@${t}`) : undefined;
    };
    const handles = { instagram: handle(h.instagram, "Instagram"), tiktok: handle(h.tiktok, "TikTok"), youtube: handle(h.youtube, "YouTube") };
    if (!Array.isArray(p.items)) throw new Error(`${where}: items must be a list`);
    if (p.items.length > 200) throw new Error(`${where}: 200 videos at most`);
    const items: PlanItem[] = p.items.map((it: Record<string, unknown>, j: number) => {
      const w = `${where}, video ${j + 1}`;
      const v = String(it?.v ?? "");
      const full = path.resolve(base, v);
      if (!v || v.includes("\0") || !full.startsWith(base + path.sep)) throw new Error(`${w}: outside the review folder`);
      if (!v.toLowerCase().endsWith(".mp4")) throw new Error(`${w}: only .mp4 videos`);
      const item: PlanItem = { v: path.relative(base, full).split(path.sep).join("/") };
      if (it.pinned === true) item.pinned = true;
      if (it.trial === true) {
        if (item.pinned) throw new Error(`${w}: a trial reel can't be pinned (it's not on the grid)`);
        item.trial = true;
      }
      const date = str(it.date, 10, `${w} date`);
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`${w}: date as YYYY-MM-DD`);
        item.date = date;
      }
      if (it.cover !== undefined && it.cover !== null) {
        const c = Number(it.cover);
        if (!(Number.isFinite(c) && c >= 0)) throw new Error(`${w}: cover must be a time in seconds`);
        item.cover = Math.round(c * 10) / 10;
      }
      const title = str(it.title, 100, `${w} title`);
      if (title) item.title = title;
      return item;
    });
    if (items.filter((x) => x.pinned).length > 3) throw new Error(`${where}: Instagram and TikTok allow 3 pinned posts at most`);
    return { id, name, handles, items };
  });
}

export function savePlans(root: string, raw: unknown): Plan[] {
  const plans = validatePlans(root, raw);
  const file = plansFile(root);
  fs.writeFileSync(file + ".tmp", JSON.stringify({ plans }, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
  return plans;
}

export const STRIP_FRAMES = 40;
/** STRIP_FRAMES evenly spaced frames side by side, 112 px tall, for the timeline's video track. */
export function filmstrip(video: string): Promise<string | null> {
  const ff = findTool("ffmpeg");
  if (!ff) return Promise.resolve(null);
  return cached(video, `strip${STRIP_FRAMES}`, "jpg", async (out) => {
    const dur = (await videoMeta(video))?.duration || 1;
    const rate = (STRIP_FRAMES / dur).toFixed(6);
    await runTool(ff, ["-y", "-v", "error", ...hw, "-i", video, "-an", "-vf", `fps=${rate}:start_time=0,scale=-2:112,tile=${STRIP_FRAMES}x1`, "-frames:v", "1", "-q:v", "5", out]);
  });
}

/** The audio as a waveform picture, for the timeline's audio track. */
export function waveform(video: string): Promise<string | null> {
  const ff = findTool("ffmpeg");
  if (!ff) return Promise.resolve(null);
  return cached(video, "wave", "png", async (out) => {
    if (!(await videoMeta(video))?.audio) throw new Error("no audio");
    await runTool(ff, ["-y", "-v", "error", "-i", video, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=2400x96:colors=0x7cf5e8:scale=sqrt", "-frames:v", "1", out]);
  });
}

// ---------------------------------------------------------------- the page

const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function readBody(req: http.IncomingMessage, limit = 12_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("not JSON"));
      }
    });
    req.on("error", reject);
  });
}

function streamVideo(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  const size = fs.statSync(file).size;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": size });
    fs.createReadStream(file).pipe(res);
  }
}

/** The review page on http://127.0.0.1:<port>, for every video under `root`. */
type ApplyJob = { state: "running" | "done" | "failed"; startedAt: string; finishedAt?: string; error?: string; result?: unknown };

/** `render`: how this host re-renders a spec (HQ: studio render; the clipper: clip render). Without it the page
 *  can mark cuts but not apply them. */
export function serveReview(opts: { root: string; port?: number; title?: string; render?: (specFile: string) => Promise<string | void> }): http.Server {
  const jobs = new Map<string, ApplyJob>();
  const root = path.resolve(opts.root);
  const port = opts.port ?? 8794;
  const page = REVIEW_PAGE.split("{{TITLE}}").join((opts.title ?? "Review").replace(/[<>&"]/g, ""));
  const server = http.createServer(async (req, res) => {
    try {
      // Only this Mac's own address: a web page can't reach the notes through a rebinding DNS name.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host ?? ""))) return send(res, 403, { error: "local only" });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const v = url.searchParams.get("v") ?? "";
      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(page);
      }
      if (url.pathname === "/api/videos") return send(res, 200, { root, videos: listVideos(root) });
      if (url.pathname === "/api/video") return streamVideo(req, res, resolveVideo(root, v));
      if (url.pathname === "/api/meta") return send(res, 200, { meta: await videoMeta(resolveVideo(root, v)), stripFrames: STRIP_FRAMES });
      if (url.pathname === "/api/poster" || url.pathname === "/api/strip" || url.pathname === "/api/wave") {
        const video = resolveVideo(root, v);
        const at = url.searchParams.get("t");
        const file = await (url.pathname === "/api/poster" ? poster(video, at === null ? undefined : Number(at)) : url.pathname === "/api/strip" ? filmstrip(video) : waveform(video));
        if (!file) return send(res, 404, { error: "not available" });
        res.writeHead(200, { "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "private, max-age=86400" });
        return fs.createReadStream(file).pipe(res);
      }
      if (url.pathname === "/api/frame") {
        const video = resolveVideo(root, v);
        const note = readNotes(video).find((n) => n.id === url.searchParams.get("id"));
        const which = url.searchParams.get("f");
        const name = which ? note?.frames?.find((f) => f === which) : note?.frame;
        const file = name ? path.join(framesDir(video), path.basename(name)) : "";
        if (!file || !fs.existsSync(file)) return send(res, 404, { error: "no frame" });
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
        return fs.createReadStream(file).pipe(res);
      }
      if (url.pathname === "/api/plans") {
        if (req.method === "GET") return send(res, 200, { plans: readPlans(root) });
        if (req.method !== "PUT") return send(res, 405, { error: "GET or PUT" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "JSON only" });
        const body = (await readBody(req, 1_000_000)) as { plans?: unknown };
        return send(res, 200, { plans: savePlans(root, body.plans) });
      }
      if (url.pathname === "/api/cuts" || url.pathname === "/api/speed" || url.pathname === "/api/apply") {
        const video = resolveVideo(root, v);
        if (url.pathname === "/api/apply" && req.method === "GET") return send(res, 200, jobs.get(video) ?? { state: "idle" });
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "JSON only" });
        const body = (await readBody(req, 100_000)) as Record<string, unknown>;
        if (url.pathname === "/api/cuts" && req.method === "POST") return send(res, 200, addCut(video, { t: Number(body.t), end: Number(body.end) }));
        if (url.pathname === "/api/cuts" && req.method === "DELETE") {
          deleteCut(video, String(body.id ?? ""));
          return send(res, 200, { ok: true });
        }
        if (url.pathname === "/api/speed" && req.method === "PUT") {
          setExportSpeed(video, body.speed === null || body.speed === undefined ? null : Number(body.speed));
          return send(res, 200, readEdits(video));
        }
        if (url.pathname === "/api/apply" && req.method === "POST") {
          if (!opts.render) return send(res, 501, { error: "this page can't render: ask Claude to apply the edits" });
          if (jobs.get(video)?.state === "running") return send(res, 409, { error: "already rendering" });
          const job: ApplyJob = { state: "running", startedAt: new Date().toISOString() };
          jobs.set(video, job);
          applyEdits(video, opts.render).then(
            (result) => Object.assign(job, { state: "done", result, finishedAt: new Date().toISOString() }),
            (e) => Object.assign(job, { state: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() }),
          );
          return send(res, 200, job);
        }
        return send(res, 405, { error: "not allowed" });
      }
      if (url.pathname === "/api/notes") {
        const video = resolveVideo(root, v);
        if (req.method === "GET") {
          const notes = readNotes(video).map((n) => ({ ...n, earlierCut: isEarlierCut(video, n) }));
          const map = readMap(video);
          return send(res, 200, { video: v, render: renderStamp(video), notes, edits: readEdits(video), applied: { speed: map?.speed ?? 1, editable: Boolean(map && opts.render) } });
        }
        // Only the page itself may write: a JSON body from this origin.
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "JSON only" });
        const body = (await readBody(req)) as Record<string, unknown>;
        if (req.method === "POST") {
          const note = addNote(video, {
            t: Number(body.t),
            end: body.end === undefined || body.end === null ? undefined : Number(body.end),
            text: String(body.text ?? ""),
            frameJpeg: typeof body.frame === "string" ? body.frame : undefined,
          });
          return send(res, 200, note.end === undefined ? note : ((await addSpanFrames(video, note.id)) ?? note));
        }
        if (req.method === "PATCH")
          return send(res, 200, updateNote(video, String(body.id ?? ""), {
            status: body.status === "fixed" || body.status === "open" ? body.status : undefined,
            text: typeof body.text === "string" ? body.text : undefined,
          }));
        if (req.method === "DELETE") {
          deleteNote(video, String(body.id ?? ""));
          return send(res, 200, { ok: true });
        }
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      if (!res.headersSent) send(res, 400, { error: e instanceof Error ? e.message : "failed" });
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
