// Timeline maths for HQ Studio: words from the transcript, pauses to cut,
// where each kept piece lands in the output, and captions on the output's own
// clock. Pure functions, unit-tested. Client-safe: no node imports.

import type { EditSpec, Format } from "./spec";

export type Word = { w: string; start: number; end: number }; // seconds, source timeline
export type Piece = { source: string; start: number; end: number; outStart: number };

/** Split each segment at pauses longer than `maxPause`, keeping a little air either side.
 *  Pauses come from the audio's own silence (FFmpeg silencedetect) when available: whisper
 *  stretches word end times across silence, so word gaps under-report pauses. */
export function keepPieces(spec: EditSpec, words: Record<string, Word[]>, silences: Record<string, [number, number][]> = {}): Piece[] {
  const maxPause = spec.tightenPauses ?? 0;
  const pad = 0.15; // seconds of air kept either side of a cut
  const out: Piece[] = [];
  let t = 0;
  for (const seg of spec.segments) {
    // Gaps to remove inside this segment, as [start, end] on the source clock.
    let gaps: [number, number][] = [];
    if (maxPause > 0) {
      const sil = silences[seg.source];
      if (sil) gaps = sil.filter(([a, b]) => b - a > maxPause);
      else {
        const ws = (words[seg.source] ?? []).filter((w) => w.end > seg.start && w.start < seg.end);
        for (let i = 1; i < ws.length; i++) if (ws[i].start - ws[i - 1].end > maxPause) gaps.push([ws[i - 1].end, ws[i].start]);
      }
    }
    const ranges: [number, number][] = [];
    let a = seg.start;
    for (const [gs, ge] of gaps.sort((x, y) => x[0] - y[0])) {
      const cutFrom = Math.max(seg.start, gs + pad);
      const cutTo = Math.min(seg.end, ge - pad);
      if (cutTo <= cutFrom || cutFrom <= a) continue;
      ranges.push([a, cutFrom]);
      a = cutTo;
    }
    ranges.push([a, seg.end]);
    for (const [s0, e0] of ranges) {
      if (e0 - s0 < 0.05) continue;
      out.push({ source: seg.source, start: round(s0), end: round(e0), outStart: round(t) });
      t += e0 - s0;
    }
  }
  return out;
}

export const outputDuration = (pieces: Piece[]) =>
  pieces.length ? round(pieces.at(-1)!.outStart + (pieces.at(-1)!.end - pieces.at(-1)!.start)) : 0;

/** Words that survive the cut, re-timed onto the output clock. */
/** Each join between pieces, with the source words said within `span` s of either side of it. */
export function joinsOf(pieces: Piece[], words: Record<string, Word[]>, span = 0.6): Join[] {
  return pieces.slice(1).map((p, i) => {
    const prev = pieces[i];
    const near = (src: string, t: number) => (words[src] ?? []).filter((w) => w.end >= t - span && w.start <= t + span).map((w) => w.w);
    return { at: p.outStart, nearby: [...near(prev.source, prev.end), ...near(p.source, p.start)] };
  });
}

export function outputWords(pieces: Piece[], words: Record<string, Word[]>): Word[] {
  const out: Word[] = [];
  for (const p of pieces) {
    for (const w of words[p.source] ?? []) {
      // whisper can stretch a word across the pause after it: judge it by its first 0.8 s
      const mid = (w.start + Math.min(w.end, w.start + 0.8)) / 2;
      if (mid < p.start || mid > p.end) continue;
      out.push({
        w: w.w,
        start: round(p.outStart + Math.max(0, w.start - p.start)),
        end: round(p.outStart + Math.min(p.end, w.end) - p.start),
      });
    }
  }
  return out;
}

export type CaptionLine = { text: string; start: number; end: number; words?: Word[] };

/** Captions come from re-transcribing the finished cut (so the timing matches what's heard), but a second
 *  pass can mishear a word the source transcript got right ("Or get a message" for "You'll get a message").
 *  Align the two word by word; where a heard word stands one-for-one in place of a different expected word,
 *  use the expected spelling with the heard timing. Extra or missing words are left as heard: only swaps change. */
