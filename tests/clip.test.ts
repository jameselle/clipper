import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { mergeBrand, renderSpeed } from "../lib/brand";
import { validateSpec, type EditSpec } from "../lib/spec";
import { assColour, buildAss, captionLines, clearOfHook, cutawayWindows, joinsOf, keepPieces, outputDuration, outputWords, panCrop, reconcileWords, reframeFilter, type Word } from "../lib/timeline";

const spec = (over: Partial<EditSpec> = {}): EditSpec => ({
  title: "T",
  sources: { a: "/tmp/a.mp4" },
  segments: [{ source: "a", start: 0, end: 10 }],
  formats: ["vertical"],
  ...over,
});
const W = (w: string, start: number, end: number): Word => ({ w, start, end });

test("spec validation names every problem", () => {
  assert.equal(validateSpec(spec()).ok, true);
  const r = validateSpec({ ...spec(), sources: { a: "relative.mp4" }, segments: [{ source: "b", start: 5, end: 2 }], formats: ["cinema"] });
  assert.equal(r.ok, false);
  if (!r.ok) for (const k of ["sources.a", "segments[0].source", "segments[0]", "formats"]) assert.ok(r.errors.some((e) => e.startsWith(k)), k);
});

test("pauses are cut from real silence, with air kept either side", () => {
  const pieces = keepPieces(spec({ tightenPauses: 0.5 }), {}, { a: [[3, 5], [7, 7.3]] });
  // 3..5 is cut (keeps 0.15 s each side); 7..7.3 is shorter than 0.5 so it stays
  assert.deepEqual(pieces.map((p) => [p.start, p.end]), [[0, 3.15], [4.85, 10]]);
  assert.equal(outputDuration(pieces), 8.3);
});

test("without silence data, word gaps decide", () => {
  const words = { a: [W("one", 0, 1), W("two", 3, 4)] };
  assert.equal(keepPieces(spec({ tightenPauses: 0.5 }), words).length, 2);
  assert.equal(keepPieces(spec({ tightenPauses: 0 }), words).length, 1);
});

test("words are re-timed onto the output clock; a word stretched over a cut pause survives", () => {
  const pieces = keepPieces(spec({ tightenPauses: 0.5 }), {}, { a: [[3, 5]] });
  const words = { a: [W("hot.", 2.5, 4.9), W("Here", 5.0, 5.3)] }; // whisper stretched "hot." across the pause
  const out = outputWords(pieces, words);
  assert.deepEqual(out.map((w) => w.w), ["hot.", "Here"]);
  assert.ok(out[1].start < 3.6, "second word moved up by the cut");
});

test("captions: at most 3 words, break on sentence ends, hold until the next line", () => {
  const lines = captionLines([W("Most", 0, 0.2), W("people", 0.2, 0.5), W("brew", 0.5, 0.7), W("coffee.", 0.7, 1), W("Fix", 1.1, 1.3)]);
  assert.deepEqual(lines.map((l) => l.text), ["Most people brew", "coffee.", "Fix"]);
  assert.equal(lines[0].end, lines[1].start);
});

