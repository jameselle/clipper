// Review notes on rendered videos: watch a cut, pause where something looks wrong, write what you see.
// Each note keeps the moment (seconds), the caption on screen then, and a still of the frame, so whoever
// fixes the edit sees exactly what the reviewer saw. Notes live next to the video:
//
//   <video>.review.json          the notes
//   <video>.review/<id>.jpg      the frame each note was written on
//
// `serveReview` is the local page (127.0.0.1 only) that writes them. Only node's standard library is used,
// so this file is shared as-is between HQ (lib/studio/review.ts) and the clipper (lib/review.ts).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { REVIEW_PAGE } from "./review-page";

export type ReviewNote = {
  id: string;
  /** Seconds into the video. */
  t: number;
  text: string;
  status: "open" | "fixed";
  createdAt: string;
  /** The caption on screen at `t`, when the video has a caption file beside it. */
  caption?: string;
  /** File name of the frame still, inside `<video>.review/`. */
  frame?: string;
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

export function readNotes(video: string): ReviewNote[] {
  try {
    const raw = JSON.parse(fs.readFileSync(notesFile(video), "utf8"));
    return Array.isArray(raw?.notes) ? (raw.notes as ReviewNote[]) : [];
  } catch {
    return [];
  }
}

function writeNotes(video: string, notes: ReviewNote[]) {
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const tmp = notesFile(video) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ video: path.basename(video), notes: sorted }, null, 2) + "\n");
  fs.renameSync(tmp, notesFile(video));
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** `frameJpeg`: the frame as base64 JPEG (a data: URL prefix is fine). */
export function addNote(video: string, input: { t: number; text: string; frameJpeg?: string }): ReviewNote {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("the note is empty");
  if (!(Number.isFinite(input.t) && input.t >= 0)) throw new Error("the time is missing");
  const note: ReviewNote = {
    id: newId(),
    t: Math.round(input.t * 100) / 100,
    text,
    status: "open",
    createdAt: new Date().toISOString(),
    render: renderStamp(video),
  };
  const caption = captionAt(video, note.t);
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
  if (note.frame) fs.rmSync(path.join(framesDir(video), path.basename(note.frame)), { force: true });
  const left = notes.filter((n) => n.id !== id);
  if (left.length) writeNotes(video, left);
  else fs.rmSync(notesFile(video), { force: true }); // the last note: leave no empty file behind
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

export const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** Plain-text summary of a video's notes, for the CLI (and for Claude to work from). */
export function formatNotes(video: string, notes: ReviewNote[], all = false): string {
  const shown = all ? notes : notes.filter((n) => n.status === "open");
  if (!shown.length) return `${video}\n  no ${all ? "" : "open "}notes`;
  const lines = [video];
  for (const n of shown) {
    const flags = [n.status === "fixed" ? "fixed" : "", isEarlierCut(video, n) ? "earlier cut" : ""].filter(Boolean).join(", ");
    lines.push(`  [${n.id}] ${clock(n.t)}${flags ? ` (${flags})` : ""}  ${n.text}`);
    if (n.caption) lines.push(`      caption: "${n.caption}"`);
    if (n.frame) lines.push(`      frame:   ${path.join(framesDir(video), n.frame)}`);
    if (n.fix) lines.push(`      fix:     ${n.fix}`);
  }
  return lines.join("\n");
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
export function serveReview(opts: { root: string; port?: number; title?: string }): http.Server {
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
      if (url.pathname === "/api/frame") {
        const video = resolveVideo(root, v);
        const note = readNotes(video).find((n) => n.id === url.searchParams.get("id"));
        const file = note?.frame ? path.join(framesDir(video), path.basename(note.frame)) : "";
        if (!file || !fs.existsSync(file)) return send(res, 404, { error: "no frame" });
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
        return fs.createReadStream(file).pipe(res);
      }
      if (url.pathname === "/api/notes") {
        const video = resolveVideo(root, v);
        if (req.method === "GET") {
          const notes = readNotes(video).map((n) => ({ ...n, earlierCut: isEarlierCut(video, n) }));
          return send(res, 200, { video: v, render: renderStamp(video), notes });
        }
        // Only the page itself may write: a JSON body from this origin.
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "JSON only" });
        const body = (await readBody(req)) as Record<string, unknown>;
        if (req.method === "POST") return send(res, 200, addNote(video, { t: Number(body.t), text: String(body.text ?? ""), frameJpeg: typeof body.frame === "string" ? body.frame : undefined }));
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
