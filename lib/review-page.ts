// The review page served by serveReview (review.ts): one self-contained HTML file, no build step,
// shared as-is between HQ and the clipper. An editor-style layout: media bin, player, notes
// inspector, and a timeline (ruler, notes lane, filmstrip, waveform) with a draggable playhead.
// The page's script avoids template literals so this file can stay a single raw string.

export const REVIEW_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22%231fd1c1%22/%3E%3Cpath d=%22M9 7v10l8-5z%22 fill=%22%2303201d%22/%3E%3C/svg%3E">
<style>
  :root {
    --bg:#0e0e10; --panel:#17171a; --panel2:#1d1d21; --raised:#25252a; --hover:#2c2c32; --line:#28282d; --line2:#34343b;
    --text:#ededf0; --text2:#a3a3ad; --text3:#6c6c76; --accent:#1fd1c1; --accent-hi:#5ff0e2; --accent-soft:rgba(31,209,193,.13);
    --accent-line:rgba(31,209,193,.55); --ink:#03201d; --danger:#ff5d5d; --radius:10px;
    --mono:"SF Mono",ui-monospace,Menlo,monospace;
  }
  * { box-sizing:border-box; }
  [hidden] { display:none !important; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--text); font:13px/1.45 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;
              -webkit-font-smoothing:antialiased; overflow:hidden; user-select:none; }
  ::-webkit-scrollbar { width:10px; height:10px; } ::-webkit-scrollbar-thumb { background:#2e2e34; border-radius:10px; border:3px solid transparent; background-clip:padding-box; }
  ::-webkit-scrollbar-track { background:transparent; }
  button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; padding:0; }
  svg { width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; flex:none; }
  .num { font-variant-numeric:tabular-nums; }
  .mono { font-family:var(--mono); font-size:12px; }
  .btn { display:inline-flex; align-items:center; gap:7px; height:30px; padding:0 12px; border-radius:8px; background:var(--raised); color:var(--text); font-weight:500; transition:background .12s, color .12s; }
  .btn:hover { background:var(--hover); }
  .btn.accent { background:var(--accent); color:var(--ink); }
  .btn.accent:hover { background:var(--accent-hi); }
  .btn.ghost { background:transparent; color:var(--text2); }
  .btn.ghost:hover { background:var(--raised); color:var(--text); }
  .icon { width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; color:var(--text2); transition:background .12s,color .12s; }
  .icon:hover { background:var(--raised); color:var(--text); }
  .icon.on { color:var(--accent); }
  kbd { font:500 10.5px var(--mono); color:var(--text3); border:1px solid var(--line2); border-radius:5px; padding:0 4px; margin-left:2px; }
  .btn.accent kbd { color:rgba(3,32,29,.7); border-color:rgba(3,32,29,.3); }
  .label { font-size:11.5px; font-weight:600; color:var(--text2); letter-spacing:.01em; }
  .muted { color:var(--text3); }

  /* shell */
  .app { display:grid; grid-template-rows:48px minmax(0,1fr) 256px; height:100vh; }
  .top { display:flex; align-items:center; gap:14px; padding:0 14px; border-bottom:1px solid var(--line); background:var(--panel); }
  .brand { display:flex; align-items:center; gap:9px; font-weight:600; letter-spacing:-.01em; min-width:260px; }
  .brand .mark { width:22px; height:22px; border-radius:6px; background:linear-gradient(135deg,var(--accent),#2a8cff); display:grid; place-items:center; color:#04201c; }
  .brand .mark svg { width:13px; height:13px; stroke-width:2.6; }
  .file { flex:1; text-align:center; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .file b { font-weight:600; } .file span { color:var(--text3); margin-left:8px; }
  .topright { display:flex; gap:8px; align-items:center; min-width:260px; justify-content:flex-end; }
  .chip { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px; font-size:11.5px; font-weight:600; background:var(--raised); color:var(--text2); }
  .chip.accent { background:var(--accent-soft); color:var(--accent); }
  .chip .dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
  .work { display:grid; grid-template-columns:288px minmax(0,1fr) 340px; min-height:0; }
  .panel { background:var(--panel); display:flex; flex-direction:column; min-height:0; }
  .work > .panel:first-child { border-right:1px solid var(--line); }
  .work > .panel:last-child { border-left:1px solid var(--line); }
  .phead { height:44px; display:flex; align-items:center; justify-content:space-between; padding:0 12px 0 14px; flex:none; }
  .phead h2 { margin:0; font-size:13px; font-weight:600; }

  /* media */
  .seg { display:flex; background:var(--bg); border-radius:8px; padding:2px; }
  .seg button { height:24px; padding:0 10px; border-radius:6px; font-size:11.5px; font-weight:500; color:var(--text3); }
  .seg button.on { background:var(--raised); color:var(--text); }
  .search { margin:0 12px 8px; position:relative; }
  .search svg { position:absolute; left:9px; top:8px; width:14px; height:14px; color:var(--text3); }
  input.field, textarea.field { width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; font:inherit; outline:none; transition:border-color .12s; user-select:text; }
  input.field { height:30px; padding:0 10px 0 29px; }
  textarea.field { padding:9px 10px; resize:none; min-height:78px; line-height:1.5; }
  .field:focus { border-color:var(--accent-line); }
  .scroll { overflow:auto; flex:1; min-height:0; }
  .group { padding:6px 12px 2px; }
  .group .gname { display:flex; justify-content:space-between; gap:8px; font-size:11.5px; font-weight:600; color:var(--text2); margin:8px 2px 8px; }
  .group .gname span:last-child { color:var(--text3); font-weight:500; white-space:nowrap; }
  .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .card { text-align:left; display:flex; flex-direction:column; gap:6px; min-width:0; }
  .thumb { position:relative; aspect-ratio:9/16; border-radius:9px; overflow:hidden; background:var(--panel2); outline:2px solid transparent; outline-offset:-2px; transition:outline-color .12s, transform .12s; }
  .card:hover .thumb { outline-color:var(--line2); }
  .card.on .thumb { outline-color:var(--accent); }
  .thumb img { width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .25s; }
  .thumb img.ok { opacity:1; }
  .thumb .badge { position:absolute; top:6px; right:6px; }
  .card .cname { font-size:11.5px; color:var(--text2); line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }
  .card.on .cname { color:var(--text); }
  .card .csub { font-size:10.5px; color:var(--text3); margin-top:-3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .grid { padding-top:4px; row-gap:14px; }
  .shimmer { background:linear-gradient(100deg,var(--panel2) 30%,#24242a 50%,var(--panel2) 70%) 0 0/300% 100%; animation:sh 1.4s infinite linear; }
  @keyframes sh { to { background-position:-150% 0; } }

  /* player */
  .player { background:var(--bg); display:flex; flex-direction:column; min-width:0; min-height:0; }
  .pbar { height:44px; display:flex; align-items:center; justify-content:space-between; padding:0 14px; color:var(--text3); font-size:11.5px; }
  .stage { flex:1; min-height:0; position:relative; overflow:hidden; }
  .stage > .empty { position:absolute; inset:0; margin:auto; height:fit-content; }
  .stage video { position:absolute; border-radius:6px; background:#000; box-shadow:0 18px 50px -18px rgba(0,0,0,.8); cursor:pointer; display:block; }
  .empty { color:var(--text3); text-align:center; max-width:40ch; line-height:1.6; }
  .empty .big { width:46px; height:46px; margin:0 auto 12px; border-radius:12px; background:var(--panel2); display:grid; place-items:center; color:var(--text2); }
  .empty .big svg { width:22px; height:22px; }
  .transport { height:52px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding:0 14px; border-top:1px solid var(--line); background:var(--panel); }
  .tc { font:500 12.5px var(--mono); color:var(--text); } .tc span { color:var(--text3); }
  .tmid { display:flex; align-items:center; gap:6px; }
  .playbtn { width:36px; height:36px; border-radius:50%; background:var(--text); color:#0e0e10; display:grid; place-items:center; transition:transform .1s, background .12s; }
  .playbtn:hover { background:#fff; transform:scale(1.04); } .playbtn svg { fill:currentColor; stroke:none; width:15px; height:15px; }
  .tright { display:flex; justify-content:flex-end; align-items:center; gap:6px; }
  .speed { height:26px; padding:0 8px; border-radius:7px; font:600 11.5px var(--mono); color:var(--text2); background:var(--raised); }
  .speed:hover { color:var(--text); }

  /* inspector */
  .tabs { display:flex; gap:2px; }
  .tabs button { height:28px; padding:0 10px; border-radius:7px; font-weight:600; font-size:12.5px; color:var(--text3); }
  .tabs button.on { color:var(--text); background:var(--raised); }
  .tabs .n { color:var(--text3); font-weight:500; margin-left:3px; }
  .compose { margin:4px 12px 10px; border:1px solid var(--accent-line); background:linear-gradient(180deg,rgba(31,209,193,.07),rgba(31,209,193,.02)); border-radius:12px; padding:12px; display:none; flex-direction:column; gap:10px; }
  .compose.on { display:flex; animation:pop .16s ease-out; }
  @keyframes pop { from { transform:translateY(-4px); opacity:0; } }
  .chead { display:flex; align-items:center; justify-content:space-between; }
  .chead b { font-size:12.5px; }
  .tchip { display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 8px; border-radius:6px; background:var(--accent-soft); color:var(--accent); font:600 11.5px var(--mono); cursor:pointer; }
  .crow { display:flex; gap:10px; }
  .crow img { width:74px; aspect-ratio:9/16; object-fit:cover; border-radius:7px; background:#000; flex:none; }
  .crow .ctext { flex:1; display:flex; flex-direction:column; gap:7px; min-width:0; }
  .spanline { display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--text2); flex-wrap:wrap; }
  .link { color:var(--accent); font-weight:600; font-size:11.5px; } .link:hover { color:var(--accent-hi); }
  .cfoot { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .cfoot .btns { display:flex; gap:6px; flex:none; }
  .hint { font-size:11px; color:var(--text3); }
  .note { margin:0 12px 8px; padding:10px; border-radius:11px; background:var(--panel2); border:1px solid transparent; display:flex; gap:10px; cursor:pointer; transition:border-color .12s, background .12s; position:relative; }
  .note:hover { background:#202025; }
  .note.on { border-color:var(--accent-line); }
  .note .nthumb { width:46px; aspect-ratio:9/16; border-radius:6px; object-fit:cover; background:#000; flex:none; }
  .note .nbody { flex:1; min-width:0; }
  .note .ntop { display:flex; align-items:center; gap:6px; margin-bottom:5px; }
  .note .ntop .len { font-size:11px; color:var(--text3); }
  .note .ntext { white-space:pre-wrap; word-wrap:break-word; line-height:1.45; user-select:text; }
  .note .ncap { margin-top:6px; font-size:11.5px; color:var(--text3); display:flex; gap:5px; }
  .note .ncap svg { width:12px; height:12px; margin-top:2px; }
  .note .ncap span { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .note .tag { font-size:10.5px; color:var(--text3); background:var(--raised); border-radius:5px; padding:1px 6px; }
  .note .acts { position:absolute; top:6px; right:6px; display:flex; gap:2px; opacity:0; transition:opacity .12s; background:var(--panel2); border-radius:8px; }
  .note:hover .acts, .note.editing .acts { opacity:1; }
  .note .acts .icon { width:26px; height:26px; }
  .note .acts .icon.danger { color:var(--danger); }
  .note.fixed .ntext { color:var(--text2); }
  .note textarea.field { min-height:60px; margin-top:2px; }
  .ask { margin:8px 12px 12px; padding:11px 12px; border-radius:11px; background:var(--panel2); display:none; }
  .ask.on { display:block; }
  .ask .q { font-size:11.5px; color:var(--text2); margin-bottom:7px; display:flex; justify-content:space-between; align-items:center; }
  .ask code { display:block; font:11.5px/1.5 var(--mono); color:var(--text); word-break:break-all; user-select:text; }

  /* timeline */
  .tl { display:grid; grid-template-rows:38px minmax(0,1fr); background:var(--panel); border-top:1px solid var(--line); min-height:0; }
  .tlbar { display:flex; align-items:center; justify-content:space-between; padding:0 10px; border-bottom:1px solid var(--line); }
  .tlbar .left, .tlbar .right { display:flex; align-items:center; gap:4px; }
  .tlbar .sep { width:1px; height:18px; background:var(--line2); margin:0 6px; }
  .range { font:500 11.5px var(--mono); color:var(--accent); display:none; align-items:center; gap:6px; }
  .range.on { display:inline-flex; }
  input[type=range] { -webkit-appearance:none; appearance:none; width:110px; height:3px; border-radius:3px; background:var(--line2); outline:none; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:var(--text); cursor:pointer; }
  .tlbody { display:grid; grid-template-columns:44px minmax(0,1fr); min-height:0; }
  .heads { border-right:1px solid var(--line); display:grid; grid-template-rows:26px 28px 26px 62px 42px; }
  .heads div { display:grid; place-items:center; color:var(--text3); }
  .heads svg { width:14px; height:14px; }
  .tracks { overflow-x:auto; overflow-y:hidden; position:relative; cursor:text; }
  .inner { position:relative; height:100%; min-width:100%; }
  .ruler { height:26px; position:relative; }
  .ruler canvas { position:absolute; left:0; top:0; }
  .lane { height:28px; position:relative; border-bottom:1px solid var(--line); cursor:crosshair; }
  .lane .ph { position:absolute; left:8px; top:7px; font-size:11px; color:var(--text3); pointer-events:none; white-space:nowrap; }
  .cutlane { height:26px; position:relative; border-bottom:1px solid var(--line); cursor:crosshair; }
  .cutlane .ph { position:absolute; left:8px; top:6px; font-size:11px; color:var(--text3); pointer-events:none; white-space:nowrap; }
  .cutr { position:absolute; top:4px; height:18px; border-radius:5px; cursor:pointer; z-index:3;
    background:repeating-linear-gradient(135deg,rgba(255,93,93,.55) 0 6px,rgba(255,93,93,.25) 6px 12px); border:1px solid rgba(255,93,93,.9); }
  .cutr.on { box-shadow:0 0 0 2px var(--panel), 0 0 0 4px rgba(255,93,93,.6); }
  .cutr .x { position:absolute; right:-7px; top:-7px; width:16px; height:16px; border-radius:50%; background:#ff5d5d; color:#fff; display:none; place-items:center; }
  .cutr .x svg { width:10px; height:10px; stroke-width:3; }
  .cutr:hover .x, .cutr.on .x { display:grid; }
  .cutshade { position:absolute; top:80px; bottom:0; background:rgba(255,93,93,.16); border-left:1px solid rgba(255,93,93,.6); border-right:1px solid rgba(255,93,93,.6); pointer-events:none; z-index:2; }
  .exportsel { height:30px; }
  .btn.busy { background:var(--raised); color:var(--text2); cursor:progress; }
  .spin { width:13px; height:13px; border-radius:50%; border:2px solid var(--line2); border-top-color:var(--accent); animation:rot .8s linear infinite; }
  @keyframes rot { to { transform:rotate(360deg); } }
  .vtrack { height:62px; position:relative; padding:4px 0; }
  .atrack { height:42px; position:relative; padding:4px 0 6px; }
  .clip { position:absolute; top:4px; bottom:4px; left:0; border-radius:7px; overflow:hidden; background:var(--panel2); border:1px solid #3a3a42; }
  .clip .tiles { position:absolute; inset:0; }
  .clip .tile { position:absolute; top:0; bottom:0; background-repeat:no-repeat; }
  .clip .cl { position:absolute; left:6px; top:5px; font-size:10.5px; font-weight:600; color:#fff; background:rgba(0,0,0,.55); padding:1px 6px; border-radius:4px; max-width:60%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; backdrop-filter:blur(4px); }
  .aclip { position:absolute; top:4px; bottom:6px; left:0; border-radius:7px; overflow:hidden; background:#10302d; border:1px solid #1f4f4a; }
  .aclip img { width:100%; height:100%; display:block; opacity:0; transition:opacity .25s; }
  .aclip img.ok { opacity:.95; }
  .marker { position:absolute; top:5px; height:18px; transform:translateX(-9px); display:flex; align-items:center; cursor:pointer; z-index:3; }
  .marker .pin { width:18px; height:18px; border-radius:5px; background:var(--accent); color:var(--ink); display:grid; place-items:center; font:700 10px var(--mono); box-shadow:0 0 0 2px var(--panel); }
  .marker.fixed .pin { background:#4a4a52; color:#c9c9d0; }
  .marker.span { transform:none; }
  .marker.span .bar { position:absolute; left:0; right:0; top:3px; height:12px; border-radius:6px; background:var(--accent-soft); border:1px solid var(--accent-line); }
  .marker.span.fixed .bar { background:rgba(120,120,130,.15); border-color:#4a4a52; }
  .marker.span .pin { position:relative; transform:translateX(-9px); }
  .marker.on .pin { box-shadow:0 0 0 2px var(--panel), 0 0 0 4px var(--accent-line); }
  .tip { position:fixed; z-index:20; max-width:280px; background:#2a2a30; color:var(--text); border:1px solid var(--line2); border-radius:9px; padding:8px 10px; font-size:12px; pointer-events:none; display:none; box-shadow:0 10px 30px -10px rgba(0,0,0,.7); }
  .tip b { font:600 11px var(--mono); color:var(--accent); display:block; margin-bottom:3px; }
  .sel { position:absolute; top:26px; bottom:0; background:rgba(31,209,193,.09); border-left:1px solid var(--accent-line); border-right:1px solid var(--accent-line); pointer-events:none; display:none; z-index:2; }
  .sel.on { display:block; }
  .playhead { position:absolute; top:0; bottom:0; width:0; z-index:5; pointer-events:none; }
  .playhead::before { content:""; position:absolute; top:8px; bottom:0; left:-0.5px; width:1px; background:#fff; }
  .playhead::after { content:""; position:absolute; top:0; left:-6px; width:12px; height:14px; background:#fff; border-radius:3px 3px 6px 6px; clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%); }

  /* views */
  .views { margin-left:14px; }
  .app.plan .work, .app.plan .tl { display:none; }
  .planner { display:none; grid-row:2 / 4; grid-template-columns:320px minmax(0,1fr) 340px; min-height:0; }
  .app.plan .planner { display:grid; }
  .saved { font-size:11.5px; color:var(--text3); }
  select.field { height:30px; padding:0 28px 0 10px; -webkit-appearance:none; appearance:none; background:var(--bg) url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238a8a94%22 stroke-width=%222%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E") no-repeat right 8px center/14px; color:var(--text); border:1px solid var(--line); border-radius:8px; font:inherit; outline:none; }
  input.plain { width:100%; height:30px; padding:0 10px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; font:inherit; outline:none; user-select:text; }
  input.plain:focus { border-color:var(--accent-line); }
  input[type=date].plain { color-scheme:dark; }
  .prow { display:flex; align-items:center; gap:10px; padding:7px 8px; margin:0 10px 6px; border-radius:10px; background:var(--panel2); border:1px solid transparent; cursor:pointer; transition:border-color .12s, background .12s; }
  .prow:hover { background:#202025; }
  .prow.on { border-color:var(--accent-line); }
  .prow.over { box-shadow:inset 0 2px 0 var(--accent); }
  .prow.dragging { opacity:.4; }
  .prow .grip { color:var(--text3); cursor:grab; display:grid; place-items:center; }
  .prow .grip svg { width:14px; height:14px; }
  .prow .ord { font:600 11px var(--mono); color:var(--text3); width:18px; text-align:right; }
  .prow img { width:32px; aspect-ratio:9/16; border-radius:5px; object-fit:cover; background:#000; flex:none; }
  .prow .pm { flex:1; min-width:0; }
  .prow .pn { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12.5px; }
  .prow .ps { font-size:11px; color:var(--text3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .prow .missing { color:var(--danger); }
  .addlist { margin:4px 10px 10px; padding:8px; border-radius:11px; background:var(--bg); border:1px dashed var(--line2); display:none; }
  .addlist.on { display:block; }
  .arow { display:flex; align-items:center; gap:9px; padding:5px 6px; border-radius:8px; }
  .arow:hover { background:var(--panel2); }
  .arow img { width:26px; aspect-ratio:9/16; border-radius:4px; object-fit:cover; background:#000; }
  .arow .pn { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; color:var(--text2); }
  .pcenter { background:var(--bg); display:flex; flex-direction:column; align-items:center; min-width:0; min-height:0; padding:14px 20px 18px; gap:14px; }
  .phone { width:390px; max-width:100%; flex:1; min-height:0; max-height:844px; border-radius:46px; background:#000; padding:11px; box-shadow:0 0 0 1px #2f2f36, 0 30px 80px -30px rgba(0,0,0,.9); display:flex; }
  .screen { flex:1; border-radius:36px; overflow-y:auto; overflow-x:hidden; background:#000; color:#f5f5f5; position:relative; }
  .screen::-webkit-scrollbar { width:0; }
  .notch { height:34px; display:flex; justify-content:space-between; align-items:center; padding:0 26px; font:600 13px -apple-system,system-ui; }
  .notch .island { width:96px; height:26px; background:#000; border-radius:20px; box-shadow:0 0 0 1px #111; }
  .pf-head { padding:4px 14px 10px; }
  .pf-top { display:flex; align-items:center; gap:18px; }
  .avatar { border-radius:50%; background:linear-gradient(135deg,#1fd1c1,#2a8cff 60%,#8b5cf6); flex:none; display:grid; place-items:center; color:#05221f; font-weight:800; }
  .ig-ring { padding:3px; border-radius:50%; background:conic-gradient(#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5,#feda75); }
  .ig-ring .avatar { box-shadow:0 0 0 3px #000; }
  .stats { flex:1; display:flex; justify-content:space-around; text-align:center; }
  .stats b { display:block; font-size:16px; } .stats span { font-size:12.5px; color:#d5d5d5; }
  .pf-name { font-weight:600; font-size:13.5px; margin-top:10px; }
  .bioline { height:9px; border-radius:5px; background:#1e1e1e; margin-top:7px; }
  .pf-btns { display:flex; gap:6px; margin-top:12px; }
  .pf-btns div { flex:1; height:32px; border-radius:8px; background:#262626; display:grid; place-items:center; font-weight:600; font-size:13px; }
  .pf-tabs { display:flex; border-top:1px solid #1f1f1f; }
  .pf-tabs div { flex:1; height:44px; display:grid; place-items:center; color:#8e8e8e; border-bottom:1px solid transparent; font-weight:600; font-size:13.5px; }
  .pf-tabs div.on { color:#fff; border-bottom-color:#fff; }
  .pf-tabs svg { width:22px; height:22px; }
  .pgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:2px; }
  .tt .pgrid { gap:1px; }
  .yt .pgrid { gap:4px; padding:0 4px; }
  .tile { position:relative; aspect-ratio:3/4; background:#111; overflow:hidden; cursor:pointer; }
  .yt .tile { aspect-ratio:9/16; border-radius:8px; }
  .tile img { width:100%; height:100%; object-fit:cover; display:block; }
  .tile .ov { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:space-between; padding:6px; pointer-events:none; }
  .tile .ov .r { display:flex; justify-content:space-between; align-items:center; font:600 11.5px -apple-system,system-ui; text-shadow:0 1px 3px rgba(0,0,0,.8); }
  .tile .ov svg { width:15px; height:15px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
  .tile .pinned-tt { background:#fe2c55; color:#fff; border-radius:3px; padding:1px 5px; font-size:10.5px; text-shadow:none; }
  .tile .hov { position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,0) 55%,rgba(0,0,0,.6)); opacity:0; transition:opacity .12s; pointer-events:none; }
  .tile:hover .hov, .tile.on .hov { opacity:1; }
  .tile .hov .ordtag { position:absolute; left:6px; bottom:6px; font:600 10.5px var(--mono); color:#fff; }
  .tile .hov .edit { position:absolute; right:5px; bottom:5px; height:22px; padding:0 8px; border-radius:6px; background:var(--accent); color:var(--ink); font-weight:600; font-size:11px; pointer-events:auto; }
  .tile .hov .edit:hover { background:var(--accent-hi); }
  .tile:hover .ov .r:last-child, .tile.on .ov .r:last-child { opacity:0; }
  .tile.on { outline:2px solid var(--accent); outline-offset:-2px; z-index:1; }
  .tile.missing img { opacity:.25; }
  .tile.ghost { cursor:default; background:repeating-linear-gradient(135deg,#0d0d0d 0 8px,#111 8px 16px); }
  .yt-banner { height:84px; margin:0 12px; border-radius:12px; background:linear-gradient(120deg,#0d3b38,#123a66 60%,#2b1d52); }
  .yt-chan { display:flex; gap:14px; align-items:center; padding:12px 14px 6px; }
  .yt-chan b { font-size:18px; display:block; } .yt-chan span { font-size:12px; color:#aaa; }
  .yt-sub { margin:8px 14px 10px; height:36px; border-radius:18px; background:#f1f1f1; color:#0f0f0f; display:grid; place-items:center; font-weight:600; font-size:13.5px; }
  .tt-head { text-align:center; padding:6px 14px 12px; }
  .tt-head .avatar { margin:0 auto 8px; }
  .tt-stats { display:flex; justify-content:center; gap:22px; margin:10px 0 12px; }
  .tt-stats b { display:block; font-size:16px; } .tt-stats span { font-size:12px; color:#aaa; }
  .tt-btn { display:inline-grid; place-items:center; height:36px; padding:0 22px; border-radius:6px; background:#2f2f2f; font-weight:600; font-size:13.5px; }
  .pempty { padding:40px 24px; text-align:center; color:#777; font-size:12.5px; line-height:1.6; }
  .cover { position:relative; margin:0 12px; border-radius:12px; overflow:hidden; background:#000; aspect-ratio:9/16; max-height:340px; align-self:center; }
  .cover video { width:100%; height:100%; object-fit:contain; display:block; }
  .crop { position:absolute; left:0; right:0; border:1.5px solid var(--accent); box-shadow:0 0 0 999px rgba(0,0,0,.55); pointer-events:none; border-radius:2px; }
  .crop span { position:absolute; bottom:6px; left:6px; font:600 10.5px var(--mono); color:var(--ink); background:var(--accent); padding:1px 5px; border-radius:4px; }
  .fieldrow { margin:10px 12px 0; display:flex; flex-direction:column; gap:5px; }
  .fieldrow label { font-size:11.5px; color:var(--text2); font-weight:600; }
  .toggle2 { display:flex; align-items:center; justify-content:space-between; margin:12px 12px 0; padding:9px 10px; border-radius:9px; background:var(--panel2); font-size:12.5px; }
  .sw { width:34px; height:20px; border-radius:10px; background:var(--line2); position:relative; transition:background .15s; flex:none; }
  .sw::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s; }
  .sw.on { background:var(--accent); } .sw.on::after { transform:translateX(14px); }
  .dacts { display:flex; gap:8px; margin:14px 12px 14px; }
  .dacts .btn { flex:1; justify-content:center; }
  .btn.dangerous:hover { color:var(--danger); }
  .tip2 { margin:12px; padding:10px 12px; border-radius:10px; background:var(--panel2); color:var(--text2); font-size:12px; line-height:1.55; }

  .toast { position:fixed; left:50%; bottom:272px; transform:translateX(-50%) translateY(8px); background:#2a2a30; border:1px solid var(--line2); color:var(--text); padding:8px 14px; border-radius:10px; font-size:12.5px; opacity:0; pointer-events:none; transition:opacity .18s, transform .18s; z-index:30; box-shadow:0 10px 30px -10px rgba(0,0,0,.7); }
  .toast.on { opacity:1; transform:translateX(-50%); }
  @media (max-width:1180px) { .work { grid-template-columns:230px minmax(0,1fr) 300px; } .brand, .topright { min-width:0; } }
</style>
</head>
<body>
<div class="app">
  <header class="top">
    <div class="brand"><div class="mark"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg></div>{{TITLE}}
      <div class="seg views"><button class="on" id="vReview">Review</button><button id="vPlan">Planner</button></div></div>
    <div class="file" id="file"><span>Pick a video to review</span></div>
    <div class="topright">
      <span class="saved" id="savedLbl"></span>
      <span class="chip accent" id="openChip" hidden><span class="dot"></span><span id="openCount"></span></span>
      <select class="field exportsel" id="exportSel" title="The speed the video is rendered (and posted) at" hidden></select>
      <button class="btn accent" id="applyBtn" hidden></button>
      <button class="btn" id="copyAsk" hidden><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>Copy request for Claude</button>
    </div>
  </header>

  <div class="work">
    <section class="panel">
      <div class="phead"><h2>Media</h2>
        <div class="seg"><button class="on" id="segEdited">Edited</button><button id="segAll">All</button></div></div>
      <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="field" id="q" placeholder="Search"></div>
      <div class="scroll" id="media"></div>
    </section>

    <section class="player">
      <div class="pbar"><span class="label">Player</span><span id="metaLine" class="num"></span></div>
      <div class="stage" id="stage">
        <div class="empty"><div class="big"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg></div>
          Pick a video from Media. Watch it, and wherever something looks off press <kbd>N</kbd>. Drag across the notes lane, or use <kbd>I</kbd> and <kbd>O</kbd>, to note a few seconds at once.</div>
      </div>
      <div class="transport">
        <div class="tc num" id="tc">00:00:00:00 <span>/ 00:00:00:00</span></div>
        <div class="tmid">
          <button class="icon" id="prevFrame" title="Previous frame  ,"><svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6"/></svg></button>
          <button class="playbtn" id="play" title="Play / pause  Space"></button>
          <button class="icon" id="nextFrame" title="Next frame  ."><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
        <div class="tright">
          <button class="speed" id="speed" title="Playback speed">1.0×</button>
          <button class="btn accent" id="noteBtn" title="Note at the playhead  N"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Note<kbd>N</kbd></button>
          <button class="icon" id="full" title="Full screen  F"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="phead"><div class="tabs"><button class="on" id="tabOpen">Notes<span class="n" id="nOpen">0</span></button><button id="tabFixed">Resolved<span class="n" id="nFixed">0</span></button></div></div>
      <div class="compose" id="compose">
        <div class="chead"><b>New note</b><span class="tchip" id="cTime"></span></div>
        <div class="crow"><img id="cImg" alt=""><div class="ctext">
          <textarea class="field" id="cText" placeholder="What looks off? e.g. the caption covers the graphic, the cut lands mid-word…"></textarea>
          <div class="spanline" id="cSpan"></div></div></div>
        <div class="cfoot"><span class="hint"><kbd>↵</kbd> save &nbsp;<kbd>⇧↵</kbd> new line</span>
          <span class="btns"><button class="btn ghost" id="cCancel">Cancel</button><button class="btn accent" id="cSave">Save</button></span></div>
      </div>
      <div class="scroll" id="notes"></div>
      <div class="ask" id="ask"><div class="q">Done? Ask Claude:<button class="link" id="copyAsk2">Copy</button></div><code id="askText"></code></div>
    </section>
  </div>

  <section class="tl">
    <div class="tlbar">
      <div class="left">
        <button class="btn ghost" id="tlNote"><svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>Note<kbd>N</kbd></button>
        <span class="sep"></span>
        <button class="btn ghost" id="markIn" title="Start a span at the playhead  I"><svg viewBox="0 0 24 24"><path d="M8 4v16M8 12h10"/></svg>In<kbd>I</kbd></button>
        <button class="btn ghost" id="markOut" title="End the span at the playhead  O"><svg viewBox="0 0 24 24"><path d="M16 4v16M6 12h10"/></svg>Out<kbd>O</kbd></button>
        <button class="btn ghost" id="cutBtn" title="Cut the marked span out  X"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9l3.4-3.4"/></svg>Cut<kbd>X</kbd></button>
        <span class="range" id="rangeLbl"><span id="rangeTxt"></span><button class="icon" id="rangeClear" title="Clear the span  Esc" style="width:22px;height:22px"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>
      </div>
      <div class="right">
        <button class="icon" id="zOut" title="Zoom out  −"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.5-3.5"/></svg></button>
        <input type="range" id="zoom" min="0" max="100" value="0">
        <button class="icon" id="zIn" title="Zoom in  +"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-3.5-3.5"/></svg></button>
        <button class="btn ghost" id="zFit" title="Fit the whole video  Shift+Z">Fit</button>
        <span class="sep"></span>
        <button class="btn ghost" id="skipBtn" title="While playing, jump over the parts marked to cut"><svg viewBox="0 0 24 24"><path d="M5 4l10 8-10 8zM19 5v14"/></svg>Skip cuts</button>
      </div>
    </div>
    <div class="tlbody">
      <div class="heads">
        <div></div>
        <div title="Notes"><svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg></div>
        <div title="Cuts: parts to delete"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9l3.4-3.4"/></svg></div>
        <div title="Video"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg></div>
        <div title="Audio"><svg viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg></div>
      </div>
      <div class="tracks" id="tracks"><div class="inner" id="inner">
        <div class="ruler"><canvas id="ruler"></canvas></div>
        <div class="lane" id="lane"><span class="ph" id="lanePh">Drag here to note a span</span></div>
        <div class="cutlane" id="cutLane"><span class="ph" id="cutPh">Drag here to cut a part out</span></div>
        <div class="vtrack"><div class="clip" id="clip"><div class="tiles" id="tiles"></div><span class="cl" id="clipName"></span></div></div>
        <div class="atrack"><div class="aclip" id="aclip"><img id="wave" alt=""></div></div>
        <div class="sel" id="sel"></div>
        <div class="playhead" id="playhead"></div>
      </div></div>
    </div>
  </section>

  <section class="planner" id="planner">
    <div class="panel" style="border-right:1px solid var(--line)">
      <div class="phead"><h2>Posting order <span class="muted" id="pCount"></span></h2>
        <button class="btn ghost" id="pAdd"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add videos</button></div>
      <div style="padding:0 12px 10px"><select class="field" id="pSelect" style="width:100%"></select></div>
      <div class="addlist" id="pAddList"></div>
      <div class="scroll" id="pList"></div>
      <div class="tip2">First at the top is posted first. The previews show the profile once every video here is up: newest first, pinned posts on top.</div>
    </div>
    <div class="pcenter">
      <div class="seg" id="platforms"><button class="on" data-p="instagram">Instagram</button><button data-p="tiktok">TikTok</button><button data-p="youtube">YouTube Shorts</button></div>
      <div class="phone"><div class="screen" id="screen"></div></div>
    </div>
    <div class="panel" style="border-left:1px solid var(--line)" id="pSide"></div>
  </section>
</div>
<div class="tip" id="tip"></div>
<div class="toast" id="toast"></div>

<script>
var $ = function (id) { return document.getElementById(id); };
var ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  quote: '<svg viewBox="0 0 24 24"><path d="M7 7h4v4H8a3 3 0 0 0 3 3M14 7h4v4h-3a3 3 0 0 0 3 3"/></svg>'
};
var S = { videos: [], cur: null, meta: null, fps: 30, notes: [], tab: "open", edited: true, zoom: 0, pps: 1, inT: null, outT: null,
          pending: null, selected: null, editing: null, confirmDel: null, speeds: [0.5, 1, 1.5, 2], speedIdx: 1, stripN: 40,
          cuts: [], cutSel: null, skip: true, exportSpeed: null, appliedSpeed: 1, editable: false, applying: null };
var EXPORTS = [1, 1.25, 1.5, 1.75, 2];
var RENDER = /-(vertical|landscape|square)\.mp4$/i;

function el(tag, props) { var e = document.createElement(tag); if (props) for (var k in props) { if (k === "html") e.innerHTML = props[k]; else if (k === "style") e.style.cssText = props[k]; else e[k] = props[k]; }
  for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c != null && c !== false) e.append(c); } return e; }
function pad(n, w) { return String(n).padStart(w || 2, "0"); }
function tc(t) { t = Math.max(0, t || 0); var f = Math.floor((t % 1) * S.fps + 1e-6); var s = Math.floor(t);
  return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60) + ":" + pad(f); }
function short(t) { t = Math.max(0, t || 0); return Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0"); }
function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(function () { t.classList.remove("on"); }, 2200); }
function q() { return "?v=" + encodeURIComponent(S.cur); }
function ver(v) { var x = S.videos.find(function (y) { return y.v === v; }); return x ? "&m=" + encodeURIComponent(x.mtime) : ""; }
function api(path, opts) { opts = opts || {};
  return fetch(path, { method: opts.method || "GET", body: opts.body ? JSON.stringify(opts.body) : undefined, headers: opts.body ? { "content-type": "application/json" } : {} })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; }); }); }
function video() { return $("video"); }
function dur() { var v = video(); return (v && isFinite(v.duration) && v.duration) || (S.meta && S.meta.duration) || 0; }

/* ---------------- media */
function prettyJob(folder) {
  var parts = folder.split("/"); var i = parts.indexOf("studio"); var rest = i >= 0 ? parts.slice(i + 1) : parts;
  var job = rest[0] || folder, sub = rest.slice(1).join("/");
  var m = job.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-(.*)$/);
  return { name: (m ? m[4] : job).replace(/-/g, " ") + (sub ? " · " + sub : ""), date: m ? m[1] : "", biz: i > 0 ? parts[i - 1] : "" };
}
function loadVideos() { return api("/api/videos").then(function (j) { S.videos = j.videos; drawMedia(); }); }
function drawMedia() {
  var term = $("q").value.toLowerCase().trim();
  var list = S.videos.filter(function (v) { return (!S.edited || RENDER.test(v.name)) && (!term || v.v.toLowerCase().indexOf(term) >= 0); });
  var box = $("media"); box.replaceChildren();
  var grid = el("div", { className: "grid" });
  list.forEach(function (v) {
      var p = prettyJob(v.folder);
      var img = el("img", { loading: "lazy", alt: "", src: "/api/poster?v=" + encodeURIComponent(v.v) + "&m=" + encodeURIComponent(v.mtime) });
      var th = el("div", { className: "thumb shimmer" }, img,
        v.open ? el("span", { className: "badge chip accent", textContent: String(v.open) }) : v.total ? el("span", { className: "badge chip", html: ICON.check }) : null);
      img.onload = function () { img.classList.add("ok"); th.classList.remove("shimmer"); };
      img.onerror = function () { th.classList.remove("shimmer"); };
      grid.append(el("button", { className: "card" + (v.v === S.cur ? " on" : ""), title: v.v, onclick: function () { select(v.v); } }, th,
        el("div", { className: "cname", textContent: v.name.replace(/\.mp4$/i, "").replace(/-(vertical|landscape|square)$/i, "") }),
        el("div", { className: "csub", textContent: p.name + (p.date ? " · " + p.date.slice(5) : "") })));
  });
  if (list.length) box.append(el("div", { className: "group" }, grid));
  if (!list.length) box.append(el("div", { className: "empty", style: "padding:40px 20px", textContent: term ? "Nothing matches that." : "No videos here yet." }));
}

/* ---------------- player */
function select(v) {
  S.cur = v; S.inT = S.outT = null; S.selected = null; S.editing = null; S.cutSel = null; S.cuts = []; closeCompose(); history.replaceState(null, "", "#v=" + encodeURIComponent(v));
  var name = v.split("/").pop(), p = prettyJob(v.split("/").slice(0, -1).join("/"));
  $("file").replaceChildren(el("b", { textContent: name }), el("span", { textContent: (p.biz ? p.biz + " · " : "") + p.name }));
  var vid = el("video", { id: "video", src: "/api/video" + q() + ver(v), preload: "auto", playsInline: true });
  vid.addEventListener("click", togglePlay);
  vid.addEventListener("play", syncPlay); vid.addEventListener("pause", syncPlay);
  vid.addEventListener("loadedmetadata", function () { fitVideo(); layout(); });
  vid.addEventListener("timeupdate", function () { if (vid.paused) tick(); });
  vid.addEventListener("seeked", tick);
  vid.playbackRate = S.speeds[S.speedIdx];
  $("stage").replaceChildren(vid); fitVideo(); syncPlay();
  $("clipName").textContent = name.replace(/\.mp4$/i, "");
  $("tiles").replaceChildren(); $("wave").classList.remove("ok"); $("wave").src = "/api/wave" + q() + ver(v);
  $("wave").onload = function () { $("wave").classList.add("ok"); };
  S.meta = null; $("metaLine").textContent = "";
  api("/api/meta" + q()).then(function (j) { S.meta = j.meta; S.stripN = j.stripFrames || 40; if (S.meta) { S.fps = S.meta.fps || 30;
    $("metaLine").textContent = S.meta.width + "×" + S.meta.height + " · " + Math.round(S.fps) + " fps · " + short(S.meta.duration); } layout(); }).catch(function () {});
  S.strip = new Image(); S.strip.onload = function () { drawTiles(); }; S.strip.src = "/api/strip" + q() + ver(v);
  drawMedia(); loadNotes(); layout(); tick();
}
/* The video is sized to the stage in script: a percentage height inside a flex/grid cell doesn't constrain it. */
function fitVideo() {
  var v = video(), st = $("stage"); if (!v) return;
  var pad = 14, w = st.clientWidth - pad * 2, h = st.clientHeight - pad * 2, vw = v.videoWidth || (S.meta && S.meta.width) || 9, vh = v.videoHeight || (S.meta && S.meta.height) || 16;
  var k = Math.max(0, Math.min(w / vw, h / vh)), W = Math.floor(vw * k), H = Math.floor(vh * k);
  v.style.width = W + "px"; v.style.height = H + "px"; v.style.left = Math.round((st.clientWidth - W) / 2) + "px"; v.style.top = Math.round((st.clientHeight - H) / 2) + "px";
}
function togglePlay() { var v = video(); if (!v) return; if (v.paused) v.play(); else v.pause(); }
function syncPlay() { var v = video(); $("play").innerHTML = v && !v.paused ? ICON.pause : ICON.play; if (v && !v.paused) loop(); }
function loop() { var v = video(); if (!v || v.paused) return; skipCuts(v); tick(true); requestAnimationFrame(loop); }
function skipCuts(v) { if (!S.skip || v.paused) return; var t = v.currentTime;
  var c = S.cuts.find(function (x) { return t >= x.t && t < x.end - 0.02; }); if (c) v.currentTime = Math.min(dur(), c.end + 0.01); }
function seek(t) { var v = video(); if (!v) return; v.currentTime = Math.max(0, Math.min(dur() || 0, t)); tick(); }
function step(n) { var v = video(); if (!v) return; v.pause(); seek(v.currentTime + n / S.fps); }
function tick(follow) {
  var v = video(), t = v ? v.currentTime : 0;
  $("tc").innerHTML = ""; $("tc").append(tc(t) + " ", el("span", { textContent: "/ " + tc(dur()) }));
  $("playhead").style.left = (t * S.pps) + "px";
  if (follow) { var tr = $("tracks"), x = t * S.pps; if (x > tr.scrollLeft + tr.clientWidth - 60 || x < tr.scrollLeft) tr.scrollLeft = x - 60; }
  var hit = S.notes.find(function (n) { return n.end !== undefined ? t >= n.t && t <= n.end : Math.abs(t - n.t) < 0.25; });
  var id = hit ? hit.id : null;
  if (id !== tick.lastHit) { tick.lastHit = id; document.querySelectorAll(".note").forEach(function (c) { c.classList.toggle("on", c.dataset.id === id || c.dataset.id === S.selected); });
    document.querySelectorAll(".marker").forEach(function (m) { m.classList.toggle("on", m.dataset.id === id); }); }
}

/* ---------------- timeline */
function fitPps() { var w = $("tracks").clientWidth - 24; return dur() ? w / dur() : 1; }
function layout() {
  var d = dur(); S.pps = fitPps() * Math.pow(2, S.zoom / 100 * 5);
  var w = Math.max($("tracks").clientWidth, d * S.pps + 24);
  $("inner").style.width = w + "px";
  $("clip").style.width = $("aclip").style.width = (d * S.pps) + "px";
  drawRuler(w); drawTiles(); drawMarkers(); drawCuts(); drawSel(); tick();
}
function drawRuler(w) {
  var c = $("ruler"), dpr = window.devicePixelRatio || 1, h = 26; c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px";
  var g = c.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  var steps = [1 / S.fps * 5, 0.5, 1, 2, 5, 10, 15, 30, 60, 120], major = steps.find(function (s) { return s * S.pps >= 72; }) || 300;
  var minor = major / 5, d = dur(); if (!d) return;
  g.font = "10px " + getComputedStyle(document.body).getPropertyValue("--mono"); g.textBaseline = "top";
  for (var i = 0; i * minor <= d + 1e-6; i++) {
    var t = i * minor, x = Math.round(t * S.pps) + 0.5, isMajor = i % 5 === 0;
    g.strokeStyle = isMajor ? "#55555e" : "#34343b"; g.beginPath(); g.moveTo(x, isMajor ? 14 : 19); g.lineTo(x, h); g.stroke();
    if (isMajor) { g.fillStyle = "#7a7a84"; var s = Math.floor(t + 1e-6), lab = pad(Math.floor(s / 60)) + ":" + pad(s % 60); if (major < 1) lab += ":" + pad(Math.round((t - s) * S.fps)); g.fillText(lab, x + 4, 4); }
  }
}
function drawTiles() {
  var box = $("tiles"); box.replaceChildren(); var d = dur(); if (!d || !S.strip || !S.strip.naturalWidth) return;
  var n = S.stripN, fw = S.strip.naturalWidth / n, fh = S.strip.naturalHeight, h = 52, tw = fw * h / fh, total = d * S.pps, count = Math.ceil(total / tw);
  for (var i = 0; i < count; i++) {
    var mid = Math.min(d, (i * tw + tw / 2) / S.pps), idx = Math.min(n - 1, Math.floor(mid / d * n));
    box.append(el("div", { className: "tile", style: "left:" + (i * tw) + "px;width:" + tw + "px;background-image:url(" + S.strip.src + ");background-size:" + (n * tw) + "px " + h + "px;background-position:-" + (idx * tw) + "px 0" }));
  }
}
function drawMarkers() {
  var lane = $("lane"); lane.querySelectorAll(".marker").forEach(function (m) { m.remove(); });
  $("lanePh").style.display = S.notes.length || S.inT != null ? "none" : "";
  S.notes.forEach(function (n, i) {
    var m = el("div", { className: "marker" + (n.end !== undefined ? " span" : "") + (n.status === "fixed" ? " fixed" : "") });
    m.dataset.id = n.id; m.style.left = (n.t * S.pps) + "px";
    if (n.end !== undefined) { m.style.width = Math.max(18, (n.end - n.t) * S.pps) + "px"; m.append(el("div", { className: "bar" })); }
    m.append(el("div", { className: "pin", textContent: String(i + 1) }));
    m.onpointerdown = function (e) { e.stopPropagation(); };
    m.onclick = function (e) { e.stopPropagation(); focusNote(n.id, true); };
    m.onmouseenter = function (e) { var tip = $("tip"); tip.replaceChildren(el("b", { textContent: n.end !== undefined ? short(n.t) + " → " + short(n.end) : short(n.t) }), document.createTextNode(n.text)); tip.style.display = "block"; moveTip(e); };
    m.onmousemove = moveTip; m.onmouseleave = function () { $("tip").style.display = "none"; };
    lane.append(m);
  });
}
function moveTip(e) { var tip = $("tip"); tip.style.left = Math.min(window.innerWidth - 300, e.clientX + 12) + "px"; tip.style.top = (e.clientY - tip.offsetHeight - 12) + "px"; }
function drawSel() {
  var s = $("sel"), a = S.inT, b = S.outT;
  if (a == null) { s.classList.remove("on"); $("rangeLbl").classList.remove("on"); return; }
  var end = b == null ? a : b; s.classList.add("on"); s.style.left = (Math.min(a, end) * S.pps) + "px"; s.style.width = Math.max(1, Math.abs(end - a) * S.pps) + "px";
  $("rangeLbl").classList.add("on"); $("rangeTxt").textContent = b == null ? "In " + short(a) + " → set Out" : short(Math.min(a, b)) + " → " + short(Math.max(a, b)) + "  (" + Math.abs(b - a).toFixed(1) + "s)";
  $("lanePh").style.display = "none";
}
function xToT(e) { var r = $("inner").getBoundingClientRect(); return Math.max(0, Math.min(dur(), (e.clientX - r.left) / S.pps)); }
$("tracks").addEventListener("pointerdown", function (e) {
  if (!video() || e.button !== 0) return;
  var inLane = e.target.closest("#lane") || e.target.closest("#cutLane"), cutting = !!e.target.closest("#cutLane"), start = xToT(e), moved = false; $("tracks").setPointerCapture(e.pointerId);
  if (inLane) { video().pause(); S.inT = start; S.outT = null; drawSel(); } else seek(start);
  function mv(ev) { var t = xToT(ev); if (inLane) { if (Math.abs(t - start) * S.pps > 3) moved = true; S.outT = t; drawSel(); seek(t); } else seek(t); }
  function up(ev) { $("tracks").removeEventListener("pointermove", mv); $("tracks").removeEventListener("pointerup", up);
    if (inLane) { if (moved && Math.abs(S.outT - S.inT) >= 0.1) { normaliseRange(); if (cutting) makeCut(); else { seek(S.inT); openCompose(); } }
      else { S.inT = S.outT = null; S.cutSel = null; drawSel(); drawCuts(); seek(start); } } }
  $("tracks").addEventListener("pointermove", mv); $("tracks").addEventListener("pointerup", up);
});
$("tracks").addEventListener("wheel", function (e) { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(S.zoom - e.deltaY * 0.4); }, { passive: false });
function setZoom(z) { var tr = $("tracks"), v = video(), t = v ? v.currentTime : 0, off = t * S.pps - tr.scrollLeft;
  S.zoom = Math.max(0, Math.min(100, z)); $("zoom").value = S.zoom; layout(); tr.scrollLeft = t * S.pps - off; }
function normaliseRange() { if (S.inT != null && S.outT != null && S.outT < S.inT) { var x = S.inT; S.inT = S.outT; S.outT = x; } }
function markIn() { var v = video(); if (!v) return; S.inT = v.currentTime; if (S.outT != null && S.outT <= S.inT) S.outT = null; drawSel(); }
function markOut() { var v = video(); if (!v) return; if (S.inT == null) { S.inT = 0; } S.outT = v.currentTime; normaliseRange(); drawSel(); }
function clearRange() { S.inT = S.outT = null; drawSel(); drawMarkers(); }

/* ---------------- notes */
function loadNotes() { if (!S.cur) return Promise.resolve();
  return api("/api/notes" + q()).then(function (j) { S.notes = j.notes; S.cuts = (j.edits && j.edits.cuts) || []; S.exportSpeed = j.edits && j.edits.speed != null ? j.edits.speed : null;
    S.appliedSpeed = (j.applied && j.applied.speed) || 1; S.editable = !!(j.applied && j.applied.editable); drawNotes(); drawMarkers(); drawCuts(); drawExport();
    var v = S.videos.find(function (x) { return x.v === S.cur; }); if (v) { v.open = S.notes.filter(function (n) { return n.status === "open"; }).length; v.total = S.notes.length; drawMedia(); } }); }
function askText() { return "fix my review notes on " + S.cur; }
function drawNotes() {
  var open = S.notes.filter(function (n) { return n.status === "open"; }), fixed = S.notes.filter(function (n) { return n.status === "fixed"; });
  $("nOpen").textContent = open.length; $("nFixed").textContent = fixed.length;
  $("openChip").hidden = !open.length; $("openCount").textContent = open.length + " open"; $("copyAsk").hidden = !open.length;
  $("ask").classList.toggle("on", open.length > 0); $("askText").textContent = askText();
  var list = S.tab === "open" ? open : fixed, box = $("notes"); box.replaceChildren();
  list.forEach(function (n) { box.append(noteCard(n, S.notes.indexOf(n) + 1)); });
  if (!list.length) box.append(el("div", { className: "empty", style: "padding:36px 24px" }, S.tab === "open"
    ? (S.notes.length ? "All notes are resolved." : "No notes yet. Press N at any moment, or drag across the notes lane to mark a few seconds.")
    : "Nothing resolved yet."));
}
function noteCard(n, num) {
  var card = el("div", { className: "note" + (n.status === "fixed" ? " fixed" : "") + (S.selected === n.id ? " on" : "") + (S.editing === n.id ? " editing" : "") });
  card.dataset.id = n.id; card.onclick = function () { focusNote(n.id, false); };
  var thumb = n.frame ? el("img", { className: "nthumb", src: "/api/frame" + q() + "&id=" + n.id, alt: "" }) : el("div", { className: "nthumb" });
  var time = el("span", { className: "tchip", textContent: n.end !== undefined ? short(n.t) + " → " + short(n.end) : short(n.t) });
  var top = el("div", { className: "ntop" }, el("span", { className: "tag", textContent: "#" + num }), time,
    n.end !== undefined ? el("span", { className: "len", textContent: (n.end - n.t).toFixed(1) + "s" }) : null,
    n.earlierCut ? el("span", { className: "tag", title: "Written on an earlier render: the moment may have moved", textContent: "earlier cut" }) : null);
  var body = el("div", { className: "nbody" }, top);
  if (S.editing === n.id) {
    var ta = el("textarea", { className: "field", value: n.text });
    ta.onclick = function (e) { e.stopPropagation(); };
    ta.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); S.editing = null; drawNotes(); } };
    var save = function () { var t = ta.value.trim(); if (!t) return; S.editing = null; patch(n.id, { text: t }); };
    body.append(ta); setTimeout(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  } else body.append(el("div", { className: "ntext", textContent: n.text }));
  if (n.caption) body.append(el("div", { className: "ncap", html: ICON.quote }, el("span", { textContent: n.caption })));
  if (n.fix) body.append(el("div", { className: "ncap", html: ICON.check }, el("span", { textContent: n.fix })));
  var del = S.confirmDel === n.id;
  var acts = el("div", { className: "acts" },
    el("button", { className: "icon", title: n.status === "fixed" ? "Reopen" : "Resolve", html: n.status === "fixed" ? ICON.undo : ICON.check, onclick: function (e) { e.stopPropagation(); patch(n.id, { status: n.status === "fixed" ? "open" : "fixed" }); } }),
    el("button", { className: "icon", title: "Edit", html: ICON.edit, onclick: function (e) { e.stopPropagation(); S.editing = n.id; drawNotes(); } }),
    el("button", { className: "icon" + (del ? " danger" : ""), title: del ? "Click again to delete" : "Delete", html: ICON.trash, onclick: function (e) { e.stopPropagation();
      if (del) { S.confirmDel = null; remove(n.id); } else { S.confirmDel = n.id; drawNotes(); setTimeout(function () { if (S.confirmDel === n.id) { S.confirmDel = null; drawNotes(); } }, 2500); } } }));
  card.append(thumb, body, acts);
  return card;
}
function focusNote(id, scroll) {
  var n = S.notes.find(function (x) { return x.id === id; }); if (!n) return;
  S.selected = id; if (n.status === "fixed" && S.tab !== "fixed") { S.tab = "fixed"; setTabs(); }
  var v = video(); if (v) v.pause(); seek(n.t);
  if (n.end !== undefined) { S.inT = n.t; S.outT = n.end; } else { S.inT = S.outT = null; } drawSel();
  drawNotes(); if (scroll) { var c = document.querySelector('.note[data-id="' + id + '"]'); if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}
function grab(v) { try { var sc = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight)); var c = el("canvas", { width: Math.round(v.videoWidth * sc), height: Math.round(v.videoHeight * sc) });
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.85); } catch (e) { return null; } }
function openCompose() {
  var v = video(); if (!v) return; v.pause();
  var span = S.inT != null && S.outT != null && Math.abs(S.outT - S.inT) >= 0.1;
  var t = span ? Math.min(S.inT, S.outT) : v.currentTime, end = span ? Math.max(S.inT, S.outT) : null;
  function finish() { S.pending = { t: t, end: end, frame: grab(v) }; $("cImg").src = S.pending.frame || ""; drawCompose();
    $("compose").classList.add("on"); if (S.tab !== "open") { S.tab = "open"; setTabs(); drawNotes(); } $("cText").value = ""; $("cText").focus(); }
  if (Math.abs(v.currentTime - t) > 0.02) { v.currentTime = t; v.addEventListener("seeked", finish, { once: true }); } else finish();
}
function drawCompose() {
  var p = S.pending; if (!p) return;
  $("cTime").textContent = p.end != null ? short(p.t) + " → " + short(p.end) : short(p.t);
  var line = $("cSpan"); line.replaceChildren();
  if (p.end != null) line.append(el("span", { textContent: (p.end - p.t).toFixed(1) + "s span · stills from its start, middle and end are saved" }), el("button", { className: "link", textContent: "Make it one moment", onclick: function () { p.end = null; drawCompose(); } }));
  else line.append(el("span", { textContent: "One moment." }), el("button", { className: "link", textContent: "End at playhead", title: "Play on, then click to make this a span", onclick: function () { var v = video(); if (v && v.currentTime > p.t + 0.05) { p.end = v.currentTime; drawCompose(); } else toast("Move the playhead past the start first"); } }));
}
function closeCompose() { $("compose").classList.remove("on"); S.pending = null; }
function saveNote() {
  var text = $("cText").value.trim(), p = S.pending; if (!p) return; if (!text) { $("cText").focus(); return; }
  api("/api/notes" + q(), { method: "POST", body: { t: p.t, end: p.end, text: text, frame: p.frame } })
    .then(function (n) { closeCompose(); clearRange(); S.selected = n.id; toast(p.end != null ? "Note saved for " + short(p.t) + " → " + short(p.end) : "Note saved at " + short(p.t)); return loadNotes(); })
    .catch(function (e) { toast("Couldn't save: " + e.message); });
}
function patch(id, body) { body.id = id; return api("/api/notes" + q(), { method: "PATCH", body: body }).then(loadNotes).catch(function (e) { toast(e.message); }); }
function remove(id) { return api("/api/notes" + q(), { method: "DELETE", body: { id: id } }).then(function () { toast("Note deleted"); return loadNotes(); }).catch(function (e) { toast(e.message); }); }
function setTabs() { $("tabOpen").classList.toggle("on", S.tab === "open"); $("tabFixed").classList.toggle("on", S.tab === "fixed"); }
function copyAsk() { var t = askText(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copied. Paste it to Claude"); }, function () { toast(t); }); }

/* ---------------- cuts, export speed, apply */
function drawCuts() {
  var lane = $("cutLane"); if (!lane) return; lane.querySelectorAll(".cutr").forEach(function (c) { c.remove(); });
  document.querySelectorAll(".cutshade").forEach(function (c) { c.remove(); });
  $("cutPh").style.display = S.cuts.length ? "none" : "";
  S.cuts.forEach(function (c) {
    var r = el("div", { className: "cutr" + (S.cutSel === c.id ? " on" : ""), title: short(c.t) + " → " + short(c.end) + " (" + (c.end - c.t).toFixed(1) + "s) will be cut" },
      el("button", { className: "x", title: "Keep this part", html: GLYPH.x, onclick: function (e) { e.stopPropagation(); removeCut(c.id); } }));
    r.style.left = (c.t * S.pps) + "px"; r.style.width = Math.max(6, (c.end - c.t) * S.pps) + "px";
    r.onpointerdown = function (e) { e.stopPropagation(); };
    r.onclick = function (e) { e.stopPropagation(); S.cutSel = c.id; var v = video(); if (v) v.pause(); seek(Math.max(0, c.t - 1.5)); drawCuts(); };
    lane.append(r);
    var sh = el("div", { className: "cutshade" }); sh.style.left = (c.t * S.pps) + "px"; sh.style.width = Math.max(1, (c.end - c.t) * S.pps) + "px"; $("inner").append(sh);
  });
  $("skipBtn").classList.toggle("on", S.skip); $("skipBtn").style.color = S.skip ? "var(--accent)" : "";
  drawExport();
}
function makeCut() {
  if (S.inT == null || S.outT == null || Math.abs(S.outT - S.inT) < 0.1) { toast("Mark a span first: drag across the cuts lane, or I and O"); return; }
  var a = Math.min(S.inT, S.outT), b = Math.max(S.inT, S.outT);
  api("/api/cuts" + q(), { method: "POST", body: { t: a, end: b } }).then(function (c) { S.inT = S.outT = null; drawSel(); S.cutSel = c.id; toast("Marked " + short(a) + " → " + short(b) + " to cut. Apply edits to render it."); return loadNotes(); })
    .catch(function (e) { toast(e.message); });
}
function removeCut(id) { api("/api/cuts" + q(), { method: "DELETE", body: { id: id } }).then(function () { if (S.cutSel === id) S.cutSel = null; return loadNotes(); }).catch(function (e) { toast(e.message); }); }
function cutTotal() { return S.cuts.reduce(function (s, c) { return s + (c.end - c.t); }, 0); }
function targetSpeed() { return S.exportSpeed != null ? S.exportSpeed : S.appliedSpeed; }
function newLength() { return Math.max(0, (dur() - cutTotal()) * S.appliedSpeed / targetSpeed()); }
function drawExport() {
  var sel = $("exportSel"), btn = $("applyBtn"); if (!S.cur || document.querySelector(".app").classList.contains("plan")) { sel.hidden = btn.hidden = true; return; }
  sel.hidden = false; sel.replaceChildren();
  EXPORTS.forEach(function (x) { sel.append(el("option", { value: String(x), textContent: "Export " + x + "×" + (x === S.appliedSpeed ? " (now)" : ""), selected: x === targetSpeed() })); });
  var pending = S.cuts.length > 0 || (S.exportSpeed != null && S.exportSpeed !== S.appliedSpeed);
  if (S.applying) { btn.hidden = false; btn.disabled = true; btn.className = "btn busy"; btn.replaceChildren(el("span", { className: "spin" }), el("span", { textContent: "Rendering… " + Math.floor((Date.now() - S.applying) / 1000) + "s" })); return; }
  btn.disabled = false; btn.className = "btn accent"; btn.hidden = !pending;
  btn.replaceChildren(el("span", { textContent: S.editable ? "Apply edits → " + short(newLength()) : "Edits ready → " + short(newLength()) }));
  btn.title = S.editable ? "Re-render with your cuts and speed (keeps a backup of the spec)" : "This video can't be re-rendered from here yet: ask Claude to apply the edits";
}
function applyEdits() {
  if (!S.editable) { toast("Ask Claude: apply my review edits on " + S.cur); return; }
  var v = video(); if (v) v.pause(); var target = S.cur;
  api("/api/apply" + q(), { method: "POST", body: {} }).then(function () { S.applying = Date.now(); drawExport(); poll(); }).catch(function (e) { toast(e.message); });
  function poll() { api("/api/apply?v=" + encodeURIComponent(target)).then(function (j) {
      if (j.state === "running") { drawExport(); setTimeout(poll, 1500); return; }
      S.applying = null;
      if (j.state === "done") { var r = j.result || {};
        toast("Re-rendered" + (r.removed ? ", " + r.removed.toFixed(1) + "s cut" : "") + (r.speed ? ", at " + r.speed + "×" : "") + (r.qa ? ". " + r.qa : ""));
        loadVideos().then(function () { if (S.cur === target) select(target); }); }
      else { toast("Couldn't apply: " + (j.error || "the render failed")); drawExport(); }
    }).catch(function () { setTimeout(poll, 3000); }); }
}

/* ---------------- planner */
var P = { plans: [], planId: null, platform: "instagram", sel: null, adding: false, dragFrom: null, saveT: null };
var GLYPH = {
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>',
  reel: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8h18M8 3l3 5M14 3l3 5M10.5 11.5v5l4.5-2.5z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};
function plan() { return P.plans.find(function (p) { return p.id === P.planId; }) || null; }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan"; }
function vname(v) { return v.split("/").pop().replace(/\.mp4$/i, "").replace(/-(vertical|landscape|square)$/i, ""); }
function posterUrl(it) { return "/api/poster?v=" + encodeURIComponent(it.v) + (it.cover != null ? "&t=" + it.cover : "") + ver(it.v); }
function known(v) { return S.videos.some(function (x) { return x.v === v; }); }
function loadPlans() { return api("/api/plans").then(function (j) { P.plans = j.plans;
  if (!P.plans.length) P.plans = [{ id: "plan", name: "My plan", handles: {}, items: [] }];
  var want = (location.hash.match(/plan=([^&]+)/) || [])[1]; P.planId = (want && P.plans.some(function (p) { return p.id === want; })) ? want : P.plans[0].id; }); }
function savePlans() { clearTimeout(P.saveT); $("savedLbl").textContent = "Saving…";
  P.saveT = setTimeout(function () { api("/api/plans", { method: "PUT", body: { plans: P.plans } }).then(function (j) { P.plans = j.plans; $("savedLbl").textContent = "Saved"; setTimeout(function () { $("savedLbl").textContent = ""; }, 1500); })
    .catch(function (e) { $("savedLbl").textContent = ""; toast("Couldn't save the plan: " + e.message); }); }, 350); }
function setView(v) { var isPlan = v === "plan"; document.querySelector(".app").classList.toggle("plan", isPlan); $("vReview").classList.toggle("on", !isPlan); $("vPlan").classList.toggle("on", isPlan);
  if (isPlan) { var vid = video(); if (vid) vid.pause(); drawPlanner(); $("file").replaceChildren(el("b", { textContent: (plan() || {}).name || "Planner" }), el("span", { textContent: "posting plan" })); }
  else if (S.cur) { var name = S.cur.split("/").pop(), p = prettyJob(S.cur.split("/").slice(0, -1).join("/")); $("file").replaceChildren(el("b", { textContent: name }), el("span", { textContent: (p.biz ? p.biz + " · " : "") + p.name })); }
  else $("file").replaceChildren(el("span", { textContent: "Pick a video to review" }));
  drawExport();
  history.replaceState(null, "", isPlan ? "#planner&plan=" + encodeURIComponent(P.planId || "") : (S.cur ? "#v=" + encodeURIComponent(S.cur) : "#")); }
function openInEditor(v) { setView("review"); select(v); }
function drawPlanner() { var pl = plan(); if (!pl) return; drawPlanList(); drawAddList(); drawPhone(); drawSide(); $("pCount").textContent = pl.items.length ? "· " + pl.items.length : ""; }
function drawPlanList() {
  var pl = plan(), sel = $("pSelect"); sel.replaceChildren();
  P.plans.forEach(function (p) { sel.append(el("option", { value: p.id, textContent: p.name, selected: p.id === P.planId })); });
  sel.append(el("option", { value: "__new", textContent: "+ New plan…" }));
  var box = $("pList"); box.replaceChildren();
  pl.items.forEach(function (it, i) {
    var row = el("div", { className: "prow" + (P.sel === i ? " on" : ""), draggable: true },
      el("span", { className: "grip", html: GLYPH.grip }), el("span", { className: "ord", textContent: String(i + 1) }), el("img", { src: posterUrl(it), alt: "", loading: "lazy" }),
      el("div", { className: "pm" }, el("div", { className: "pn", textContent: it.title || vname(it.v) }),
        el("div", { className: "ps" + (known(it.v) ? "" : " missing"), textContent: known(it.v) ? (it.date ? new Date(it.date + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "No date") + (it.pinned ? " · pinned" : "") : "Video not found" })),
      el("button", { className: "icon" + (it.pinned ? " on" : ""), title: it.pinned ? "Unpin" : "Pin to the top (Instagram, TikTok)", html: GLYPH.pin, onclick: function (e) { e.stopPropagation(); togglePin(i); } }));
    row.onclick = function () { P.sel = i; drawPlanner(); };
    row.ondblclick = function () { openInEditor(it.v); };
    row.ondragstart = function (e) { P.dragFrom = i; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; };
    row.ondragend = function () { row.classList.remove("dragging"); document.querySelectorAll(".prow.over").forEach(function (r) { r.classList.remove("over"); }); };
    row.ondragover = function (e) { e.preventDefault(); row.classList.add("over"); };
    row.ondragleave = function () { row.classList.remove("over"); };
    row.ondrop = function (e) { e.preventDefault(); var from = P.dragFrom; if (from == null || from === i) return; var moved = pl.items.splice(from, 1)[0]; pl.items.splice(i, 0, moved);
      P.sel = i; P.dragFrom = null; savePlans(); drawPlanner(); };
    box.append(row);
  });
  if (!pl.items.length) box.append(el("div", { className: "empty", style: "padding:30px 20px", textContent: "No videos in this plan yet. Use Add videos." }));
}
function drawAddList() {
  var pl = plan(), box = $("pAddList"); box.classList.toggle("on", P.adding); box.replaceChildren(); if (!P.adding) return;
  var inPlan = {}; pl.items.forEach(function (it) { inPlan[it.v] = true; });
  var list = S.videos.filter(function (v) { return RENDER.test(v.name) && !inPlan[v.v]; });
  list.forEach(function (v) { box.append(el("div", { className: "arow" }, el("img", { src: "/api/poster?v=" + encodeURIComponent(v.v), alt: "", loading: "lazy" }),
    el("span", { className: "pn", title: v.v, textContent: vname(v.v) + " · " + prettyJob(v.folder).name }),
    el("button", { className: "icon", title: "Add to the end", html: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', onclick: function () { pl.items.push({ v: v.v }); savePlans(); drawPlanner(); } }))); });
  if (!list.length) box.append(el("div", { className: "muted", style: "padding:8px;font-size:12px", textContent: "Every edited video is already in this plan." }));
}
function togglePin(i) { var pl = plan(), it = pl.items[i]; if (!it.pinned && pl.items.filter(function (x) { return x.pinned; }).length >= 3) { toast("Instagram and TikTok allow 3 pinned posts"); return; }
  it.pinned = !it.pinned; if (!it.pinned) delete it.pinned; savePlans(); drawPlanner(); }
function gridOrder(pl, pins) { var idx = pl.items.map(function (_, i) { return i; }).reverse();
  if (!pins) return idx; return idx.filter(function (i) { return pl.items[i].pinned; }).concat(idx.filter(function (i) { return !pl.items[i].pinned; })); }
function tileFor(pl, i, kind) {
  var it = pl.items[i], top = el("div", { className: "r" }), bottom = el("div", { className: "r" });
  if (kind === "instagram") { top.append(el("span"), it.pinned ? el("span", { html: GLYPH.pin }) : el("span", { html: GLYPH.reel })); bottom.append(el("span", { html: GLYPH.play }), el("span")); }
  if (kind === "tiktok") { top.append(it.pinned ? el("span", { className: "pinned-tt", textContent: "Pinned" }) : el("span"), el("span")); bottom.append(el("span", { style: "display:flex;align-items:center;gap:3px", html: GLYPH.play + "0" }), el("span")); }
  if (kind === "youtube") { bottom.append(el("span", { textContent: "0 views" }), el("span")); }
  var t = el("div", { className: "tile" + (P.sel === i ? " on" : "") + (known(it.v) ? "" : " missing") }, el("img", { src: posterUrl(it), alt: "", loading: "lazy" }),
    el("div", { className: "ov" }, top, bottom),
    el("div", { className: "hov" }, el("span", { className: "ordtag", textContent: "#" + (i + 1) + (it.date ? " · " + it.date.slice(5) : "") }),
      el("button", { className: "edit", textContent: "Edit", title: "Open in the editor", onclick: function (e) { e.stopPropagation(); openInEditor(it.v); } })));
  t.onclick = function () { P.sel = i; drawPlanner(); };
  t.ondblclick = function () { openInEditor(it.v); };
  return t;
}
function drawPhone() {
  var pl = plan(), sc = $("screen"), kind = P.platform, h = pl.handles || {}, n = pl.items.length; sc.replaceChildren();
  sc.className = "screen " + (kind === "tiktok" ? "tt" : kind === "youtube" ? "yt" : "ig");
  sc.append(el("div", { className: "notch" }, el("span", { textContent: "9:41" }), el("span", { className: "island" }), el("span", { textContent: "●●●" })));
  var handle = (h[kind] || "@yourhandle").replace(/^@/, ""), initial = handle.charAt(0).toUpperCase(), grid = el("div", { className: "pgrid" });
  gridOrder(pl, kind !== "youtube").forEach(function (i) { grid.append(tileFor(pl, i, kind)); });
  var fill = (3 - (n % 3)) % 3 + (n < 6 ? 3 : 0); for (var k = 0; k < fill; k++) grid.append(el("div", { className: "tile ghost" }));
  if (kind === "instagram") {
    sc.append(el("div", { className: "pf-head" },
      el("div", { style: "font-weight:700;font-size:17px;margin:2px 0 12px", textContent: handle }),
      el("div", { className: "pf-top" }, el("div", { className: "ig-ring" }, el("div", { className: "avatar", style: "width:78px;height:78px;font-size:28px", textContent: initial })),
        el("div", { className: "stats" }, el("div", {}, el("b", { textContent: String(n) }), el("span", { textContent: "posts" })), el("div", {}, el("b", { textContent: "—" }), el("span", { textContent: "followers" })), el("div", {}, el("b", { textContent: "—" }), el("span", { textContent: "following" })))),
      el("div", { className: "pf-name", textContent: pl.name }), el("div", { className: "bioline", style: "width:82%" }), el("div", { className: "bioline", style: "width:58%" }),
      el("div", { className: "pf-btns" }, el("div", { textContent: "Edit profile" }), el("div", { textContent: "Share profile" }))),
      el("div", { className: "pf-tabs" }, el("div", { className: "on", html: GLYPH.grid }), el("div", { html: GLYPH.reel }), el("div", { html: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>' })), grid);
  } else if (kind === "tiktok") {
    sc.append(el("div", { className: "tt-head" }, el("div", { className: "avatar", style: "width:92px;height:92px;font-size:32px", textContent: initial }),
      el("div", { style: "font-weight:700;font-size:16px", textContent: "@" + handle }),
      el("div", { className: "tt-stats" }, el("div", {}, el("b", { textContent: "—" }), el("span", { textContent: "Following" })), el("div", {}, el("b", { textContent: "—" }), el("span", { textContent: "Followers" })), el("div", {}, el("b", { textContent: "—" }), el("span", { textContent: "Likes" }))),
      el("span", { className: "tt-btn", textContent: "Edit profile" })),
      el("div", { className: "pf-tabs" }, el("div", { className: "on", html: GLYPH.grid }), el("div", { html: GLYPH.pin })), grid);
  } else {
    sc.append(el("div", { className: "yt-banner" }), el("div", { className: "yt-chan" }, el("div", { className: "avatar", style: "width:68px;height:68px;font-size:26px", textContent: initial }),
      el("div", {}, el("b", { textContent: pl.name }), el("span", { textContent: "@" + handle + " · — subscribers · " + n + " videos" }))),
      el("div", { className: "yt-sub", textContent: "Subscribe" }),
      el("div", { className: "pf-tabs" }, el("div", { textContent: "Home" }), el("div", { textContent: "Videos" }), el("div", { className: "on", textContent: "Shorts" })), el("div", { style: "height:8px" }), grid);
  }
  if (!n) sc.append(el("div", { className: "pempty", textContent: "Add videos on the left to see how the profile will look." }));
}
function drawSide() {
  var pl = plan(), box = $("pSide"); box.replaceChildren();
  var it = P.sel != null ? pl.items[P.sel] : null;
  if (!it) {
    var h = pl.handles || (pl.handles = {});
    var field = function (label, val, set, ph) { var i = el("input", { className: "plain", value: val || "", placeholder: ph || "" }); i.oninput = function () { set(i.value); savePlans(); if (label === "Plan name") { drawPlanList(); } drawPhone(); };
      return el("div", { className: "fieldrow" }, el("label", { textContent: label }), i); };
    box.append(el("div", { className: "phead" }, el("h2", { textContent: "Profile" })),
      field("Plan name", pl.name, function (v) { pl.name = v; }),
      field("Instagram handle", h.instagram, function (v) { h.instagram = v; }, "@yourhandle"),
      field("TikTok handle", h.tiktok, function (v) { h.tiktok = v; }, "@yourhandle"),
      field("YouTube handle", h.youtube, function (v) { h.youtube = v; }, "@yourchannel"),
      el("div", { className: "tip2", textContent: "Click a video in the list or the preview to set its cover, title, date and pin. Double-click it, or press its Edit chip, to open it in the editor." }),
      P.plans.length > 1 ? el("div", { className: "dacts" }, el("button", { className: "btn ghost dangerous", textContent: "Delete this plan", onclick: function () { if (!confirmTwice(this)) return; P.plans = P.plans.filter(function (p) { return p.id !== pl.id; }); P.planId = P.plans[0].id; P.sel = null; savePlans(); drawPlanner(); } })) : "");
    return;
  }
  var i = P.sel, dv = el("video", { src: "/api/video?v=" + encodeURIComponent(it.v), muted: true, preload: "auto", playsInline: true });
  var crop = el("div", { className: "crop" }, el("span", { textContent: P.platform === "youtube" ? "9:16" : "3:4 grid crop" }));
  var cover = el("div", { className: "cover" }, dv, P.platform === "youtube" ? null : crop);
  var slider = el("input", { type: "range", min: "0", max: "1", step: "0.1", value: String(it.cover || 0), style: "width:100%" });
  var tlabel = el("span", { className: "mono", textContent: short(it.cover || 0) });
  dv.addEventListener("loadedmetadata", function () { slider.max = String(Math.max(0.1, dv.duration - 0.05)); var start = it.cover != null ? it.cover : Math.round(Math.min(1, dv.duration / 3) * 10) / 10;
    dv.currentTime = start; slider.value = String(start); tlabel.textContent = short(start);
    // where the 3:4 crop sits on this video's frame
    var r = dv.videoWidth / dv.videoHeight, boxR = 9 / 16, contentH = r >= boxR ? (boxR / r) : 1, cropH = Math.min(1, (dv.videoWidth * 4 / 3) / dv.videoHeight) * contentH;
    crop.style.top = ((1 - cropH) / 2 * 100) + "%"; crop.style.height = (cropH * 100) + "%"; });
  slider.oninput = function () { dv.currentTime = Number(slider.value); tlabel.textContent = short(Number(slider.value)); };
  var input = function (label, type, val, set, ph) { var x = el("input", { className: "plain", type: type, value: val || "", placeholder: ph || "" }); x.onchange = x.oninput = function () { set(x.value); savePlans(); drawPlanList(); drawPhone(); };
    return el("div", { className: "fieldrow" }, el("label", { textContent: label }), x); };
  var sw = el("div", { className: "sw" + (it.pinned ? " on" : "") });
  box.append(el("div", { className: "phead" }, el("h2", { textContent: "#" + (i + 1) + "  " + (it.title || vname(it.v)) }), el("button", { className: "icon", title: "Close", html: GLYPH.x, onclick: function () { P.sel = null; drawPlanner(); } })),
    el("div", { className: "scroll" },
      el("div", { style: "display:flex;flex-direction:column" }, cover),
      el("div", { className: "fieldrow" }, el("label", { style: "display:flex;justify-content:space-between" }, el("span", { textContent: "Cover frame" }), tlabel), slider,
        el("button", { className: "btn", style: "justify-content:center", textContent: "Use this frame as the cover", onclick: function () { it.cover = Math.round(Number(slider.value) * 10) / 10; savePlans(); toast("Cover set at " + short(it.cover)); drawPlanList(); drawPhone(); } })),
      input("Title (YouTube, and your reference)", "text", it.title, function (v) { it.title = v || undefined; }, vname(it.v)),
      input("Post date", "date", it.date, function (v) { it.date = v || undefined; }),
      el("div", { className: "toggle2", onclick: function () { togglePin(i); } }, el("span", { textContent: "Pinned on Instagram and TikTok" }), sw),
      el("div", { className: "dacts" }, el("button", { className: "btn accent", textContent: "Open in editor", onclick: function () { openInEditor(it.v); } }),
        el("button", { className: "btn ghost dangerous", textContent: "Remove", onclick: function () { pl.items.splice(i, 1); P.sel = null; savePlans(); drawPlanner(); } }))));
}
function confirmTwice(btn) { if (btn.dataset.armed) return true; btn.dataset.armed = "1"; var t = btn.textContent; btn.textContent = "Click again to delete"; setTimeout(function () { delete btn.dataset.armed; btn.textContent = t; }, 2500); return false; }

/* ---------------- wiring */
$("cutBtn").onclick = makeCut;
$("skipBtn").onclick = function () { S.skip = !S.skip; drawCuts(); toast(S.skip ? "Playback skips the parts marked to cut" : "Playback shows everything"); };
$("exportSel").onchange = function () { var x = Number($("exportSel").value);
  api("/api/speed" + q(), { method: "PUT", body: { speed: x === S.appliedSpeed ? null : x } }).then(loadNotes).catch(function (e) { toast(e.message); }); };
$("applyBtn").onclick = applyEdits;
$("vReview").onclick = function () { setView("review"); };
$("vPlan").onclick = function () { (P.plans.length ? Promise.resolve() : loadPlans()).then(function () { setView("plan"); }); };
$("platforms").querySelectorAll("button").forEach(function (b) { b.onclick = function () { P.platform = b.dataset.p; $("platforms").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); }); drawPhone(); drawSide(); }; });
$("pAdd").onclick = function () { P.adding = !P.adding; drawAddList(); };
$("pSelect").onchange = function () { var v = $("pSelect").value;
  if (v === "__new") { var name = prompt("Name the new plan", "Next week"); if (name && name.trim()) { var id = slug(name), k = 2; while (P.plans.some(function (p) { return p.id === id; })) id = slug(name) + "-" + k++;
      P.plans.push({ id: id, name: name.trim(), handles: Object.assign({}, (plan() || {}).handles || {}), items: [] }); P.planId = id; P.sel = null; savePlans(); } }
  else { P.planId = v; P.sel = null; }
  setView("plan"); };
$("segEdited").onclick = function () { S.edited = true; $("segEdited").classList.add("on"); $("segAll").classList.remove("on"); drawMedia(); };
$("segAll").onclick = function () { S.edited = false; $("segAll").classList.add("on"); $("segEdited").classList.remove("on"); drawMedia(); };
$("q").oninput = drawMedia;
$("play").onclick = togglePlay; $("prevFrame").onclick = function () { step(-1); }; $("nextFrame").onclick = function () { step(1); };
$("speed").onclick = function () { S.speedIdx = (S.speedIdx + 1) % S.speeds.length; var s = S.speeds[S.speedIdx]; $("speed").textContent = s.toFixed(1) + "×"; var v = video(); if (v) v.playbackRate = s; };
$("full").onclick = function () { var v = video(); if (v && v.requestFullscreen) v.requestFullscreen(); };
$("noteBtn").onclick = openCompose; $("tlNote").onclick = openCompose; $("markIn").onclick = markIn; $("markOut").onclick = markOut; $("rangeClear").onclick = clearRange;
$("cSave").onclick = saveNote; $("cCancel").onclick = function () { closeCompose(); };
$("cTime").onclick = function () { if (S.pending) seek(S.pending.t); };
$("cText").onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(); } if (e.key === "Escape") { e.preventDefault(); closeCompose(); } };
$("tabOpen").onclick = function () { S.tab = "open"; setTabs(); drawNotes(); }; $("tabFixed").onclick = function () { S.tab = "fixed"; setTabs(); drawNotes(); };
$("copyAsk").onclick = copyAsk; $("copyAsk2").onclick = copyAsk;
$("zoom").oninput = function () { setZoom(Number($("zoom").value)); };
$("zIn").onclick = function () { setZoom(S.zoom + 12); }; $("zOut").onclick = function () { setZoom(S.zoom - 12); }; $("zFit").onclick = function () { setZoom(0); };
$("play").innerHTML = ICON.play;
window.addEventListener("resize", function () { fitVideo(); layout(); });
document.addEventListener("keydown", function (e) {
  if (e.target.closest && e.target.closest("input, textarea, select")) return;
  if (document.querySelector(".app").classList.contains("plan")) return;
  var v = video(); if (!v) return; var k = e.key;
  if (k === " " || k === "k" || k === "K") { e.preventDefault(); togglePlay(); }
  else if (k === "n" || k === "N") { e.preventDefault(); openCompose(); }
  else if (k === "i" || k === "I") { e.preventDefault(); markIn(); }
  else if (k === "o" || k === "O") { e.preventDefault(); markOut(); }
  else if (k === "x" || k === "X") { e.preventDefault(); makeCut(); }
  else if ((k === "Delete" || k === "Backspace") && S.cutSel) { e.preventDefault(); removeCut(S.cutSel); }
  else if (k === "Escape") { if (S.pending) closeCompose(); else clearRange(); }
  else if (k === "ArrowLeft") { e.preventDefault(); seek(v.currentTime - (e.shiftKey ? 5 : 1)); }
  else if (k === "ArrowRight") { e.preventDefault(); seek(v.currentTime + (e.shiftKey ? 5 : 1)); }
  else if (k === "," ) step(-1); else if (k === ".") step(1);
  else if (k === "Home") seek(0); else if (k === "End") seek(dur());
  else if (k === "=" || k === "+") setZoom(S.zoom + 12); else if (k === "-") setZoom(S.zoom - 12);
  else if ((k === "z" || k === "Z") && e.shiftKey) setZoom(0);
  else if (k === "f" || k === "F") { if (v.requestFullscreen) v.requestFullscreen(); }
});
loadVideos().then(function () { if (/^#planner/.test(location.hash)) return loadPlans().then(function () { setView("plan"); });
  var m = location.hash.match(/v=([^&]+)/); if (m) { var v = decodeURIComponent(m[1]); if (S.videos.some(function (x) { return x.v === v; })) select(v); } })
  .catch(function (e) { toast("Couldn't list videos: " + e.message); });
</script>
</body>
</html>
`;