/** `joins`: where two pieces meet in the output, with the source's own words either side of the join.
 *  A short word the cut's transcript has, the expected list lacks, starting at a join, and not said
 *  anywhere near that join in the source, is a breath or a clipped syllable heard as a word: dropped.
 *  (The expected list can miss a piece's first or last word, so "not expected" alone isn't enough.) */
export type Join = { at: number; nearby: string[] };
export function reconcileWords(heard: Word[], expected: string[], joins: Join[] = []): Word[] {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%']/g, "");
  const a = heard.map((w) => n(w.w));
  const b = expected.map(n);
  // Edit distance table, then walk back from the end choosing match, swap, or skip.
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const out = heard.map((w) => ({ ...w }));
  const drop = new Set<number>();
  const atJoin = (w: Word) => {
    const k = n(w.w);
    return k.length > 0 && k.length <= 3 && joins.some((j) => w.start >= j.at - 0.05 && w.start <= j.at + 0.4 && !j.nearby.map(n).includes(k));
  };
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    const same = a[i - 1] === b[j - 1];
    if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      if (!same) out[i - 1].w = expected[j - 1];
      i--;
      j--;
    } else if (d[i][j] === d[i - 1][j] + 1) {
      if (expected.length && atJoin(heard[i - 1])) drop.add(i - 1);
      i--;
    } else j--;
  }
  return drop.size ? out.filter((_, k) => !drop.has(k)) : out;
}

/** Group words into short caption lines: at most `maxWords`, broken at sentence ends and long gaps.
 *  Each line keeps its words, so the captions can reveal them one at a time. */
export function captionLines(words: Word[], maxWords = 3, maxGap = 0.6): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ text: cur.map((w) => w.w).join(" "), start: cur[0].start, end: cur.at(-1)!.end, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || w.start - cur.at(-1)!.end > maxGap)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.w)) flush();
  }
  flush();
  // No flicker: hold each line until the next one starts (or up to 0.4 s after its last word).
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1]?.start ?? Infinity;
    lines[i].end = round(Math.min(next, lines[i].end + 0.4));
  }
  return lines;
}

/** `pop` (the default): words appear as they're spoken, the current one in the highlight colour with a
 *  quick pop, like CapCut's auto captions. `none`: each line appears whole. */
export type CaptionStyle = { font: string; primary: string; outline: string; highlight: string; animate?: "pop" | "none"; hook?: "text" | "box" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%]/g, "");

/** Where each cutaway sits on the output timeline: from the start of the caption line holding its first
 *  words to the end of the line holding its last words. Searched in order; each after the one before. */
export function cutawayWindows(lines: CaptionLine[], cutaways: readonly { from: string; to: string; [extra: string]: unknown }[]): { start: number; end: number }[] {
  const flat: { t: string; line: number }[] = [];
  lines.forEach((l, i) => (l.words ?? l.text.split(/\s+/).map((w) => ({ w }))).forEach((w) => flat.push({ t: norm(w.w), line: i })));
  const find = (phrase: string, from: number) => {
    const want = phrase.split(/\s+/).map(norm).filter(Boolean);
    for (let i = from; i + want.length <= flat.length; i++) if (want.every((w, k) => flat[i + k].t === w)) return [i, i + want.length - 1];
    return null;
  };
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  cutaways.forEach((c, n) => {
    const a = find(c.from, cursor);
    if (!a) throw new Error(`cutaway ${n + 1}: couldn't find "${c.from}" in what the cut says (after the previous cutaway)`);
    const b = find(c.to, a[0]);
    if (!b) throw new Error(`cutaway ${n + 1}: couldn't find "${c.to}" after "${c.from}"`);
    out.push({ start: lines[flat[a[0]].line].start, end: lines[flat[b[1]].line].end });
    cursor = flat.findIndex((f) => f.line > flat[b[1]].line);
    if (cursor < 0) cursor = flat.length;
  });
  return out;
}

/** An ffmpeg crop that pans across an image from one region to another, easing in and out, keeping the
 *  panel's shape. Regions are [x, y, width] in image pixels. */