test("ASS output: colours, hook, escaped text", () => {
  assert.equal(assColour("#FFD60A"), "&H000AD6FF");
  const ass = buildAss({ w: 1080, h: 1920 }, [{ text: "a {b}", start: 0, end: 1 }], { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A" }, { text: "HOOK", seconds: 2 });
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:02\.00,Hook,,0,0,0,,HOOK/);
  assert.match(ass, /,Caption,,0,0,0,,A \(B\)/);
});

test("captions: each line keeps its words, for word-by-word animation", () => {
  const lines = captionLines([W("Most", 0, 0.2), W("people", 0.2, 0.5), W("brew", 0.5, 0.7), W("coffee.", 0.7, 1)]);
  assert.deepEqual(lines[0].words?.map((w) => w.w), ["Most", "people", "brew"]);
  assert.deepEqual(lines[1].words?.map((w) => w.w), ["coffee."]);
});

test("ASS pop captions: one event per word, the spoken word highlighted with a pop, later words hidden", () => {
  const style = { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A" };
  const line = { text: "Most people brew", start: 0, end: 0.9, words: [W("Most", 0, 0.2), W("people", 0.25, 0.5), W("brew", 0.55, 0.7)] };
  const events = buildAss({ w: 1080, h: 1920 }, [line], style).split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(events.length, 3, "one event per word");
  // Back to back, no gaps: each word's event runs until the next word starts; the last holds to the line end.
  assert.match(events[0], /Dialogue: 0,0:00:00\.00,0:00:00\.25,Caption/);
  assert.match(events[1], /,0:00:00\.25,0:00:00\.55,Caption/);
  assert.match(events[2], /,0:00:00\.55,0:00:00\.90,Caption/);
  // First event: MOST is the active word (highlight colour + pop), the rest are invisible but keep their place.
  assert.match(events[0], /\\1c&H000AD6FF&[^}]*\\fscx1\d\d[^}]*\\t\(0,\d+,\\fscx100\\fscy100\)\}MOST/);
  assert.match(events[0], /\\alpha&HFF&\}PEOPLE/);
  // Second event: MOST has been said (primary colour, visible), PEOPLE is active, BREW still hidden.
  assert.match(events[1], /\\1c&H00FFFFFF&\\alpha&H00&\}MOST/);
  assert.match(events[1], /\\1c&H000AD6FF&[^}]*\}PEOPLE/);
  assert.match(events[1], /\\alpha&HFF&\}BREW/);
});

