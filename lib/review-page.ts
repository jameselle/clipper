// The review page served by serveReview (review.ts): one self-contained HTML file, no build step,
// shared as-is between HQ and the clipper.

export const REVIEW_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<style>
  :root { --bg:#070b14; --surface:#0e1424; --surface2:#161f33; --hi:#141c33; --border:#1f2940; --fg:#e9eef8; --muted:#8b94ab; --dim:#586079;
          --blue:#5ab0f0; --green:#22c55e; --amber:#f59e0b; --red:#ef4444; --yellow:#ffd60a; }
  * { box-sizing:border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Helvetica,Arial; }
  button { font:inherit; color:inherit; background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:6px 10px; cursor:pointer; }
  button:hover { border-color:#2c3a5c; background:var(--hi); }
  button.primary { background:rgba(90,176,240,.14); border-color:rgba(90,176,240,.45); color:#cfe7fb; }
  button.ghost { background:transparent; border-color:transparent; color:var(--muted); padding:4px 6px; }
  button.ghost:hover { color:var(--fg); background:var(--hi); }
  kbd { font:11px ui-monospace,Menlo,monospace; background:var(--surface2); border:1px solid var(--border); border-bottom-width:2px; border-radius:5px; padding:0 5px; color:var(--muted); }
  .eyebrow { font:10px ui-monospace,Menlo,monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
  .app { display:grid; grid-template-columns:280px minmax(0,1fr) 380px; height:100vh; }
  aside, section.notes { background:var(--surface); border-right:1px solid var(--border); display:flex; flex-direction:column; min-height:0; }
  section.notes { border-right:0; border-left:1px solid var(--border); }
  .head { padding:14px 14px 10px; border-bottom:1px solid var(--border); }
  .head h1 { font-size:15px; margin:2px 0 8px; font-weight:600; }
  input[type=search], textarea { width:100%; background:var(--bg); color:var(--fg); border:1px solid var(--border); border-radius:8px; padding:7px 9px; font:inherit; }
  textarea { resize:vertical; min-height:74px; }
  input:focus, textarea:focus { outline:none; border-color:rgba(90,176,240,.6); }
  .list { overflow:auto; padding:6px; flex:1; }
  .folder { margin:10px 8px 4px; }
  .vid { display:flex; align-items:center; gap:8px; width:100%; text-align:left; background:transparent; border:1px solid transparent; border-radius:8px; padding:6px 8px; color:var(--muted); }
  .vid:hover { background:var(--hi); color:var(--fg); }
  .vid.on { background:rgba(90,176,240,.1); border-color:rgba(90,176,240,.3); color:var(--fg); }
  .vid .n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pill { font:10px ui-monospace,Menlo,monospace; border-radius:999px; padding:1px 7px; border:1px solid; white-space:nowrap; }
  .pill.open { color:var(--amber); border-color:rgba(245,158,11,.4); background:rgba(245,158,11,.1); }
  .pill.done { color:var(--green); border-color:rgba(34,197,94,.35); background:rgba(34,197,94,.08); }
  .pill.old { color:var(--muted); border-color:var(--border); }
  .toggle { display:flex; gap:6px; align-items:center; color:var(--muted); margin-top:8px; font-size:12px; }
  main { display:flex; flex-direction:column; align-items:center; padding:14px; gap:10px; min-width:0; min-height:0; }
  .stage { flex:1; min-height:0; width:100%; display:flex; justify-content:center; align-items:center; }
  video { max-height:100%; max-width:100%; background:#000; border-radius:10px; border:1px solid var(--border); }
  .empty { color:var(--dim); text-align:center; max-width:46ch; }
  .bar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:center; }
  .time { font:13px ui-monospace,Menlo,monospace; color:var(--muted); min-width:120px; text-align:center; }
  .help { color:var(--dim); font-size:11.5px; text-align:center; }
  .compose { padding:12px 14px; border-bottom:1px solid var(--border); display:none; gap:8px; flex-direction:column; background:var(--surface2); }
  .compose.on { display:flex; }
  .compose img { width:100%; max-height:200px; object-fit:contain; background:#000; border-radius:8px; }
  .row { display:flex; gap:8px; align-items:center; justify-content:space-between; }
  .note { border:1px solid var(--border); border-radius:10px; padding:9px; margin:8px; background:var(--bg); }
  .note.fixed { opacity:.62; }
  .note .t { font:12px ui-monospace,Menlo,monospace; color:var(--blue); background:transparent; border:0; padding:0; }
  .note .t:hover { text-decoration:underline; background:transparent; }
  .note .txt { margin:6px 0; white-space:pre-wrap; }
  .note .cap { color:var(--muted); font-size:11.5px; }
  .note img { width:72px; height:128px; object-fit:cover; border-radius:6px; float:right; margin-left:8px; background:#000; cursor:pointer; }
  .note .acts { display:flex; gap:4px; clear:both; padding-top:4px; }
  .claude { margin:8px; padding:10px; border:1px dashed var(--border); border-radius:10px; color:var(--muted); font-size:12px; }
  .claude code { color:var(--fg); }
  .toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:var(--surface2); border:1px solid var(--border); padding:8px 14px; border-radius:10px; display:none; }
  @media (max-width: 1100px) { .app { grid-template-columns:220px minmax(0,1fr) 320px; } }
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="head">
      <div class="eyebrow">Studio</div>
      <h1>{{TITLE}}</h1>
      <input type="search" id="q" placeholder="Find a video">
      <label class="toggle"><input type="checkbox" id="rendersOnly" checked> Edited renders only</label>
    </div>
    <div class="list" id="videos"></div>
  </aside>

  <main>
    <div class="stage" id="stage"><div class="empty">Pick a video on the left. Watch it, and whenever something looks wrong, press <kbd>N</kbd> and say what you see.</div></div>
    <div class="bar" id="controls" hidden>
      <button id="back5" title="Back 5 s (Shift ←)">−5s</button>
      <button id="prevFrame" title="Previous frame (,)">‹ frame</button>
      <button id="play" title="Play / pause (Space)">Play</button>
      <button id="nextFrame" title="Next frame (.)">frame ›</button>
      <button id="fwd5" title="Forward 5 s (Shift →)">+5s</button>
      <span class="time" id="time">0:00.0</span>
      <button id="speed" title="Playback speed">1×</button>
      <button class="primary" id="addNote" title="Note at this moment (N)">+ Note here</button>
    </div>
    <div class="help" id="help" hidden><kbd>Space</kbd> play/pause · <kbd>N</kbd> note · <kbd>←</kbd><kbd>→</kbd> 1 s · <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> 5 s · <kbd>,</kbd><kbd>.</kbd> one frame</div>
  </main>

  <section class="notes">
    <div class="head">
      <div class="eyebrow">Notes</div>
      <h1 id="notesTitle">No video</h1>
      <div class="row"><span id="counts" class="eyebrow"></span><label class="toggle" style="margin:0"><input type="checkbox" id="showFixed"> show fixed</label></div>
    </div>
    <div class="compose" id="compose">
      <div class="row"><span class="eyebrow" id="composeAt"></span><span class="eyebrow" id="composeCap"></span></div>
      <img id="composeImg" alt="">
      <textarea id="composeText" placeholder="What looks wrong here? e.g. caption covers the graphic, cut too early, wrong screenshot…"></textarea>
      <div class="row"><span class="help"><kbd>Enter</kbd> save · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>Esc</kbd> cancel</span>
        <span><button id="cancelNote">Cancel</button> <button class="primary" id="saveNote">Save</button></span></div>
    </div>
    <div class="list" id="notes"></div>
    <div class="claude" id="claude" hidden>Done watching? Tell Claude: <code id="claudeCmd"></code></div>
  </section>
</div>
<div class="toast" id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
const FPS = 30;
let videos = [], current = null, notes = [], pendingFrame = null, pendingT = 0, speedIdx = 1;
const SPEEDS = [0.5, 1, 1.5, 2];
const RENDER = /-(vertical|landscape|square)\.mp4$/i;

const clock = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0"); };
const toast = (msg) => { const el = $("toast"); el.textContent = msg; el.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = "none", 2200); };
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) if (k != null) e.append(k); return e; };
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: opts.body ? { "content-type": "application/json" } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const q = () => "?v=" + encodeURIComponent(current);

async function loadVideos() {
  videos = (await api("/api/videos")).videos;
  drawVideos();
}
function drawVideos() {
  const term = $("q").value.toLowerCase();
  const list = videos.filter((v) => (!$("rendersOnly").checked || RENDER.test(v.name)) && (!term || v.v.toLowerCase().includes(term)));
  const box = $("videos"); box.replaceChildren();
  let folder = null;
  for (const v of list) {
    if (v.folder !== folder) { folder = v.folder; box.append(el("div", { className: "eyebrow folder", title: folder, textContent: folder === "." ? "/" : folder.replace("/studio/", " · ") })); }
    const b = el("button", { className: "vid" + (v.v === current ? " on" : ""), title: v.v, onclick: () => select(v.v) },
      el("span", { className: "n", textContent: v.name }),
      v.open ? el("span", { className: "pill open", textContent: v.open + " open" }) : v.total ? el("span", { className: "pill done", textContent: "all fixed" }) : null);
    box.append(b);
  }
  if (!list.length) box.append(el("div", { className: "empty", style: "padding:20px", textContent: "No videos here yet." }));
}

function select(v) {
  current = v; location.hash = "v=" + encodeURIComponent(v);
  const vid = el("video", { id: "video", src: "/api/video" + q(), controls: true, preload: "auto", playsInline: true });
  vid.addEventListener("timeupdate", () => $("time").textContent = clock(vid.currentTime) + " / " + clock(vid.duration));
  vid.addEventListener("play", () => $("play").textContent = "Pause");
  vid.addEventListener("pause", () => $("play").textContent = "Play");
  vid.playbackRate = SPEEDS[speedIdx];
  $("stage").replaceChildren(vid);
  $("controls").hidden = false; $("help").hidden = false;
  closeCompose();
  drawVideos();
  loadNotes();
}
const video = () => $("video");

async function loadNotes() {
  if (!current) return;
  const j = await api("/api/notes" + q());
  notes = j.notes;
  drawNotes();
  const v = videos.find((x) => x.v === current);
  if (v) { v.open = notes.filter((n) => n.status === "open").length; v.total = notes.length; drawVideos(); }
}
function drawNotes() {
  const name = current.split("/").pop();
  $("notesTitle").textContent = name;
  const open = notes.filter((n) => n.status === "open").length;
  $("counts").textContent = open + " open · " + (notes.length - open) + " fixed";
  const box = $("notes"); box.replaceChildren();
  for (const n of notes) {
    if (n.status === "fixed" && !$("showFixed").checked) continue;
    const img = n.frame ? el("img", { src: "/api/frame" + q() + "&id=" + n.id, title: "Jump here", onclick: () => seek(n.t) }) : null;
    const card = el("div", { className: "note" + (n.status === "fixed" ? " fixed" : "") },
      img,
      el("div", { className: "row" },
        el("button", { className: "t", textContent: clock(n.t), title: "Jump here", onclick: () => seek(n.t) }),
        el("span", {}, n.earlierCut ? el("span", { className: "pill old", textContent: "earlier cut", title: "Written on an earlier render; the moment may have moved" }) : null, " ",
          n.status === "fixed" ? el("span", { className: "pill done", textContent: "fixed" }) : el("span", { className: "pill open", textContent: "open" }))),
      el("div", { className: "txt", textContent: n.text }),
      n.caption ? el("div", { className: "cap", textContent: "caption: “" + n.caption + "”" }) : null,
      n.fix ? el("div", { className: "cap", textContent: "fix: " + n.fix }) : null,
      el("div", { className: "acts" },
        el("button", { className: "ghost", textContent: n.status === "fixed" ? "Reopen" : "Mark fixed", onclick: () => patch(n.id, { status: n.status === "fixed" ? "open" : "fixed" }) }),
        el("button", { className: "ghost", textContent: "Edit", onclick: () => editNote(n) }),
        el("button", { className: "ghost", textContent: "Delete", onclick: () => removeNote(n.id) })));
    box.append(card);
  }
  if (!box.children.length) box.append(el("div", { className: "empty", style: "padding:24px 16px", textContent: notes.length ? "Everything here is fixed." : "No notes yet. Press N while watching." }));
  $("claude").hidden = !open;
  $("claudeCmd").textContent = "fix my review notes on " + current;
}

function seek(t) { const v = video(); if (!v) return; v.pause(); v.currentTime = t; }
function step(frames) { const v = video(); if (!v) return; v.pause(); v.currentTime = Math.max(0, v.currentTime + frames / FPS); }

function grabFrame(v) {
  try {
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const c = el("canvas", { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } catch { return null; }
}
function openCompose() {
  const v = video(); if (!v) return;
  v.pause();
  pendingT = v.currentTime; pendingFrame = grabFrame(v);
  $("composeAt").textContent = "at " + clock(pendingT);
  $("composeCap").textContent = "";
  $("composeImg").src = pendingFrame || ""; $("composeImg").hidden = !pendingFrame;
  $("compose").classList.add("on");
  $("composeText").value = ""; $("composeText").focus();
}
function closeCompose() { $("compose").classList.remove("on"); pendingFrame = null; }
async function saveNote() {
  const text = $("composeText").value.trim();
  if (!text) { $("composeText").focus(); return; }
  try {
    await api("/api/notes" + q(), { method: "POST", body: JSON.stringify({ t: pendingT, text, frame: pendingFrame }) });
    closeCompose(); toast("Note saved at " + clock(pendingT)); loadNotes();
  } catch (e) { toast("Couldn't save: " + e.message); }
}
async function patch(id, body) { try { await api("/api/notes" + q(), { method: "PATCH", body: JSON.stringify({ id, ...body }) }); loadNotes(); } catch (e) { toast(e.message); } }
async function editNote(n) { const text = prompt("Edit note", n.text); if (text != null && text.trim()) patch(n.id, { text }); }
async function removeNote(id) { if (!confirm("Delete this note?")) return; try { await api("/api/notes" + q(), { method: "DELETE", body: JSON.stringify({ id }) }); loadNotes(); } catch (e) { toast(e.message); } }

$("q").addEventListener("input", drawVideos);
$("rendersOnly").addEventListener("change", drawVideos);
$("showFixed").addEventListener("change", drawNotes);
$("play").onclick = () => { const v = video(); if (v) v.paused ? v.play() : v.pause(); };
$("back5").onclick = () => { const v = video(); if (v) v.currentTime -= 5; };
$("fwd5").onclick = () => { const v = video(); if (v) v.currentTime += 5; };
$("prevFrame").onclick = () => step(-1);
$("nextFrame").onclick = () => step(1);
$("speed").onclick = () => { speedIdx = (speedIdx + 1) % SPEEDS.length; $("speed").textContent = SPEEDS[speedIdx] + "×"; const v = video(); if (v) v.playbackRate = SPEEDS[speedIdx]; };
$("addNote").onclick = openCompose;
$("saveNote").onclick = saveNote;
$("cancelNote").onclick = closeCompose;
$("composeText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(); }
  if (e.key === "Escape") { e.preventDefault(); closeCompose(); }
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input, textarea")) return;
  const v = video(); if (!v) return;
  if (e.key === " ") { e.preventDefault(); v.paused ? v.play() : v.pause(); }
  else if (e.key === "n" || e.key === "N") { e.preventDefault(); openCompose(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); v.currentTime -= e.shiftKey ? 5 : 1; }
  else if (e.key === "ArrowRight") { e.preventDefault(); v.currentTime += e.shiftKey ? 5 : 1; }
  else if (e.key === ",") step(-1);
  else if (e.key === ".") step(1);
});

loadVideos().then(() => {
  const m = location.hash.match(/v=([^&]+)/);
  if (m) { const v = decodeURIComponent(m[1]); if (videos.some((x) => x.v === v)) select(v); }
}).catch((e) => toast("Couldn't list videos: " + e.message));
</script>
</body>
</html>
`;
