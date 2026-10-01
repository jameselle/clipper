// HQ Studio's edit description: everything a render needs, as data. Skills
// write it; scripts/studio.ts renders it with FFmpeg. Keeping the edit as a
// plain file (not an editor project) means another renderer (e.g. OpenCut's
// planned headless mode) can be added later without touching the skills.
// Client-safe: no node imports.

export const FORMATS = {
  vertical: { w: 1080, h: 1920, use: "Reels, TikTok, Shorts" },
  square: { w: 1080, h: 1080, use: "feed posts" },
  landscape: { w: 1920, h: 1080, use: "YouTube" },
} as const;
export type Format = keyof typeof FORMATS;

export type Segment = { source: string; start: number; end: number };

/** Screen footage over the voice: on a vertical video it fills the top half while the face moves to the
 *  bottom half. It covers the caption lines from the one holding `from` to the one holding `to`, matched
 *  against what the finished cut actually says, so it lands on the words even after pauses are removed. */
export type Cutaway = {
  /** Absolute path: an image (png, jpg, webp) or a video. */
  file: string;
  from: string;
  to: string;
  /** Images only: pan from one region to another, each [x, y, width] in image pixels, same width
   *  (the height follows the panel's shape). Without it, the image is scaled to fill the panel. */
  pan?: { from: [number, number, number]; to: [number, number, number] };
  /** Vertical only: fill the whole frame instead of the top half, e.g. a title card covering a change of shot.
   *  Captions stay in their usual place. */
  full?: boolean;
};

export type EditSpec = {
  /** Optional label; clipper doesn't use it. */
  business?: string;
  title: string;
  /** Source id -> absolute file path. */
  sources: Record<string, string>;
  /** Played in order. Times in seconds on the source's own timeline. */
  segments: Segment[];
  formats: Format[];
  /** How a source that doesn't match the format's shape is fitted. */
  reframe?: "crop" | "fit-blur";
  /** Horizontal crop centre, 0 (left) .. 1 (right), for reframe=crop. Default 0.5. */
  focusX?: number;
  /** Remove pauses longer than this many seconds inside segments (0 = keep all). */
  tightenPauses?: number;
  captions?: boolean;
  /** Big text on screen for the first seconds: the hook. */
  hook?: { text: string; seconds?: number; highlight?: string };
  /** Screen footage over the voice (see Cutaway). */
  cutaways?: Cutaway[];
  /** Vertical centre of the face, 0 (top) .. 1 (bottom), for the bottom half during cutaways. Default 0.5. */
  faceY?: number;
  /** Music bed under the voice; must be licensed for the use (never MusicGen for monetised posts). */
  music?: { file: string; volume?: number };
  /** Loudness target in LUFS; social platforms sit around -14. */
  loudness?: number;
  /** Play the finished video faster (or slower): 1.5 posts at 1.5x. Voice keeps its pitch. Default 1. */
  speed?: number;
};

export type SpecResult = { ok: true; spec: EditSpec } | { ok: false; errors: string[] };

export function validateSpec(raw: unknown): SpecResult {
  const errors: string[] = [];
  const s = raw as EditSpec;
  if (!s || typeof s !== "object") return { ok: false, errors: ["spec must be an object"] };
  if (typeof s.title !== "string" || !s.title.trim()) errors.push("title: required");
  if (!s.sources || typeof s.sources !== "object") errors.push("sources: { id: absolute path }");
  else for (const [id, p] of Object.entries(s.sources)) if (typeof p !== "string" || !p.startsWith("/")) errors.push(`sources.${id}: absolute path`);
  if (!Array.isArray(s.segments) || s.segments.length === 0) errors.push("segments: at least one");
  else
    s.segments.forEach((g, i) => {
      if (!s.sources?.[g.source]) errors.push(`segments[${i}].source: unknown source "${g.source}"`);
      if (!(typeof g.start === "number" && typeof g.end === "number" && g.start >= 0 && g.end > g.start))
        errors.push(`segments[${i}]: needs 0 <= start < end (seconds)`);
    });
  if (!Array.isArray(s.formats) || !s.formats.length || !s.formats.every((f) => f in FORMATS))
    errors.push(`formats: one or more of ${Object.keys(FORMATS).join(", ")}`);
  if (s.reframe !== undefined && !["crop", "fit-blur"].includes(s.reframe)) errors.push("reframe: crop | fit-blur");
  if (s.focusX !== undefined && !(s.focusX >= 0 && s.focusX <= 1)) errors.push("focusX: 0..1");
  if (s.tightenPauses !== undefined && !(s.tightenPauses >= 0)) errors.push("tightenPauses: seconds >= 0");
  if (s.hook !== undefined && (typeof s.hook.text !== "string" || !s.hook.text.trim())) errors.push("hook.text: required when hook is set");
  if (s.music !== undefined && (typeof s.music.file !== "string" || !s.music.file.startsWith("/"))) errors.push("music.file: absolute path");
  if (s.faceY !== undefined && !(s.faceY >= 0 && s.faceY <= 1)) errors.push("faceY: 0..1");
  if (s.speed !== undefined && !(typeof s.speed === "number" && s.speed >= 0.5 && s.speed <= 3)) errors.push("speed: a number from 0.5 to 3");
  if (s.cutaways !== undefined) {
    if (!Array.isArray(s.cutaways)) errors.push("cutaways: a list");
    else
      s.cutaways.forEach((c, i) => {
        if (typeof c?.file !== "string" || !c.file.startsWith("/")) errors.push(`cutaways[${i}].file: absolute path`);
        if (typeof c?.from !== "string" || !c.from.trim()) errors.push(`cutaways[${i}].from: the words it starts on`);
        if (typeof c?.to !== "string" || !c.to.trim()) errors.push(`cutaways[${i}].to: the words it ends on`);
        const box = (b: unknown) => Array.isArray(b) && b.length === 3 && b.every((n) => typeof n === "number" && n >= 0) && (b[2] as number) > 0;
        if (c?.pan !== undefined && !(box(c.pan.from) && box(c.pan.to))) errors.push(`cutaways[${i}].pan: { from: [x, y, width], to: [x, y, width] }`);
        if (c?.full !== undefined && typeof c.full !== "boolean") errors.push(`cutaways[${i}].full: true or false`);
      });
  }
  return errors.length ? { ok: false, errors } : { ok: true, spec: s };
}
