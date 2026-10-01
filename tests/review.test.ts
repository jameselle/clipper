import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { addNote, addSpanFrames, captionInAss, captionsAcross, deleteNote, formatNotes, framesDir, isEarlierCut, listVideos, notesFile, readNotes, resolveVideo, serveReview, updateNote } from "../lib/review";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString("base64");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-review-"));
  const job = path.join(root, "acme-co", "studio", "job-1");
  fs.mkdirSync(job, { recursive: true });
  const video = path.join(job, "promo-vertical.mp4");
  fs.writeFileSync(video, Buffer.alloc(1000, 7));
  fs.writeFileSync(path.join(job, "master.mp4"), "m");
  fs.writeFileSync(path.join(job, ".vertical.cut.mp4"), "hidden");
  fs.writeFileSync(
    path.join(job, "vertical.ass"),
    [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 1,0:00:00.00,0:00:02.50,Hook,,0,0,0,,{\\fad(0,200)}$1M IN {\\c&H0AD6FF&}365 DAYS",
      "Dialogue: 0,0:00:01.00,0:00:01.40,Caption,,0,0,0,,{\\1c&H000AD6FF&}GOING {\\alpha&HFF&}TO TRY",
      "Dialogue: 0,0:00:01.40,0:00:01.90,Caption,,0,0,0,,GOING {\\1c&H000AD6FF&}TO {\\alpha&HFF&}TRY",
    ].join("\n"),
  );
  return { root, job, video };
}

test("lists every mp4 under the folder, newest first, skipping hidden files", () => {
  const { root } = fixture();
  const names = listVideos(root).map((v) => v.v).sort();
  assert.deepEqual(names, ["acme-co/studio/job-1/master.mp4", "acme-co/studio/job-1/promo-vertical.mp4"]);
});

test("refuses videos outside the folder, non-mp4 files and missing files", () => {
  const { root, video } = fixture();
  assert.equal(resolveVideo(root, "acme-co/studio/job-1/promo-vertical.mp4"), video);
  assert.throws(() => resolveVideo(root, "../../etc/passwd"), /outside/);
  assert.throws(() => resolveVideo(root, "/etc/hosts.mp4"), /outside/);
  assert.throws(() => resolveVideo(root, "acme-co/studio/job-1/vertical.ass"), /\.mp4/);
  assert.throws(() => resolveVideo(root, "acme-co/nope.mp4"), /no such/);
});

test("a note keeps the moment, the caption on screen and the frame; it can be edited, fixed and deleted", () => {
  const { video } = fixture();
  const n = addNote(video, { t: 1.234, text: "  caption covers the graphic ", frameJpeg: `data:image/jpeg;base64,${JPEG}` });
  assert.equal(n.t, 1.23);
  assert.equal(n.text, "caption covers the graphic");
  assert.equal(n.caption, "GOING TO TRY");
  assert.ok(n.frame && fs.existsSync(path.join(framesDir(video), n.frame)));
  assert.equal(readNotes(video).length, 1);

  addNote(video, { t: 0.5, text: "hook too small" });
  assert.deepEqual(readNotes(video).map((x) => x.t), [0.5, 1.23], "kept in time order");
  assert.equal(readNotes(video)[0].caption, "$1M IN 365 DAYS", "the hook when no caption is up");

  const fixed = updateNote(video, n.id, { status: "fixed", fix: "moved captions up" });
  assert.equal(fixed.status, "fixed");
  assert.ok(fixed.fixedAt);
  assert.match(formatNotes(video, readNotes(video), true), /fixed.*caption covers the graphic[\s\S]*fix: +moved captions up/);
  assert.doesNotMatch(formatNotes(video, readNotes(video)), /caption covers/, "open-only view hides fixed notes");

  deleteNote(video, n.id);
  assert.equal(readNotes(video).length, 1);
  assert.equal(fs.existsSync(path.join(framesDir(video), n.frame!)), false, "its frame goes too");
  deleteNote(video, readNotes(video)[0].id);
  assert.equal(fs.existsSync(notesFile(video)), false, "no empty notes file left");
  assert.equal(fs.existsSync(framesDir(video)), false, "no empty frames folder left");
  assert.throws(() => addNote(video, { t: 1, text: "   " }), /empty/);
  assert.throws(() => updateNote(video, "nope", { status: "fixed" }), /no such note/);
});

test("a junk frame is ignored, not saved", () => {
  const { video } = fixture();
  const n = addNote(video, { t: 1, text: "x", frameJpeg: Buffer.from("not a jpeg").toString("base64") });
  assert.equal(n.frame, undefined);
});

test("notes on an earlier render are flagged once the video is re-rendered", () => {
  const { video } = fixture();
  const n = addNote(video, { t: 1, text: "x" });
  assert.equal(isEarlierCut(video, n), false);
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(video, later, later);
  assert.equal(isEarlierCut(video, n), true);
});

test("caption lookup reads the karaoke line on screen, hidden words included", () => {
  const ass = "Dialogue: 0,0:01:02.00,0:01:03.00,Caption,,0,0,0,,{\\alpha&H00&}IT'S {\\alpha&HFF&}EVERYTHING\\NAFTER";
  assert.equal(captionInAss(ass, 62.5), "IT'S EVERYTHING AFTER");
  assert.equal(captionInAss(ass, 63), undefined);
});