export function panCrop(pan: { from: [number, number, number]; to: [number, number, number] }, panel: { w: number; h: number }, seconds: number): string {
  const [x0, y0, w] = pan.from;
  const [x1, y1, w1] = pan.to;
  if (w !== w1) throw new Error("pan: from and to need the same width (the crop size can't change mid-shot)");
  const h = Math.round((w * panel.h) / panel.w);
  const ease = `(3*pow(min(t/${seconds},1),2)-2*pow(min(t/${seconds},1),3))`;
  return `crop=${w}:${h}:'${x0}+(${x1}-${x0})*${ease}':'${y0}+(${y1}-${y0})*${ease}'`;
}

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** "#RRGGBB" -> ASS "&H00BBGGRR". */
export const assColour = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad colour ${hex}`);
  return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase();
};

/** No em or en dashes on screen, ever (the owner's rule): an em dash becomes a comma, an en dash a hyphen. */
export const noDashes = (t: string) => t.replace(/\s*\u2014\s*/g, ", ").replace(/\u2013/g, "-");
const escapeAss = (t: string) => noDashes(t).replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");

/** One caption line as a run of events, one per word. Words not yet spoken are fully transparent but still
 *  laid out, so the line never shifts; spoken words are in the primary colour; the current word is in the
 *  highlight colour and pops from 125% to full size. */
function popEvents(line: CaptionLine, style: CaptionStyle): string[] {
  const words = line.words!;
  const primary = `\\1c${assColour(style.primary)}&`;
  const highlight = `\\1c${assColour(style.highlight)}&`;
  const events: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const start = i === 0 ? line.start : words[i].start;
    const end = i < words.length - 1 ? words[i + 1].start : line.end;
    if (end <= start) continue;
    const text = words
      .map((w, j) => {
        const word = escapeAss(w.w.toUpperCase());
        if (j < i) return `{${primary}\\alpha&H00&}${word}`;
        if (j > i) return `{\\alpha&HFF&}${word}`;
        return `{${highlight}\\alpha&H00&\\fscx125\\fscy125\\t(0,110,\\fscx100\\fscy100)}${word}`;
      })
      .join(" ");
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`);
  }
  return events;
}

/** How far from the top the hook starts. Vertical: just inside the 3:4 tile Instagram and TikTok crop a
 *  9:16 video to on the profile grid (they hide (h - w*4/3)/2 px above it), so the hook shows there too. */
export function hookTop(format: { w: number; h: number }, fallback: number): number {
  const { w, h } = format;
  if (h <= w) return Math.round(h * fallback);
  return Math.round((h - (w * 4) / 3) / 2 + h * 0.035);
}

/** The hook's style: "box" puts dark words on a filled highlight box; "text" is big outlined words. */
function hookStyleLine(style: CaptionStyle, format: { w: number; h: number }, hookSize: number): string {
  const { w, h } = format;
  if ((style.hook ?? "box") === "box")
    return `Style: Hook,${style.font},${hookSize},${assColour(style.outline)},${assColour(style.outline)},${assColour(style.highlight)},${assColour(style.highlight)},-1,0,0,0,100,100,0,0,3,${Math.round(hookSize / 4)},0,8,${Math.round(w * 0.07)},${Math.round(w * 0.07)},${hookTop(format, 0.1)},1`;
  const size = Math.round(Math.min(w, h) * 0.092);
  return `Style: Hook,${style.font},${size},${assColour(style.primary)},${assColour(style.primary)},${assColour(style.outline)},&H64000000,-1,0,0,0,100,100,0,0,1,${Math.round(size / 7)},4,8,${Math.round(w * 0.06)},${Math.round(w * 0.06)},${hookTop(format, 0.09)},1`;
}

