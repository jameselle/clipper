import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { concatArgs, keptTakeFiles, readTakes } from "../lib/teleprompter";

/** A teleprompter script folder: { section: { takes: [...], check?: {...} } } plus choices. */
function script(sections: Record<string, { takes: string[]; checks?: Record<string, object> }>, choices: Record<string, string> | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-tp-"));
  for (const [name, s] of Object.entries(sections)) {
    fs.mkdirSync(path.join(dir, name, "_discarded"), { recursive: true });
    for (const t of s.takes) {
      fs.writeFileSync(path.join(dir, name, t), "video");
      const check = s.checks?.[t] ?? { ok: true, problems: [] };
      fs.writeFileSync(path.join(dir, name, t.replace(/\.mp4$/, ".json")), JSON.stringify(check));
    }
    fs.writeFileSync(path.join(dir, name, "_discarded", "take-99.mp4"), "old");
  }
  if (choices) fs.writeFileSync(path.join(dir, "choices.json"), JSON.stringify(choices));
  return dir;
}

test("kept takes come back in section-number order, not string order", () => {
  const dir = script(
    { "10-close": { takes: ["take-01.mp4"] }, "9-middle": { takes: ["take-02.mp4"] }, "01-open": { takes: ["take-01.mp4", "take-03.mp4"] } },
    { "10-close": "take-01.mp4", "9-middle": "take-02.mp4", "01-open": "take-03.mp4" },
  );
  const r = readTakes(dir);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sections.map((s) => s.section), ["01-open", "9-middle", "10-close"]);
  assert.equal(r.sections[0].file, path.join(dir, "01-open", "take-03.mp4"));
});

test("refuses a missing take, an unchosen section and a choice with no section", () => {
  const dir = script(
    { "01-open": { takes: ["take-01.mp4"] }, "02-middle": { takes: ["take-01.mp4"] }, "03-close": { takes: ["take-01.mp4"] } },
    { "01-open": "take-07.mp4", "03-close": "take-01.mp4", "04-ghost": "take-01.mp4" },
  );
  const r = readTakes(dir);
  assert.equal(r.problems.length, 3, r.problems.join("\n"));
  assert.ok(r.problems.some((p) => /01-open.*take-07\.mp4/.test(p)));
  assert.ok(r.problems.some((p) => /02-middle.*no take chosen/.test(p)));
  assert.ok(r.problems.some((p) => /04-ghost/.test(p)));
});

test("a chosen take that failed its own check is a warning with the reasons", () => {
  const dir = script({ "01-open": { takes: ["take-01.mp4"], checks: { "take-01.mp4": { ok: false, problems: ["audio is silent"] } } } }, { "01-open": "take-01.mp4" });
  const r = readTakes(dir);
  assert.deepEqual(r.problems, []);
  assert.match(r.warnings.join(" "), /01-open.*audio is silent/);
});

test("no choices.json is a problem, not a crash", () => {
  const dir = script({ "01-open": { takes: ["take-01.mp4"] } }, null);
  assert.match(readTakes(dir).problems.join(" "), /choices\.json/);
});

test("concat: every take is normalised and joined in order into one portrait master", () => {
  const args = concatArgs(["/a/1.mp4", "/a/2.mp4", "/a/3.mp4"], "/job/master.mp4");
  assert.deepEqual(args.filter((a, i) => args[i - 1] === "-i"), ["/a/1.mp4", "/a/2.mp4", "/a/3.mp4"]);
  const fc = args[args.indexOf("-filter_complex") + 1];
  assert.match(fc, /concat=n=3:v=1:a=1/);
  assert.match(fc, /scale=1080:1920/);
  assert.equal(args.at(-1), "/job/master.mp4");
});

test("backup list: choices, kept takes and their checks — never discards or unchosen takes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-tp-root-"));
  const a = script({ "01-open": { takes: ["take-01.mp4", "take-02.mp4"] } }, { "01-open": "take-02.mp4" });
  fs.renameSync(a, path.join(root, "1-day-one"));
  fs.mkdirSync(path.join(root, "no-choices-yet", "01-x"), { recursive: true });
  const files = keptTakeFiles(root).map((f) => path.relative(root, f)).sort();
  assert.deepEqual(files, ["1-day-one/01-open/take-02.json", "1-day-one/01-open/take-02.mp4", "1-day-one/choices.json"]);
  assert.deepEqual(keptTakeFiles(path.join(root, "missing")), []);
});

test("concat drops the phone's rotation tag: the joined video is upright AND untagged, so nothing rotates it twice", (t) => {
  const has = (bin: string) => spawnSync(bin, ["-version"]).status === 0;
  if (!has("ffmpeg") || !has("ffprobe")) return t.skip("ffmpeg not installed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-rot-"));
  // A phone-style take: frames stored landscape (1920x1080) with a -90 display tag, like iPhone Safari's.
  const flat = path.join(dir, "flat.mp4");
  const take = path.join(dir, "take.mp4");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", flat]);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-display_rotation:v:0", "90", "-i", flat, "-c", "copy", take]);
  const probe = (f: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation", "-of", "json", f], { encoding: "utf8" }).stdout).streams[0];
  assert.ok(probe(take).side_data_list?.some((s: { rotation?: number }) => s.rotation), "fixture carries a rotation tag");
  const master = path.join(dir, "master.mp4");
  const r = spawnSync("ffmpeg", concatArgs([take, take], master), { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = probe(master);
  assert.deepEqual([out.width, out.height], [1080, 1920]);
  assert.ok(!out.side_data_list?.some((s: { rotation?: number }) => s.rotation), "the joined master must not carry a rotation tag");
  fs.rmSync(dir, { recursive: true, force: true });
});
