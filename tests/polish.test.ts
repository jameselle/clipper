import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeBrand } from "../lib/brand";
import { SFX_SOURCE, VOICE_CHAIN, emphatic, longCaptions, pacing, punchFilter, punchWindows, sfxEvents } from "../lib/polish";
import { validateSpec } from "../lib/spec";

const line = (text: string, start: number, end: number) => ({ text, start, end });

test("punch-ins prefer numbers and keywords, skip the hook and cutaways, and keep their distance", () => {
  const lines = [
    line("This runs my", 0.2, 1.0), // under the hook
    line("whole business.", 1.0, 2.0), // under the hook
    line("I mapped 51", 3.0, 4.0),
    line("workflows and only", 4.1, 5.0),
    line("4 run.", 5.1, 5.8),
    line("It's called HQ.", 8.0, 9.0), // under a cutaway
    line("Every part of", 12.0, 13.0),
    line("the business", 13.1, 14.0),
  ];
  const p = punchWindows(lines, [{ start: 7.5, end: 10 }], { hookEnd: 2.5, duration: 60 });
  assert.ok(p.every((x) => x.start >= 2.5), "never under the hook");
  assert.ok(p.every((x) => !(x.start < 10 && x.end > 7.5)), "never under a cutaway");
  assert.equal(p[0].start, 3.0, "the line with a number goes first");
  for (let i = 1; i < p.length; i++) assert.ok(p[i].start - p[i - 1].end >= 2, "at least 2 s apart");
  assert.deepEqual(p.map((x) => x.zoom).slice(0, 2), [1.18, 1.12], "alternate big and small");
});

test("punch-ins stay under the per-minute cap and never last more than 3 s", () => {
  const lines = Array.from({ length: 40 }, (_, i) => line(`Line ${i} has 9 things`, i * 3, i * 3 + 2.8));
  const p = punchWindows(lines, [], { duration: 30, perMinute: 10 });
  assert.ok(p.length <= 5, `${p.length} punches in 30 s`);
  const long = punchWindows([line("WHOLE BUSINESS runs here", 1, 7)], [], { duration: 60 });
  assert.equal(long[0].end - long[0].start, 3);
  assert.equal(emphatic("the business"), false);
  assert.equal(emphatic("84% of viewers"), true);
  assert.equal(emphatic("Comment HQ"), true);
});

test("the zoom filter aims at the face and is off outside the punches", () => {
  assert.equal(punchFilter([], { w: 1080, h: 1920 }), null);
  const f = punchFilter([{ start: 1, end: 2, zoom: 1.18 }, { start: 5, end: 6.5, zoom: 1.12 }], { w: 1080, h: 1920 }, 0.44)!;
  assert.match(f, /^zoompan=z='1\+0\.18\*between\(it,1,2\)\+0\.12\*between\(it,5,6\.5\)'/);
  assert.match(f, /ih\*0\.44-ih\/zoom\/2/);
  assert.match(f, /s=1080x1920:fps=30$/);
});

test("sound effects: a whoosh leads each cutaway, an impact lands on full-frame cards, no doubles", () => {
  const ev = sfxEvents([{ start: 4, end: 6 }, { start: 2, end: 3, full: true }, { start: 6.2, end: 8 }]);
  assert.deepEqual(ev, [{ at: 2, kind: "impact" }, { at: 3.85, kind: "whoosh" }, { at: 6.05, kind: "whoosh" }]);
  assert.deepEqual(sfxEvents([{ start: 4, end: 5 }, { start: 4.2, end: 6 }]).length, 1, "closer than 0.4 s become one");
  assert.match(SFX_SOURCE.whoosh, /^anoisesrc=/);
  assert.match(SFX_SOURCE.impact, /amix/);
});

test("pacing finds stretches with nothing new and slideshow rhythm", () => {
  const r = pacing([2, 3, 4, 5, 9.5], 12);
  assert.deepEqual(r.still, [{ start: 5, end: 9.5 }]);
  assert.deepEqual(r.equalRuns, [2], "2-3, 3-4 and 4-5 are all 1 s");
  assert.deepEqual(pacing([1, 2.5, 5], 6).equalRuns, []);
  assert.deepEqual(longCaptions([{ text: "short" }, { text: "Instagram, TikTok, YouTube and X today" }]), ["Instagram, TikTok, YouTube and X today"]);
});

test("voice chain, punch and sfx are validated settings", () => {
  assert.match(VOICE_CHAIN, /^highpass=f=80,.*deesser.*acompressor/);
  assert.equal(mergeBrand({ punch: true, sfx: true, voice: "plain" }).punch, true);
  assert.throws(() => mergeBrand({ voice: "loud" as never }), /brand.voice/);
  assert.throws(() => mergeBrand({ sfx: "yes" as never }), /brand.sfx/);
  const base = { business: "acme-co", title: "t", sources: { a: "/x.mp4" }, segments: [{ source: "a", start: 0, end: 1 }], formats: ["vertical"] };
  assert.ok(validateSpec({ ...base, punch: { zoom: 1.2 }, sfx: true, voice: "clean" }).ok);
  const bad = validateSpec({ ...base, punch: { zoom: 2 }, sfx: "on", voice: "x" });
  assert.ok(!bad.ok && bad.errors.length === 3);
});