/** The hook's text: a box hook is plain; a text hook pops in, fades out, and colours `highlight`. */
function hookText(hook: { text: string; highlight?: string }, style: CaptionStyle): string {
  const text = escapeAss(hook.text);
  if ((style.hook ?? "box") === "box") return text;
  let body = text;
  const hl = hook.highlight ? escapeAss(hook.highlight) : "";
  const at = hl ? text.toLowerCase().indexOf(hl.toLowerCase()) : -1;
  if (at >= 0)
    body = `${text.slice(0, at)}{\\1c${assColour(style.highlight)}&}${text.slice(at, at + hl.length)}{\\1c${assColour(style.primary)}&}${text.slice(at + hl.length)}`;
  return `{\\fad(0,200)\\fscx70\\fscy70\\t(0,160,\\fscx100\\fscy100)}${body}`;
}

/** An ASS subtitle file: bold word-group captions in the lower third, and the hook up top.
 *  `seams`: output windows (cutaways) where captions move to the middle of the frame, on the seam
 *  between the screen footage and the face. */
export function buildAss(
  format: { w: number; h: number },
  lines: CaptionLine[],
  style: CaptionStyle,
  hook?: { text: string; seconds?: number; highlight?: string },
  opts: { seams?: { start: number; end: number }[] | [number, number][] } = {},
): string {
  const { w, h } = format;
  const size = Math.round(Math.min(w, h) * 0.075);
  const hookSize = Math.round(Math.min(w, h) * 0.068);
  const marginV = Math.round(h * (h > w ? 0.28 : 0.12));
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${style.font},${size},${assColour(style.primary)},${assColour(style.highlight)},${assColour(style.outline)},&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(size / 9)},2,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${marginV},1
${hookStyleLine(style, format, hookSize)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const pop = (style.animate ?? "pop") === "pop";
  const seams = (opts.seams ?? []).map((s) => (Array.isArray(s) ? { start: s[0], end: s[1] } : s));
  const onSeam = (t: number) => seams.some((s) => t >= s.start - 0.001 && t < s.end - 0.001);
  const events = lines
    .flatMap((l) =>
      pop && l.words?.length
        ? popEvents(l, style)
        : [`Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Caption,,0,0,0,,${escapeAss(l.text.toUpperCase())}`],
    )
    .map((e) => {
      const f = e.split(",");
      const [hh, mm, ss] = f[1].split(":");
      const t = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
      if (!onSeam(t)) return e;
      const at = e.indexOf(",,0,0,0,,") + ",,0,0,0,,".length;
      return `${e.slice(0, at)}{\\an5\\pos(${Math.round(w / 2)},${Math.round(h / 2)})}${e.slice(at)}`;
    });
  if (hook) events.unshift(`Dialogue: 1,${assTime(0)},${assTime(hook.seconds ?? 3)},Hook,,0,0,0,,${hookText(hook, style)}`);
  return header + events.join("\n") + "\n";
}

/** The ffmpeg video filter that fits a source into the format. */
export function reframeFilter(
  src: { w: number; h: number },
  fmt: Format,
  dims: { w: number; h: number },
  mode: "crop" | "fit-blur",
  focusX = 0.5,
  tag = "", // keeps filter labels unique when several pieces are reframed in one graph
): string {
  const { w, h } = dims;
  const srcAspect = src.w / src.h;
  const dstAspect = w / h;
  if (Math.abs(srcAspect - dstAspect) < 0.01) return `scale=${w}:${h}`;
  if (mode === "crop") {
    if (srcAspect > dstAspect) {
      // too wide: scale to height, crop width around focusX
      const sw = Math.round((src.w * h) / src.h / 2) * 2;
      const x = Math.max(0, Math.min(sw - w, Math.round(sw * focusX - w / 2)));
      return `scale=${sw}:${h},crop=${w}:${h}:${x}:0`;
    }
    const sh = Math.round((src.h * w) / src.w / 2) * 2;
    return `scale=${w}:${sh},crop=${w}:${h}:0:${Math.round((sh - h) / 2)}`;
  }
  // fit-blur: blurred, filled background with the whole frame fitted on top
  void fmt;
  return `split=2[bg${tag}][fg${tag}];[bg${tag}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:5,eq=brightness=-0.08[bgb${tag}];[fg${tag}]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs${tag}];[bgb${tag}][fgs${tag}]overlay=(W-w)/2:(H-h)/2`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