function request(port: number, method: string, p: string, body?: unknown, host = `127.0.0.1:${port}`, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host, ...(data ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

test("the review page serves the list, streams video ranges and writes notes, for this Mac only", async () => {
  const { root, video } = fixture();
  const server = serveReview({ root, port: 0 });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const v = encodeURIComponent("acme-co/studio/job-1/promo-vertical.mp4");
  try {
    const page = (await request(port, "GET", "/")).body;
    assert.match(page, /Pick a video/);
    assert.doesNotMatch(page, /\{\{TITLE\}\}/, "every title placeholder filled");
    assert.equal(JSON.parse((await request(port, "GET", "/api/videos")).body).videos.length, 2);

    const part = await request(port, "GET", `/api/video?v=${v}`, undefined, undefined, { range: "bytes=100-199" });
    assert.equal(part.status, 206);
    assert.equal(part.headers["content-range"], "bytes 100-199/1000");
    assert.equal(part.body.length, 100);

    const made = await request(port, "POST", `/api/notes?v=${v}`, { t: 1.2, text: "wrong screenshot", frame: JPEG });
    assert.equal(made.status, 200);
    const id = JSON.parse(made.body).id;
    assert.equal((await request(port, "GET", `/api/frame?v=${v}&id=${id}`)).status, 200);
    assert.equal((await request(port, "PATCH", `/api/notes?v=${v}`, { id, status: "fixed" })).status, 200);
    assert.equal(readNotes(video)[0].status, "fixed");

    assert.equal((await request(port, "GET", `/api/video?v=${encodeURIComponent("../../x.mp4")}`)).status, 400, "outside the folder");
    assert.equal((await request(port, "GET", "/api/videos", undefined, "evil.example:80")).status, 403, "rebinding host refused");
    const notJson = await new Promise<number>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: `/api/notes?v=${v}`, headers: { "content-type": "text/plain" } }, (res) => resolve(res.statusCode ?? 0));
      req.end('{"t":1,"text":"x"}');
    });
    assert.equal(notJson, 415, "a form post from another site can't write");
  } finally {
    server.close();
  }
});

test("a note can cover a span: it keeps the end and every caption shown across it", () => {
  const { video } = fixture();
  const n = addNote(video, { t: 0.2, end: 1.8, text: "hook and first caption clash" });
  assert.equal(n.end, 1.8);
  assert.equal(n.caption, "$1M IN 365 DAYS / GOING TO TRY");
  assert.equal(captionsAcross(video, 1.0, 1.85), "GOING TO TRY");
  assert.match(formatNotes(video, readNotes(video)), /0:00\.2–0:01\.8 +hook and first caption clash\n +captions: "\$1M IN 365 DAYS \/ GOING TO TRY"/);
  assert.throws(() => addNote(video, { t: 2, end: 1, text: "x" }), /end after/);
  assert.equal(addNote(video, { t: 2, text: "moment" }).end, undefined);
});

const hasFfmpeg = spawnSync("sh", ["-c", "command -v ffmpeg && command -v ffprobe"]).status === 0;

function realVideo(): { root: string; video: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-review-real-"));
  const video = path.join(root, "clip-vertical.mp4");
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=180x320:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
  assert.equal(r.status, 0, String(r.stderr));
  return { root, video };
}

test("a span note gets stills from its middle and end; deleting it removes them all", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  const { video } = realVideo();
  const n = addNote(video, { t: 0.5, end: 2.5, text: "graphic too late", frameJpeg: JPEG });
  const done = await addSpanFrames(video, n.id);
  assert.deepEqual(done?.frames, [`${n.id}-mid.jpg`, `${n.id}-end.jpg`]);
  for (const f of done!.frames!) assert.ok(fs.statSync(path.join(framesDir(video), f)).size > 500, f);
  deleteNote(video, n.id);
  assert.equal(fs.existsSync(framesDir(video)), false);
});

test("the page serves meta, poster, filmstrip and waveform for a real video, and span frames", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  const { root } = realVideo();
  const server = serveReview({ root, port: 0 });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const v = "clip-vertical.mp4";
  try {
    const meta = JSON.parse((await request(port, "GET", `/api/meta?v=${v}`)).body);
    assert.equal(Math.round(meta.meta.duration), 3);
    assert.deepEqual([meta.meta.width, meta.meta.height, meta.meta.audio], [180, 320, true]);
    for (const kind of ["poster", "strip", "wave"]) {
      const r = await request(port, "GET", `/api/${kind}?v=${v}`);
      assert.equal(r.status, 200, kind);
      assert.match(String(r.headers["content-type"]), /image\//, kind);
    }
    const made = JSON.parse((await request(port, "POST", `/api/notes?v=${v}`, { t: 0.4, end: 2, text: "span" })).body);
    assert.equal(made.end, 2);
    assert.equal(made.frames.length, 2);
    assert.equal((await request(port, "GET", `/api/frame?v=${v}&id=${made.id}&f=${made.frames[1]}`)).status, 200);
    assert.equal((await request(port, "GET", `/api/frame?v=${v}&id=${made.id}&f=../../etc/passwd`)).status, 404, "only the note's own stills");
  } finally {
    server.close();
  }
});
