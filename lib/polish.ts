// The finishing pass that makes a talking-head cut feel edited: a voice chain, punch-ins on the lines that
// matter, sound effects on the cards, and pacing checks. Pure and client-safe; scripts/studio.ts runs the
// filters. Rules adopted (as methods, not code) from editing craft guides: a punch-in is 1.15 to 1.25x on a
// claim or a number, 6 to 12 a minute, never two in a row; a whoosh starts just before a card and peaks on
// the cut, an impact lands on a full-frame card, both 6 to 10 dB under the voice; nothing static over 3 s.

import type { CaptionLine } from "./timeline";

/** Voice chain before levelling: rumble out (80 Hz), less boxiness (500 Hz), presence (3.5 kHz), softer
 *  esses, gentle 3:1 compression. loudnorm then takes it to the target and caps the true peak. */
export const VOICE_CHAIN = [
  "highpass=f=80",
  "equalizer=f=500:t=q:w=1.0:g=-3",
  "equalizer=f=3500:t=q:w=1.2:g=2.5",
  "deesser=i=0.4:m=0.5:f=0.5:s=o",
  "acompressor=threshold=-20dB:ratio=3:attack=10:release=150:makeup=2",
].join(",");

export type Window = { start: number; end: number };
export type Punch = Window & { zoom: number };

const overlaps = (a: Window, b: Window) => a.start < b.end && b.start < a.end;
/** A line worth punching: a number, money, a percentage, or a word in capitals (a keyword). */
export const emphatic = (text: string) => /\d|\$|%/.test(text) || /\b[A-Z]{2,}\b/.test(text);

/**
 * Punch-ins for the stretches where only the face is on screen. A punch covers one caption line (cut to it,
 * hold, cut back), prefers lines with a number or a keyword, alternates 1.18x and 1.12x, sits at least
 * `gap` seconds after the last one, never covers the hook or a cutaway, and stays under `perMinute`.
 */
export function punchWindows(
  lines: CaptionLine[],
  covered: Window[],
  opts: { hookEnd?: number; duration: number; perMinute?: number; gap?: number; zoom?: number; minLine?: number },
): Punch[] {
  const hookEnd = opts.hookEnd ?? 0;
  const max = Math.max(1, Math.floor(((opts.perMinute ?? 10) * opts.duration) / 60));
  const gap = opts.gap ?? 2;
  const big = opts.zoom ?? 1.18;
  const small = Math.round((1 + (big - 1) * 0.66) * 100) / 100;
  const free = lines.filter(
    (l) => l.start >= hookEnd && l.end - l.start >= (opts.minLine ?? 0.6) && !covered.some((c) => overlaps(l, c)),
  );
  // Emphatic lines first, then the rest, each in time order; then place greedily with the spacing rule.
  const ranked = [...free.filter((l) => emphatic(l.text)), ...free.filter((l) => !emphatic(l.text))];
  const chosen: Window[] = [];
  for (const l of ranked) {
    if (chosen.length >= max) break;
    const w = { start: l.start, end: Math.min(l.end, l.start + 3) };
    if (chosen.some((c) => overlaps(w, { start: c.start - gap, end: c.end + gap }))) continue;
    chosen.push(w);
  }
  return chosen.sort((a, b) => a.start - b.start).map((w, i) => ({ ...w, zoom: i % 2 ? small : big }));
}

/** zoompan for the punches: aims at the face's height (faceY 0..1), centred left to right. */
export function punchFilter(punches: Punch[], dims: { w: number; h: number }, faceY = 0.5): string | null {
  if (!punches.length) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const z = `1${punches.map((p) => `+${r(p.zoom - 1)}*between(it,${r(p.start)},${r(p.end)})`).join("")}`;
  return `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='min(max(ih*${r(faceY)}-ih/zoom/2,0),ih-ih/zoom)':d=1:s=${dims.w}x${dims.h}:fps=30`;
}

export type Sfx = { at: number; kind: "whoosh" | "impact" };

/** A whoosh into every cutaway (starting 0.15 s early so it peaks on the cut), an impact on full-frame cards.
 *  Two sounds closer than 0.4 s become one. */
export function sfxEvents(cutaways: (Window & { full?: boolean })[]): Sfx[] {
  const ev: Sfx[] = [];
  for (const c of [...cutaways].sort((a, b) => a.start - b.start)) {
    const e: Sfx = c.full ? { at: c.start, kind: "impact" } : { at: Math.max(0, c.start - 0.15), kind: "whoosh" };
    if (ev.length && e.at - ev[ev.length - 1].at < 0.4) continue;
    ev.push(e);
  }
  return ev;
}

/** lavfi sources for our own sound effects, synthesised so there's nothing to license. */
export const SFX_SOURCE: Record<Sfx["kind"], string> = {
  whoosh:
    "anoisesrc=color=pink:duration=0.42:amplitude=0.9:seed=7,highpass=f=350,lowpass=f=5200," +
    "afade=t=in:st=0:d=0.15:curve=exp,afade=t=out:st=0.15:d=0.27:curve=qsin,volume=-9dB",
  impact:
    "sine=frequency=58:duration=0.55,afade=t=out:st=0.02:d=0.5:curve=exp,volume=2dB[lo];" +
    "anoisesrc=color=brown:duration=0.08:amplitude=0.8:seed=3,lowpass=f=1800,afade=t=out:d=0.08[hit];" +
    "[lo][hit]amix=inputs=2:normalize=0,volume=-8dB",
};

/** Shots from scene cuts: stretches with nothing new on screen for more than `still` seconds, and runs of
 *  three shots of the same length (within 0.2 s), which read as a slideshow. Times at playback speed. */
export function pacing(cuts: number[], duration: number, still = 3): { still: Window[]; equalRuns: number[] } {
  const t = [0, ...cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b), duration];
  const shots = t.slice(1).map((e, i) => ({ start: t[i], end: e }));
  const longs = shots.filter((s) => s.end - s.start > still).map((s) => ({ start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10 }));
  const equalRuns: number[] = [];
  for (let i = 0; i + 2 < shots.length; i++) {
    const [a, b, c] = shots.slice(i, i + 3).map((s) => s.end - s.start);
    if (Math.abs(a - b) <= 0.2 && Math.abs(b - c) <= 0.2 && a > 0.5) equalRuns.push(Math.round(shots[i].start * 10) / 10);
  }
  return { still: longs, equalRuns };
}

/** Caption lines over 30 characters (two lines of a phone screen at most). */
export const longCaptions = (lines: { text: string }[], max = 30) => lines.filter((l) => l.text.length > max).map((l) => l.text);