test("ASS captions: 'none' animation, or lines without words, keep the static style", () => {
  const style = { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A", animate: "none" as const };
  const line = { text: "Most people", start: 0, end: 0.5, words: [W("Most", 0, 0.2), W("people", 0.25, 0.5)] };
  const events = buildAss({ w: 1080, h: 1920 }, [line], style).split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.deepEqual(events, ["Dialogue: 0,0:00:00.00,0:00:00.50,Caption,,0,0,0,,MOST PEOPLE"]);
});

test("reframe: crop keeps the focus inside the frame; same shape just scales", () => {
  assert.equal(reframeFilter({ w: 1920, h: 1080 }, "landscape", { w: 1920, h: 1080 }, "crop"), "scale=1920:1080");
  const f = reframeFilter({ w: 1920, h: 1080 }, "vertical", { w: 1080, h: 1920 }, "crop", 0.5);
  assert.equal(f, "scale=3414:1920,crop=1080:1920:1167:0");
  assert.match(reframeFilter({ w: 1920, h: 1080 }, "vertical", { w: 1080, h: 1920 }, "crop", 1), /crop=1080:1920:2334:0/);
  assert.match(reframeFilter({ w: 1920, h: 1080 }, "vertical", { w: 1080, h: 1920 }, "fit-blur", 0.5, "7"), /\[bg7\].*boxblur/);
});

test("brand: captions default to pop; anything but pop or none is refused", () => {
  assert.equal(mergeBrand({}).captions, "pop");
  assert.equal(mergeBrand({ captions: "none" }).captions, "none");
  assert.throws(() => mergeBrand({ captions: "karaoke" as never }), /brand\.captions/);
});

test("brand: brand.json sets the speed videos post at; a spec's own speed wins", () => {
  assert.equal(mergeBrand({}).speed, 1, "no brand speed: videos play at 1x");
  const brand = mergeBrand({ speed: 1.25 });
  assert.equal(renderSpeed(spec(), brand), 1.25, "a spec without a speed inherits brand.json's");
  assert.equal(renderSpeed(spec({ speed: 1.5 }), brand), 1.5, "a spec that sets one keeps it");
  assert.equal(renderSpeed(spec({ speed: 1 }), brand), 1, "an explicit 1x is not overridden by the brand");
  assert.equal(renderSpeed(spec(), mergeBrand({})), 1);
  assert.throws(() => mergeBrand({ speed: 4 }), /brand\.speed/);
  assert.throws(() => mergeBrand({ speed: "fast" as never }), /brand\.speed/);
});

test("brand: defaults fill gaps, bad colours are refused", () => {
  assert.equal(mergeBrand({ highlight: "#00FF00" }).font, "Arial Black");
  assert.throws(() => mergeBrand({ primary: "white" }), /primary/);
});

// ---- end to end: only where the real tools exist ----
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const whisperFound = Boolean(process.env.CLIPPER_WHISPER) || has("sh", ["-c", "command -v whisper-cli"]) || fs.existsSync(path.join(os.homedir(), ".cache", "hyperframes", "whisper", "whisper.cpp", "build", "bin", "whisper-cli"));
const e2eReady = has("ffmpeg", ["-version"]) && has("/usr/bin/say", ["-v", "?"]) && whisperFound;
const CLIP = path.join(import.meta.dirname, "..", "clip.ts");

test("end to end: speech with pauses -> captioned vertical clip that passes QA", { skip: !e2eReady && "needs ffmpeg, say and whisper-cli", timeout: 240_000 }, () => {
  const env = { ...process.env, CLIPPER_JOBS: fs.mkdtempSync(path.join(os.tmpdir(), "clip-e2e-")) };
  const job = spawnSync("npx", ["tsx", CLIP, "new-job", "e2e"], { encoding: "utf8", env }).stdout.trim();
  const aiff = path.join(job, "talk.aiff");
  spawnSync("/usr/bin/say", ["-v", "Samantha", "-o", aiff, "Brew it cooler. [[slnc 2000]] Ninety two degrees is the sweet spot."]);
  const src = path.join(job, "source.mp4");
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-i", aiff, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src]);
  fs.writeFileSync(path.join(job, "spec.json"), JSON.stringify(spec({ sources: { a: src }, segments: [{ source: "a", start: 0, end: 5.5 }], tightenPauses: 0.6, captions: true, hook: { text: "TOO HOT?" } })));
  const r = spawnSync("npx", ["tsx", CLIP, "render", path.join(job, "spec.json")], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(job, "t-vertical.mp4");
  const qa = spawnSync("npx", ["tsx", CLIP, "check", out], { encoding: "utf8", env });
  assert.equal(qa.status, 0, qa.stdout + qa.stderr);
  assert.match(qa.stdout, /words kept\s+100%/);
});

// ---------------------------------------------------------------- cutaways and hook styles

test("spec: cutaways need an absolute file and the words they cover; pan and faceY are checked", () => {
  const base = { title: "t", sources: { a: "/x.mp4" }, segments: [{ source: "a", start: 0, end: 5 }], formats: ["vertical"] };
  assert.equal(validateSpec({ ...base, faceY: 0.4, cutaways: [{ file: "/shot.png", from: "I call it", to: "support.", pan: { from: [0, 0, 800], to: [100, 50, 800] } }] }).ok, true);
  const bad = validateSpec({ ...base, faceY: 2, cutaways: [{ file: "shot.png", from: "", to: "x", pan: { from: [0, 0], to: [0, 0, 10] } }] });
  assert.equal(bad.ok, false);
  const errors = (bad as { errors: string[] }).errors.join(" | ");
  for (const want of ["faceY", "cutaways[0].file", "cutaways[0].from", "cutaways[0].pan"]) assert.match(errors, new RegExp(want.replace(/[[\].]/g, "\\$&")));
});

test("cutaway windows: found by the words heard, snapped to whole caption lines, in order", () => {
  const lines = captionLines([
    W("Here's", 0, 0.3), W("what", 0.3, 0.5), W("I", 0.5, 0.6), W("use.", 0.6, 0.9),
    W("I", 1.0, 1.1), W("call", 1.1, 1.3), W("it", 1.3, 1.4), W("HQ.", 1.4, 1.8),
    W("It", 2.0, 2.1), W("runs", 2.1, 2.4), W("everything.", 2.4, 3.0),
  ]);
  // Lines: "Here's what I" | "use." | "I call it" | "HQ." | "It runs everything."
  const win = cutawayWindows(lines, [{ file: "/a.png", from: "call it HQ", to: "it runs" }]);
  assert.deepEqual(win.map((w) => [w.start, w.end]), [[1.0, 3.4]], "from the start of the line holding 'call' to the end of the line holding 'runs' (held 0.4 s)");
  assert.throws(() => cutawayWindows(lines, [{ file: "/a.png", from: "not said", to: "HQ." }]), /cutaway 1: couldn't find "not said"/);
  // A second cutaway is looked for after the first one ends.
  assert.throws(() => cutawayWindows(lines, [{ file: "/a.png", from: "I call", to: "HQ." }, { file: "/b.png", from: "use.", to: "use." }]), /cutaway 2/);
});

test("ASS seams: caption events inside a cutaway sit on the seam; outside they stay put; the hook never moves", () => {
  const style = { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A", animate: "none" as const };
  const lines = [{ text: "before", start: 0, end: 1 }, { text: "during", start: 1, end: 2 }];
  const ass = buildAss({ w: 1080, h: 1920 }, lines, style, { text: "HOOK", seconds: 2 }, { seams: [[1, 2]] });
  assert.match(ass, /,Caption,,0,0,0,,BEFORE/);
  assert.match(ass, /,Caption,,0,0,0,,\{\\an5\\pos\(540,960\)\}DURING/);
  assert.match(ass, /,Hook,,0,0,0,,HOOK/);
});

test("ASS text hook: big outlined text, the highlight words coloured, pops in and fades out", () => {
  const style = { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A", hook: "text" as const };
  const ass = buildAss({ w: 1080, h: 1920 }, [], style, { text: "THIS RUNS MY WHOLE BUSINESS", seconds: 2.5, highlight: "whole business" });
  const hookStyle = ass.split("\n").find((l) => l.startsWith("Style: Hook,"))!;
  assert.equal(hookStyle.split(",")[15], "1", "outline and shadow, not a filled box");
  assert.match(ass, /,Hook,,0,0,0,,\{\\fad\(0,\d+\)\\fscx\d+\\fscy\d+\\t\(0,\d+,\\fscx100\\fscy100\)\}THIS RUNS MY \{\\1c&H000AD6FF&\}WHOLE BUSINESS\{\\1c&H00FFFFFF&\}/);
});

test("brand: the hook defaults to text; box is still there", () => {
  assert.equal(mergeBrand({}).hook, "text");
  assert.equal(mergeBrand({ hook: "box" }).hook, "box");
  assert.throws(() => mergeBrand({ hook: "banner" as never }), /brand\.hook/);
});

test("pan: keeps the panel's shape and eases from one region to the other", () => {
  const f = panCrop({ from: [100, 200, 1000], to: [300, 400, 1000] }, { w: 1080, h: 960 }, 4);
  assert.match(f, /^crop=1000:889:/);
  assert.match(f, /'100\+\(300-100\)\*\(3\*pow\(min\(t\/4,1\),2\)-2\*pow\(min\(t\/4,1\),3\)\)'/);
  assert.throws(() => panCrop({ from: [0, 0, 1000], to: [0, 0, 900] }, { w: 1080, h: 960 }, 4), /same width/);
});

test("reconcile: a short extra word right at a join (a breath heard as \"It\") is dropped; real words at joins stay", () => {
  const heard = [W("time.", 9.4, 9.8), W("It", 10.05, 10.2), W("business", 10.25, 10.6), W("worth", 10.7, 11)];
  const expected = ["time.", "business", "worth"];
  const join = { at: 10.0, nearby: ["real", "time.", "business", "worth"] };
  assert.deepEqual(reconcileWords(heard, expected, [join]).map((w) => w.w), ["time.", "business", "worth"]);
  assert.deepEqual(reconcileWords(heard, expected).map((w) => w.w), ["time.", "It", "business", "worth"], "no join given: kept");
  assert.deepEqual(reconcileWords(heard, expected, [{ ...join, at: 5 }]).map((w) => w.w), ["time.", "It", "business", "worth"], "far from the join: kept");
  // The expected list can miss a piece's last word ("job."); the source says it near the join, so it stays.
  const edge = [W("the", 9.0, 9.2), W("job.", 9.95, 10.1), W("Nobody", 10.3, 10.7)];
  assert.deepEqual(reconcileWords(edge, ["the", "Nobody"], [{ at: 10.0, nearby: ["covers", "the", "job.", "Nobody", "tells"] }]).map((w) => w.w), ["the", "job.", "Nobody"]);
  const long = [W("time.", 9.4, 9.8), W("absolutely", 10.05, 10.5), W("business", 10.55, 10.9)];
  assert.deepEqual(reconcileWords(long, ["time.", "business"], [join]).map((w) => w.w), ["time.", "absolutely", "business"], "only short words");
});

test("joins carry the source words either side of each cut", () => {
  const pieces = [{ source: "a", start: 0, end: 10, outStart: 0 }, { source: "a", start: 20, end: 30, outStart: 10 }];
  const words = { a: [W("covers", 9.0, 9.3), W("the", 9.45, 9.6), W("job.", 9.6, 10.2), W("far", 15, 15.5), W("Nobody", 20.1, 20.5), W("later", 25, 25.5)] };
  assert.deepEqual(joinsOf(pieces, words), [{ at: 10, nearby: ["the", "job.", "Nobody"] }]);
});

test("a cutaway can fill the whole frame; full must be true or false", () => {
  const c = { file: "/abs/card.mp4", from: "a", to: "b" };
  assert.equal(validateSpec(spec({ cutaways: [{ ...c, full: true }] })).ok, true);
  const r = validateSpec(spec({ cutaways: [{ ...c, full: "yes" as unknown as boolean }] }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("cutaways[0].full")));
});

test("a vertical hook sits inside the 3:4 grid crop Instagram and TikTok show on the profile", () => {
  const style = { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A", hook: "text" as const };
  const marginV = (ass: string) => Number(ass.split("\n").find((l) => l.startsWith("Style: Hook,"))!.split(",")[21]);
  for (const hookKind of ["text", "box"] as const) {
    const v = buildAss({ w: 1080, h: 1920 }, [], { ...style, hook: hookKind }, { text: "HOOK" });
    const cropTop = (1920 - (1080 * 4) / 3) / 2; // 240 px are hidden above the grid tile
    assert.ok(marginV(v) >= cropTop + 40, `${hookKind}: hook top ${marginV(v)} is inside the crop (> ${cropTop + 40})`);
    assert.ok(marginV(v) <= 420, `${hookKind}: still near the top`);
  }
  const land = buildAss({ w: 1920, h: 1080 }, [], style, { text: "HOOK" });
  assert.equal(marginV(land), Math.round(1080 * 0.09), "landscape keeps its margin");
});

test("no em dashes on screen: a hook with one is refused, and caption words lose theirs", () => {
  const r = validateSpec(spec({ hook: { text: "DAY 1 — THE TOOLS" } }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("hook.text")));
  const ass = buildAss({ w: 1080, h: 1920 }, captionLines([W("free—both", 0, 0.5), W("2–3", 0.5, 1)]), { font: "Arial Black", primary: "#FFFFFF", outline: "#000000", highlight: "#FFD60A" });
  assert.doesNotMatch(ass, /[\u2013\u2014]/);
});


test("a sentence's last word stays in the edit when whisper stretches it past where the pause is trimmed", () => {
  // Real case (Day 2): "zero." 117.68-118.42, silence from 117.85: the piece ends at 118.0, before the word's midpoint.
  const pieces = keepPieces(spec({ segments: [{ source: "a", start: 110, end: 125 }], tightenPauses: 0.5 }), {}, { a: [[117.85, 118.6]] });
  const words = { a: [W("saw", 117.44, 117.68), W("zero.", 117.68, 118.42), W("No", 118.64, 118.69)] };
  assert.deepEqual(outputWords(pieces, words).map((w) => w.w), ["saw", "zero.", "No"]);
});

test("a word whisper dates inside a trimmed pause was said just before it: it stays, at the end of the piece", () => {
  // Real case (Day 2): "worked." is dated 0.2 s into the silence that the pause trim removes.
  const pieces = keepPieces(spec({ segments: [{ source: "a", start: 0, end: 10 }], tightenPauses: 0.5 }), {}, { a: [[4.0, 6.0]] });
  const words = { a: [W("it", 3.6, 3.8), W("worked.", 4.35, 4.9), W("Then", 6.1, 6.3)] };
  const out = outputWords(pieces, words);
  assert.deepEqual(out.map((w) => w.w), ["it", "worked.", "Then"]);
  assert.ok(out[1].start <= pieces[0].end - pieces[0].start + pieces[0].outStart, "placed inside the first piece");
  assert.ok(out[1].start >= out[0].start && out[2].start >= out[1].end, "still in order");
});

test("a cutaway never covers the hook: it waits until the hook is off screen", () => {
  const w = clearOfHook([{ start: 1.0, end: 4.0 }, { start: 5, end: 6 }, { start: 0.5, end: 2.0 }], 2.5);
  assert.deepEqual(w, [{ start: 2.5, end: 4.0 }, { start: 5, end: 6 }, { start: 2.5, end: 2.5 }]);
  assert.deepEqual(clearOfHook([{ start: 1, end: 2 }], 0), [{ start: 1, end: 2 }], "no hook: unchanged");
});

test("reconcile, source mode: captions say exactly the corrected transcript, timed by what the cut heard", () => {
  // The cut's pass heard "many chat" (two words), "forty dollars" for "$40", "laid up" for "later," and missed "zero".
  const heard = [W("many", 0, 0.2), W("chat", 0.2, 0.5), W("costs", 0.6, 0.9), W("30", 1, 1.2), W("to", 1.2, 1.3), W("forty", 1.3, 1.6), W("dollars", 1.6, 2), W("the", 2.2, 2.3), W("app", 2.3, 2.5), W("saw", 2.5, 2.8), W("laid", 3, 3.2), W("up", 3.2, 3.4)];
  const expected = ["ManyChat", "costs", "30", "to", "$40", "the", "app", "saw", "zero", "later,"];
  const out = reconcileWords(heard, expected, [], "source");
  assert.deepEqual(out.map((w) => w.w), expected);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].start, "times stay in order");
  const zero = out[expected.indexOf("zero")];
  assert.ok(zero.start >= 2.8 && zero.end <= 3.2, "a word the cut missed gets the gap where it was said");
  assert.deepEqual(reconcileWords(heard, expected).map((w) => w.w).includes("many"), true, "default mode is unchanged");
});

test("captionText must be heard or source", () => {
  assert.equal(validateSpec(spec({ captionText: "source" })).ok, true);
  const r = validateSpec(spec({ captionText: "both" as unknown as "source" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("captionText")));
});


test("reconcile: a word misheard in the cut takes the source transcript's spelling, keeping the cut's timing", () => {
  const heard = [W("Or", 1, 1.2), W("get", 1.2, 1.4), W("a", 1.4, 1.5), W("message", 1.5, 2)];
  const out = reconcileWords(heard, ["You'll", "get", "a", "message"]);
  assert.deepEqual(out.map((w) => w.w), ["You'll", "get", "a", "message"]);
  assert.deepEqual(out.map((w) => [w.start, w.end]), heard.map((w) => [w.start, w.end]));
  // An extra word the cut really has stays; a word the cut dropped is not invented; case and punctuation differences are left alone.
  assert.deepEqual(reconcileWords([W("so", 0, 1), W("um", 1, 2), W("yes.", 2, 3)], ["So", "yes"]).map((w) => w.w), ["so", "um", "yes."]);
  assert.deepEqual(reconcileWords([W("the", 0, 1), W("end.", 1, 2)], ["the", "very", "end."]).map((w) => w.w), ["the", "end."]);
  assert.deepEqual(reconcileWords([W("What", 0, 1), W("version", 1, 2), W("I", 2, 3), W("use", 3, 4)], ["The", "version", "I", "use"]).map((w) => w.w), ["The", "version", "I", "use"]);
});

