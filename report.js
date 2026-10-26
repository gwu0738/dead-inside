"use strict";
/**
 * HTML report builder for dead_links_scraper.js
 * - report/index.html            summary, legend and a table of every dead link
 * - report/dead_links_NN.html    `perPage` dead links per file; each one gets a wireframe of the
 *                                source site with the dead link marked, plus the other links on the
 *                                same page and whether they work.
 */
const fs = require("fs");
const path = require("path");

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = n => !n ? "n/a" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`;
const num = n => (n === null || n === undefined || n === "") ? "" : Number(n).toLocaleString("en-US");
const DEAD = new Set(["EXPIRED", "INVALID", "NOT_FOUND", "INVITE_INVALID"]);
const SOURCE_NAME = { CMC: "CoinMarketCap", COINGECKO: "CoinGecko", DEXSCREENER: "DexScreener" };
const PRIO = {
    P1_NO_WORKING_COMMUNITY_LINK: { label: "P1 · no working community link at all", cls: "p1" },
    P2_DEAD_LINK_IS_DISPLAYED: { label: "P2 · dead link is displayed to visitors", cls: "p2" },
    P3_DEAD_LINK_IS_HIDDEN: { label: "P3 · dead link is hidden / not rendered", cls: "p3" },
};
const VIS = {
    VISIBLE: { label: "Visible on load", cls: "vis-ok" },
    BELOW_FOLD: { label: "Below the fold (scroll)", cls: "vis-scroll" },
    HIDDEN_DROPDOWN: { label: "Hidden in dropdown (click)", cls: "vis-hidden" },
    NOT_RENDERED: { label: "Not rendered (data only)", cls: "vis-none" },
    UNKNOWN: { label: "Placement unknown", cls: "vis-none" },
};
const statusPill = l => {
    const dead = DEAD.has(l.status);
    const cls = dead ? "st-dead" : l.status === "VALID" ? "st-ok" : l.status === "USER_ACCOUNT" ? "st-warn" : "st-unk";
    const extra = l.status === "VALID" && l.members ? ` · ${num(l.members)} ${l.kind === "channel" ? "subs" : "members"}` : "";
    return `<span class="pill ${cls}">${dead ? "✖ " : l.status === "VALID" ? "✔ " : "? "}${esc(l.status)}${extra}</span>`;
};
const platIcon = p => p === "discord" ? "💬" : "✈️";

const CSS = `
:root{--bg:#f4f5f7;--card:#fff;--ink:#1b1f24;--muted:#6b7280;--line:#e5e7eb;--red:#d7263d;--red-bg:#fde8eb;--green:#1a7f4b;--green-bg:#e3f5ea;--amber:#9a6700;--amber-bg:#fff4d6;--blue:#2457c5;--blue-bg:#e8efff;--grey-bg:#eef0f3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--blue)}.wrap{max-width:1280px;margin:0 auto;padding:20px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}header.top h1{font-size:22px;margin:0}
nav.pages a,nav.pages span{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;text-decoration:none;margin-left:6px}nav.pages span.cur{background:var(--ink);color:#fff;border-color:var(--ink)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:24px}.tile small{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:22px;overflow:hidden;page-break-inside:avoid}
.card .head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);background:#fafbfc}.card .head .n{font-weight:700;font-size:18px;background:var(--ink);color:#fff;border-radius:8px;padding:2px 10px}
.card .head h2{margin:0;font-size:18px}.card .head .meta{color:var(--muted)}.card .body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:0}
@media(max-width:900px){.card .body{grid-template-columns:1fr}}
.card .wire{padding:16px 18px;border-right:1px solid var(--line)}.card .info{padding:16px 18px}
h3.sec{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid transparent}
.b-cat{background:var(--red-bg);color:var(--red);border-color:#f3b8c0}.b-src{background:var(--blue-bg);color:var(--blue)}.p1{background:#d7263d;color:#fff}.p2{background:#f08c00;color:#fff}.p3{background:#5c6b7a;color:#fff}
.vis-ok{background:var(--green-bg);color:var(--green)}.vis-scroll{background:var(--amber-bg);color:var(--amber)}.vis-hidden{background:var(--red-bg);color:var(--red)}.vis-none{background:var(--grey-bg);color:var(--muted)}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.st-ok{background:var(--green-bg);color:var(--green)}.st-dead{background:var(--red-bg);color:var(--red)}.st-warn{background:var(--amber-bg);color:var(--amber)}.st-unk{background:var(--grey-bg);color:var(--muted)}
.kv{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;margin:0 0 14px}.kv dt{color:var(--muted)}.kv dd{margin:0;word-break:break-word}
.deadurl{font:600 15px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--red);word-break:break-all}
ul.links{list-style:none;padding:0;margin:0}ul.links li{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-top:1px dashed var(--line);flex-wrap:wrap}ul.links li code{font-size:13px;word-break:break-all}
.btn{display:inline-block;padding:7px 12px;border-radius:8px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;margin-top:6px}
.shot{margin-top:14px}.shot img{max-width:100%;border:1px solid var(--line);border-radius:8px}.shot small{color:var(--muted)}
table.list{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}table.list th,table.list td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13px}table.list th{background:#fafbfc;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.legend{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:18px 0;font-size:13px}.legend dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:6px 0 0}.legend dt{font-weight:600}.legend dd{margin:0}
/* ---- wireframes ---- */
.wf{border:2px solid #cfd4db;border-radius:10px;background:#fff;font-size:11px;color:#4b5563;overflow:hidden;position:relative}
.wf .nav{background:#1f2937;color:#e5e7eb;padding:6px 10px;display:flex;gap:12px;align-items:center}.wf .nav b{color:#fff;font-size:12px}.wf .nav i{font-style:normal;opacity:.7}
.wf .cols{display:flex;gap:8px;padding:8px;align-items:flex-start}.wf .col{min-width:0}.wf .box{border:1px dashed #cbd5e1;border-radius:6px;padding:6px 8px;margin-bottom:6px;background:#f8fafc}
.wf .ph{background:repeating-linear-gradient(135deg,#eef2f7 0 6px,#f8fafc 6px 12px);border:1px dashed #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;margin-bottom:6px}
.wf .row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0}.wf .lbl{width:52px;color:#64748b;flex:none}
.wf .chip{display:inline-flex;align-items:center;gap:3px;border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:2px 7px;font-size:11px;white-space:nowrap;position:relative}
.wf .chip.icon{width:22px;height:22px;justify-content:center;padding:0}.wf .chip.dead{border:2px solid var(--red);background:var(--red-bg);color:var(--red);font-weight:700;box-shadow:0 0 0 4px rgba(215,38,61,.18)}
.wf .chip.ok{border:2px solid var(--green);background:var(--green-bg);color:var(--green);font-weight:600}.wf .chip.unk{border:2px solid #94a3b8;background:var(--grey-bg)}.wf .chip.ghost{opacity:.55}
.wf .callout{position:absolute;transform:translateY(-100%);top:-6px;left:50%;margin-left:-6px;background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap}
.wf .okmark{position:absolute;top:-7px;right:-7px;width:14px;height:14px;border-radius:50%;background:var(--green);color:#fff;font-size:9px;line-height:14px;text-align:center;font-weight:700}.wf .okmark.bad{background:#9ca3af}
.wf .callout.ok{background:var(--green)}.wf .callout::after{content:"";position:absolute;left:6px;top:100%;border:5px solid transparent;border-top-color:inherit;border-top-color:var(--red)}.wf .callout.ok::after{border-top-color:var(--green)}
.wf .pop{border:1px solid #cbd5e1;border-radius:8px;background:#fff;box-shadow:0 8px 20px rgba(0,0,0,.12);padding:6px;margin:14px 0 6px 60px;max-width:200px;position:relative}.wf .pop::before{content:"";position:absolute;top:-6px;left:28px;width:10px;height:10px;background:#fff;border-left:1px solid #cbd5e1;border-top:1px solid #cbd5e1;transform:rotate(45deg)}.wf .pop .item{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:5px}.wf .pop .item.dead{background:var(--red-bg);color:var(--red);font-weight:700;outline:2px solid var(--red)}.wf .pop .item.ok{background:var(--green-bg);color:var(--green);font-weight:600}
.wf .fold{border-top:2px dashed #f08c00;color:#9a6700;font-size:10px;font-weight:700;padding:2px 8px;margin:6px -8px;background:#fff8e6;text-align:right}
.wf .hiddenbox{border:2px dashed var(--red);border-radius:6px;padding:6px 8px;margin-top:8px;background:#fff5f6;color:var(--red)}
.wf .note{padding:4px 8px;color:#64748b;font-size:10px;border-top:1px dashed #e2e8f0;background:#fafbfc}
.wf .pillbtn{border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;padding:2px 8px;font-size:11px;position:relative;white-space:nowrap}.wf .pillbtn.dead{border:2px solid var(--red);background:var(--red-bg);color:var(--red);font-weight:700;box-shadow:0 0 0 4px rgba(215,38,61,.18)}.wf .pillbtn.ok{border:2px solid var(--green);background:var(--green-bg);color:var(--green);font-weight:600}.wf .pillbtn.unk{border:2px solid #94a3b8}
.wf .btnrow span{background:#8bc34a;color:#fff;border-radius:5px;padding:2px 8px;margin-right:4px}
.wf .sq{border:1px solid #cbd5e1;border-radius:6px;padding:4px 6px;margin-bottom:4px;background:#fff;display:flex;justify-content:space-between}
@media print{body{background:#fff}.card{break-inside:avoid;box-shadow:none}nav.pages{display:none}}
`;

// ---------------------------------------------------------------------------
// Wireframes
// ---------------------------------------------------------------------------
const chipClass = (l, target) => l === target ? "dead" : DEAD.has(l.status) ? "dead ghost" : l.status === "VALID" || l.status === "USER_ACCOUNT" ? "ok" : "unk";
const chipLabel = l => `${platIcon(l.platform)} ${l.platform === "discord" ? "Discord" : "Telegram"}`;
// only the dead link gets the big callout; working links get a small ✔ corner badge so neighbours don't overlap
const callout = (l, target) => l === target ? `<span class="callout">DEAD LINK HERE</span>` : (l.status === "VALID" ? `<span class="okmark" title="works">✔</span>` : DEAD.has(l.status) ? `<span class="okmark bad" title="also dead">✖</span>` : "");

function wireCMC(target, pageLinks) {
    const rendered = pageLinks.filter(l => l.placement.visibility !== "NOT_RENDERED");
    const visible = rendered.filter(l => l.placement.visibility === "VISIBLE" || l.placement.visibility === "UNKNOWN");
    const hidden = rendered.filter(l => l.placement.visibility === "HIDDEN_DROPDOWN");
    const notRendered = pageLinks.filter(l => l.placement.visibility === "NOT_RENDERED");
    const showPop = target.placement.visibility === "HIDDEN_DROPDOWN" || target.placement.visibility === "UNKNOWN";
    return `<div class="wf">
  <div class="nav"><b>CoinMarketCap</b><i>Markets</i><i>Dashboards</i><i>DexScan</i><i>Exchanges</i><i>Community</i><span style="margin-left:auto;opacity:.6">🔍 Search</span></div>
  <div class="cols">
    <div class="col" style="flex:0 0 46%">
      <div class="box"><b style="font-size:13px;color:#111">${esc(target.project)}</b> <span>${esc(target.symbol)}</span> <span style="float:right">#${esc(target.rank ?? "–")}</span><div style="font-size:16px;font-weight:700;color:#111;margin-top:2px">$ price</div></div>
      <div class="box" style="display:grid;grid-template-columns:1fr 1fr;gap:4px"><span>Market cap</span><span>Volume</span><span>FDV</span><span>Supply</span></div>
      <div class="row"><span class="lbl">Website</span><span class="chip">🌐 Website</span><span class="chip">📄 Whitepaper</span></div>
      <div class="row" style="margin-top:10px"><span class="lbl">Socials</span>
        <span class="chip icon ghost">𝕏</span><span class="chip icon ghost">r/</span>
        ${visible.map(l => `<span class="chip icon ${chipClass(l, target)}" title="${esc(l.url)}">${platIcon(l.platform)}${callout(l, target)}</span>`).join("")}
        <span class="chip icon${hidden.length ? "" : " ghost"}" style="${showPop ? "border-color:#111;color:#111;font-weight:700" : ""}" title="more social links">⌄</span>
        ${hidden.length && !showPop ? `<span style="color:#64748b">(${hidden.length} more inside ⌄)</span>` : ""}
      </div>
      ${showPop ? `<div class="pop"><div style="font-size:10px;color:#64748b;padding:0 6px 4px">popover opened by clicking ⌄</div>${(hidden.length ? hidden : [target]).map(l => `<div class="item ${chipClass(l, target)}">${chipLabel(l)} <span style="margin-left:auto;font-weight:400;opacity:.8">${l === target ? "✖ dead" : DEAD.has(l.status) ? "✖ dead" : l.status === "VALID" ? "✔ works" : "?"}</span></div>`).join("")}</div>` : ""}
      <div class="row"><span class="lbl">Contracts</span><span class="chip ghost">0x…</span></div>
      <div class="row"><span class="lbl">Explorers</span><span class="chip ghost">explorer ⌄</span></div>
      ${notRendered.length ? `<div class="hiddenbox"><b>Not shown on the page</b> – stored only in CMC's data (announcement field):<br>${notRendered.map(l => `<span class="chip ${chipClass(l, target)}" style="margin-top:4px">${chipLabel(l)} ${l === target ? "✖" : DEAD.has(l.status) ? "✖" : "✔"}${callout(l, target)}</span>`).join(" ")}</div>` : ""}
    </div>
    <div class="col" style="flex:1 1 auto"><div class="ph" style="height:150px">price chart</div><div class="ph" style="height:40px">CMC AI</div><div class="ph" style="height:60px">markets table</div></div>
    <div class="col" style="flex:0 0 22%"><div class="ph" style="height:260px">community feed</div></div>
  </div>
  <div class="note">Layout as observed on coinmarketcap.com/currencies/… at 1440×900. The Socials row sits ~690px down (inside the first screen on desktop). Social chips are icon-only; everything that does not fit is tucked into the ⌄ popover.</div>${measuredNote(target)}
</div>`;
}

function wireCG(target, pageLinks) {
    const community = pageLinks.filter(l => l.placement.visibility !== "NOT_RENDERED");
    const notRendered = pageLinks.filter(l => l.placement.visibility === "NOT_RENDERED");
    return `<div class="wf">
  <div class="nav"><b>CoinGecko</b><i>Cryptocurrencies</i><i>Exchanges</i><i>NFT</i><i>Learn</i><i>Products</i><span style="margin-left:auto;opacity:.6">🔍 Search</span></div>
  <div class="cols">
    <div class="col" style="flex:0 0 50%">
      <div class="box"><b style="font-size:13px;color:#111">${esc(target.project)}</b> <span>${esc(target.symbol)}</span> <span style="float:right">#${esc(target.rank ?? "–")}</span><div style="font-size:16px;font-weight:700;color:#111;margin-top:2px">$ price</div></div>
      <div class="sq"><span>Market Cap</span><span>${esc(money(target.market_cap))}</span></div><div class="sq"><span>24h Volume</span><span>…</span></div><div class="sq"><span>Circulating Supply</span><span>…</span></div>
      <div class="row btnrow"><span>Buy / Sell ⌄</span><span>Long / Short ⌄</span><span>Earn Crypto ⌄</span></div>
      <div class="fold">▲ first screen ends here (≈900px) — scroll down ▼</div>
      <div style="font-weight:700;color:#111;margin:4px 0">Info</div>
      <div class="row"><span class="lbl">Website</span><span class="pillbtn">site.com</span><span class="pillbtn">Whitepaper</span></div>
      <div class="row"><span class="lbl">Wallets</span><span class="pillbtn">wallet ⌄</span></div>
      <div class="row" style="margin-top:8px"><span class="lbl">Community</span><span class="pillbtn" style="opacity:.6">𝕏 Twitter</span>
        ${community.map(l => `<span class="pillbtn ${chipClass(l, target)}" title="${esc(l.url)}">${platIcon(l.platform)} ${l.platform === "discord" ? "Discord" : (l.raw_url || "").includes("t.me") ? "t.me" : "Telegram"}${callout(l, target)}</span>`).join("")}
        <span class="pillbtn" style="opacity:.6">reddit.com</span></div>
      <div class="row"><span class="lbl">Search on</span><span class="pillbtn" style="opacity:.6">Twitter</span></div>
      ${notRendered.length ? `<div class="hiddenbox"><b>Not shown on the page</b> – only in CoinGecko's API (announcement_url):<br>${notRendered.map(l => `<span class="chip ${chipClass(l, target)}" style="margin-top:4px">${chipLabel(l)}${callout(l, target)}</span>`).join(" ")}</div>` : ""}
    </div>
    <div class="col" style="flex:1 1 auto"><div class="ph" style="height:150px">price chart</div><div class="ph" style="height:36px">1h · 24h · 7d · 30d</div><div class="ph" style="height:70px">Ask Gecko AI</div></div>
  </div>
  <div class="note">Layout as observed on coingecko.com/en/coins/… at 1440×900. The Community row is ~1130px from the top, so a visitor has to scroll about one screen before the pills come into view. Pills carry text labels ("Discord", "t.me").</div>${measuredNote(target)}
</div>`;
}

function wireDEX(target, pageLinks) {
    return `<div class="wf">
  <div class="nav"><b>DEX SCREENER</b><i>${esc(target.chain || "chain")}</i><i>New Pairs</i><i>Gainers</i><i>Portfolio</i><span style="margin-left:auto;opacity:.6">🔍 Search</span></div>
  <div class="cols">
    <div class="col" style="flex:0 0 38%">
      <div class="ph" style="height:46px">header / banner image</div>
      <div class="box"><b style="font-size:13px;color:#111">${esc(target.project)}</b> <span>${esc(target.symbol)}</span><div style="font-size:16px;font-weight:700;color:#111;margin-top:2px">$ price</div></div>
      <div class="row" style="margin:8px 0"><span class="pillbtn" style="opacity:.6">🌐 Website</span><span class="pillbtn" style="opacity:.6">𝕏 Twitter</span>
        ${pageLinks.map(l => `<span class="pillbtn ${chipClass(l, target)}" title="${esc(l.url)}">${platIcon(l.platform)} ${l.platform === "discord" ? "Discord" : "Telegram"}${callout(l, target)}</span>`).join("")}</div>
      <div class="box" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px"><span>Mkt Cap<br><b>${esc(money(target.market_cap))}</b></span><span>Liquidity<br><b>…</b></span><span>FDV<br><b>…</b></span></div>
      <div class="box" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px"><span>5M</span><span>1H</span><span>6H</span><span>24H</span></div>
      <div class="row btnrow"><span style="background:#2457c5">Watch</span><span style="background:#2457c5">Alerts</span><span style="background:#2457c5">Trade</span></div>
    </div>
    <div class="col" style="flex:1 1 auto"><div class="ph" style="height:170px">price chart</div><div class="ph" style="height:90px">transactions / holders table</div></div>
  </div>
  <div class="note">${target.placement && target.placement.measured ? "Layout approximated; the social buttons' real position below was measured in the live page." : "Approximate layout: the pair page sits behind Cloudflare bot protection, so headless browsers/curl cannot open it (run with --chrome or --chrome-profile default to measure it). Social buttons come from DexScreener's token-profile data and are rendered in the token card at the top of the left panel."}</div>${measuredNote(target)}
</div>`;
}

const measuredNote = t => t.placement && t.placement.measured ? `<div class="note" style="color:var(--green)">✔ Placement measured in the live page (${esc(t.placement.measured_mode)}): link at (${esc(t.placement.x ?? "–")}, ${esc(t.placement.y ?? "–")}) px on a 1440×900 window.</div>` : "";
const wireframe = (target, pageLinks) => target.source === "CMC" ? wireCMC(target, pageLinks) : target.source === "COINGECKO" ? wireCG(target, pageLinks) : wireDEX(target, pageLinks);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function entryCard(l, n, pageLinks) {
    const vis = VIS[l.placement.visibility] || VIS.UNKNOWN, pr = PRIO[l.priority] || { label: l.priority, cls: "p3" };
    const others = pageLinks.filter(x => x !== l);
    const working = others.filter(x => x.status === "VALID" || x.status === "USER_ACCOUNT");
    return `<section class="card" id="d${n}">
  <div class="head"><span class="n">#${n}</span><h2>${esc(l.project)} <span class="meta">(${esc(l.symbol || "–")})</span></h2>
    <span class="meta">${l.rank ? `rank #${esc(l.rank)} · ` : ""}${esc(money(l.market_cap))}${l.chain ? ` · ${esc(l.chain)}` : ""}</span>
    <span style="margin-left:auto"></span><span class="badge b-src">${esc(SOURCE_NAME[l.source] || l.source)}</span><span class="badge b-cat">${esc(CATEGORY_LABEL_FALLBACK(l))}</span><span class="badge ${pr.cls}">${esc(pr.label)}</span></div>
  <div class="body">
    <div class="wire"><h3 class="sec">Where it is on the ${esc(SOURCE_NAME[l.source] || l.source)} page</h3>${wireframe(l, pageLinks)}
      ${l.screenshot ? `<div class="shot"><img src="${esc(l.screenshot)}" alt="screenshot" loading="lazy"><br><small>${esc(l.screenshot_note || "")}</small></div>` : l.screenshot_note ? `<div class="shot"><small>${esc(l.screenshot_note)}</small></div>` : ""}
    </div>
    <div class="info">
      <h3 class="sec">Dead link</h3>
      <div class="deadurl">${platIcon(l.platform)} <a href="${esc(l.url)}" style="color:inherit" target="_blank" rel="noopener">${esc(l.url)}</a></div>
      <dl class="kv" style="margin-top:10px">
        <dt>Why dead</dt><dd>${esc(l.reason)}</dd>
        <dt>Where</dt><dd>${esc(l.placement.section)}</dd>
        <dt>Visibility</dt><dd><span class="badge ${vis.cls}">${esc(vis.label)}</span> ${l.placement.needsClick ? '<span class="badge vis-hidden">needs a click</span>' : ""} ${l.placement.needsScroll ? '<span class="badge vis-scroll">needs scrolling</span>' : ""}</dd>
        <dt>How to find it</dt><dd>${esc(l.placement.how)}</dd>
        <dt>Data field</dt><dd><code>${esc(l.field)}</code> → <code>${esc(l.raw_url || l.url)}</code></dd>
        <dt>Checked</dt><dd>${esc(l.checked_at)}</dd>
      </dl>
      <h3 class="sec">Other links on the same page (${working.length} working)</h3>
      ${others.length ? `<ul class="links">${others.map(x => `<li>${statusPill(x)} <code><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a></code> <span style="color:var(--muted);font-size:12px">${esc(VIS[x.placement.visibility]?.label || "")}${x.name ? ` · ${esc(x.name)}` : ""}</span></li>`).join("")}</ul>` : `<p style="color:var(--muted);margin:0">No other Discord/Telegram link on this page – visitors have no working community link.</p>`}
      <a class="btn" href="${esc(l.source_page)}" target="_blank" rel="noopener">Open the ${esc(SOURCE_NAME[l.source] || l.source)} page ↗</a>
    </div>
  </div>
</section>`;
}
let CATEGORY_LABELS = {};
const CATEGORY_LABEL_FALLBACK = l => CATEGORY_LABELS[l.category] || l.category || l.status;

const shell = (title, body, navHtml) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap"><header class="top"><h1>${esc(title)}</h1><nav class="pages">${navHtml}</nav></header>${body}</div></body></html>`;

function buildReports({ outDir, all, dead, perPage = 10, opts = {}, categoryLabel = {}, startedAt }) {
    CATEGORY_LABELS = categoryLabel;
    const reportDir = path.join(outDir, "report"); fs.mkdirSync(reportDir, { recursive: true });
    const byPage = new Map();
    for (const l of all) { if (!byPage.has(l.source_page)) byPage.set(l.source_page, []); byPage.get(l.source_page).push(l); }
    const totalPages = Math.max(1, Math.ceil(dead.length / perPage));
    const fileName = p => `dead_links_${String(p).padStart(2, "0")}.html`;
    const navFor = p => [`<a href="index.html">Index</a>`, p > 1 ? `<a href="${fileName(p - 1)}">‹ Prev</a>` : `<span style="opacity:.4">‹ Prev</span>`, `<span class="cur">Page ${p} / ${totalPages}</span>`, p < totalPages ? `<a href="${fileName(p + 1)}">Next ›</a>` : `<span style="opacity:.4">Next ›</span>`].join("");
    const pageIndex = new Map();
    for (let p = 1; p <= totalPages; p++) {
        const slice = dead.slice((p - 1) * perPage, p * perPage);
        const body = slice.length ? slice.map((l, i) => { const n = (p - 1) * perPage + i + 1; pageIndex.set(l, `${fileName(p)}#d${n}`); return entryCard(l, n, byPage.get(l.source_page) || [l]); }).join("\n") : `<p>No dead links found in this run.</p>`;
        fs.writeFileSync(path.join(reportDir, fileName(p)), shell(`Dead links – page ${p} of ${totalPages}`, body, navFor(p)));
    }
    // index
    const count = (arr, f) => arr.filter(f).length;
    const sources = ["CMC", "COINGECKO", "DEXSCREENER"];
    const tiles = [
        [all.length, "links checked (occurrences)"], [dead.length, "dead links"],
        [count(dead, l => l.platform === "discord"), "dead Discord"], [count(dead, l => l.platform === "telegram"), "dead Telegram"],
        [count(dead, l => l.priority === "P1_NO_WORKING_COMMUNITY_LINK"), "P1 – no working community link"], [count(dead, l => l.priority === "P2_DEAD_LINK_IS_DISPLAYED"), "P2 – dead link displayed"], [count(dead, l => l.priority === "P3_DEAD_LINK_IS_HIDDEN"), "P3 – dead link hidden"],
        [count(all, l => l.status === "USER_ACCOUNT"), "Telegram → personal account"], [count(all, l => l.status === "UNVERIFIED"), "unverified"],
    ].map(([v, t]) => `<div class="tile"><b>${v}</b><small>${esc(t)}</small></div>`).join("");
    const bySource = sources.map(s => `<tr><td>${esc(SOURCE_NAME[s])}</td><td>${count(all, l => l.source === s)}</td><td>${count(dead, l => l.source === s)}</td><td>${count(dead, l => l.source === s && l.placement.visibility === "VISIBLE")}</td><td>${count(dead, l => l.source === s && l.placement.visibility === "BELOW_FOLD")}</td><td>${count(dead, l => l.source === s && l.placement.visibility === "HIDDEN_DROPDOWN")}</td><td>${count(dead, l => l.source === s && l.placement.visibility === "NOT_RENDERED")}</td></tr>`).join("");
    const rows = dead.map((l, i) => { const pr = PRIO[l.priority] || { label: l.priority, cls: "p3" }, vis = VIS[l.placement.visibility] || VIS.UNKNOWN; const working = (byPage.get(l.source_page) || []).filter(x => x !== l && x.status === "VALID"); return `<tr><td><a href="${pageIndex.get(l)}">#${i + 1}</a></td><td><span class="badge ${pr.cls}">${esc(pr.label.split(" · ")[0])}</span></td><td><b>${esc(l.project)}</b><br><small>${esc(l.symbol)}${l.rank ? ` · #${l.rank}` : ""} · ${esc(money(l.market_cap))}</small></td><td>${platIcon(l.platform)} <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></td><td>${esc(CATEGORY_LABEL_FALLBACK(l))}</td><td>${esc(SOURCE_NAME[l.source])}</td><td><span class="badge ${vis.cls}">${esc(vis.label)}</span></td><td>${working.length ? `<span class="pill st-ok">✔ ${working.length}</span>` : `<span class="pill st-dead">none</span>`}</td><td><a href="${esc(l.source_page)}" target="_blank" rel="noopener">page ↗</a></td></tr>`; }).join("");
    const legend = `<div class="legend"><b>How to read this report</b>
<dl><dt>P1</dt><dd>The page has <i>no</i> working Discord/Telegram link at all – visitors cannot reach the community.</dd>
<dt>P2</dt><dd>The dead link is actually displayed (visible chip/pill, or one scroll down) – visitors will click it and bounce; a working alternative exists on the same page.</dd>
<dt>P3</dt><dd>The dead link is hidden in a dropdown or only stored in the site's data – low visitor impact, still worth fixing.</dd>
<dt>Discord invite expired</dt><dd>Discord answered code 50270: the invite had a time limit or max uses and ran out.</dd>
<dt>Discord invite invalid</dt><dd>Discord answered code 10006 "Unknown Invite": the invite was deleted, the server is gone, or the code never existed.</dd>
<dt>Telegram username does not exist</dt><dd>t.me shows the "Telegram: Contact @…" placeholder – the name currently resolves to no channel, group or user, so visitors land in an empty chat. Whether it can be re-registered is up to Telegram (recently released or reserved names are refused as "invalid").</dd>
<dt>Telegram private invite revoked</dt><dd>t.me/+… or /joinchat/… link no longer resolves to a group.</dd>
<dt>Visible / Below the fold / Hidden in dropdown / Not rendered</dt><dd>Where the link sits on the source page at 1440×900: shown on load; shown after scrolling; shown only after clicking a "more" control; present in the site's data but never drawn on the page.</dd></dl>
<p style="margin:10px 0 0;color:var(--muted)">Run started ${esc(startedAt || "")} · options: CMC ${esc(opts.cmc)} from rank ${esc(opts.cmcStart)}, CoinGecko ${esc(opts.cg)} from rank ${esc(opts.cgStart)}, DexScreener ${opts.dex ? "on" : "off"}. Detail pages: ${Array.from({ length: totalPages }, (_, i) => `<a href="${fileName(i + 1)}">${i + 1}</a>`).join(" · ")}</p></div>`;
    const indexBody = `<div class="tiles">${tiles}</div>
<table class="list" style="margin-bottom:18px"><thead><tr><th>Source</th><th>Links checked</th><th>Dead</th><th>Dead &amp; visible</th><th>Dead below fold</th><th>Dead in dropdown</th><th>Dead not rendered</th></tr></thead><tbody>${bySource}</tbody></table>
${legend}
<table class="list"><thead><tr><th>#</th><th>Priority</th><th>Project</th><th>Dead link</th><th>Category</th><th>Source</th><th>Placement</th><th>Working alt.</th><th>Page</th></tr></thead><tbody>${rows || `<tr><td colspan="9">No dead links found.</td></tr>`}</tbody></table>`;
    fs.writeFileSync(path.join(reportDir, "index.html"), shell("Dead community links – report", indexBody, `<a href="${fileName(1)}">Detail pages ›</a>`));
    return pageIndex;
}

module.exports = { buildReports };
