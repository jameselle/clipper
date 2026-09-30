// Takes from the free iPhone teleprompter (github.com/jameselle/teleprompter) as clipper input.
// A script folder holds one folder per section (NN-name/take-NN.mp4 + take-NN.json, the take's
// own check) and choices.json, section -> the take the owner kept. Discards live in _discarded/.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where the teleprompter saves takes (its default), and its app folder with the git-ignored scripts. */
export const TELEPROMPTER_TAKES = process.env.TELEPROMPTER_OUT || path.join(os.homedir(), "Movies", "Teleprompter");
export const TELEPROMPTER_APP = process.env.TELEPROMPTER_APP || path.join(os.homedir(), "teleprompter");

export type KeptTake = { section: string; take: string; file: string; duration?: number };
export type Takes = { sections: KeptTake[]; problems: string[]; warnings: string[] };

const order = (name: string) => {
  const n = /^(\d+)/.exec(name);
  return n ? Number(n[1]) : Number.MAX_SAFE_INTEGER;
};
const bySection = (a: string, b: string) => order(a) - order(b) || a.localeCompare(b);

function readChoices(dir: string): Record<string, string> | null {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, "choices.json"), "utf8")) as unknown;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, string>) : null;
  } catch {
    return null;
  }
}

const hasTakes = (sectionDir: string) => fs.readdirSync(sectionDir).some((f) => /^take-.*\.mp4$/.test(f));

/** The kept take of every section, in script order. `problems` block an import; `warnings` don't. */
export function readTakes(dir: string): Takes {
  const problems: string[] = [];
  const warnings: string[] = [];
  const choices = readChoices(dir);
  if (!choices) return { sections: [], problems: [`${path.join(dir, "choices.json")} is missing or unreadable: keep a take for each section in the teleprompter Studio first`], warnings };
  const sectionDirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".") && hasTakes(path.join(dir, e.name)))
    .map((e) => e.name);
  for (const s of sectionDirs) if (!(s in choices)) problems.push(`${s}: no take chosen`);
  const sections: KeptTake[] = [];
  for (const section of Object.keys(choices).sort(bySection)) {
    const take = choices[section];
    const file = path.join(dir, section, take);
    if (!sectionDirs.includes(section)) {
      problems.push(`${section}: chosen in choices.json but there's no section folder with takes`);
      continue;
    }
    if (!fs.existsSync(file)) {
      problems.push(`${section}: chosen take ${take} doesn't exist`);
      continue;
    }
    let duration: number | undefined;
    try {
      const check = JSON.parse(fs.readFileSync(file.replace(/\.mp4$/, ".json"), "utf8")) as { ok?: boolean; problems?: string[]; duration?: number };
      duration = check.duration;
      if (check.ok === false) warnings.push(`${section}: ${take} failed its check (${(check.problems ?? []).join("; ") || "no reason given"})`);
    } catch {
      warnings.push(`${section}: ${take} has no check file`);
    }
    sections.push({ section, take, file, duration });
  }
  return { sections, problems, warnings };
}

/** FFmpeg arguments that normalise each take (upright 1080x1920, square pixels, 30 fps, 48 kHz
 *  stereo) and join them in order. Differing phone settings between takes would otherwise break concat. */
export function concatArgs(files: string[], out: string): string[] {
  const parts = files
    .map(
      (_, i) =>
        // ffmpeg turns each take upright but keeps the phone's rotation tag on the output; players would
        // then rotate it a second time (sideways video). The frames are already upright, so drop the tag.
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,sidedata=mode=delete:type=DISPLAYMATRIX[v${i}];` +
        `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`,
    )
    .join("");
  const chain = files.map((_, i) => `[v${i}][a${i}]`).join("");
  return [
    "-v", "error", "-y",
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex", `${parts}${chain}concat=n=${files.length}:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    out,
  ];
}

/** For the nightly backup: every script folder's choices.json, kept takes and their checks.
 *  Discarded and unchosen takes are left out on purpose (the owner chose). */
export function keptTakeFiles(root: string = TELEPROMPTER_TAKES): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const choices = readChoices(dir);
    if (!choices) continue;
    out.push(path.join(dir, "choices.json"));
    for (const [section, take] of Object.entries(choices)) {
      const file = path.join(dir, section, take);
      if (!fs.existsSync(file)) continue;
      out.push(file);
      const check = file.replace(/\.mp4$/, ".json");
      if (fs.existsSync(check)) out.push(check);
    }
  }
  return out;
}
