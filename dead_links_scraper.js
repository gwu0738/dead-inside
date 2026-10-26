"use strict";
/**
 * DEAD LINKS SCRAPER v3
 * ---------------------
 * Finds Discord / Telegram community links on CoinMarketCap, CoinGecko and DexScreener,
 * validates them, and reports the dead ones with *where on the page* each link lives
 * (visible chip, hidden dropdown, below the fold, or only in the site's data and never rendered).
 *
 * Outputs (in --out, default ./output):
 *   DEAD_LINKS.csv          one row per dead link, categorised + prioritised
 *   ALL_LINKS.csv           every link that was checked, with its status
 *   all_links.json          raw data (handy for re-rendering / debugging)
 *   report/index.html       summary + table of every dead link
 *   report/dead_links_NN.html   10 dead links per page, each with a layout wireframe
 *
 * Usage:
 *   node dead_links_scraper.js [options]            (see --help)
 *   node dead_links_scraper.js 100 50               (legacy positional form: CMC count, CoinGecko count)
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { buildReports } = require("./report");

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------
function parseArgs(argv) {
    const o = { cmc: 100, cmcStart: 1, cg: 50, cgStart: 1, dex: true, out: "output", pageCheck: true, screenshots: false, cgDelay: 6000, cmcDelay: 1500, perPage: 10, reuseFound: false, help: false,
        browser: false, channel: "chromium", chromeProfile: "", profileName: "Default", chromeProfileCopy: false, headed: undefined, browserPages: "dead" };
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i], next = () => argv[++i];
        if (a === "--help" || a === "-h") o.help = true;
        else if (a === "--cmc") o.cmc = parseInt(next(), 10);
        else if (a === "--cmc-start") o.cmcStart = parseInt(next(), 10);
        else if (a === "--cg") o.cg = parseInt(next(), 10);
        else if (a === "--cg-start") o.cgStart = parseInt(next(), 10);
        else if (a === "--no-dex") o.dex = false;
        else if (a === "--dex") o.dex = true;
        else if (a === "--out") o.out = next();
        else if (a === "--no-page-check") o.pageCheck = false;
        else if (a === "--screenshots") o.screenshots = true;
        else if (a === "--cg-delay") o.cgDelay = parseInt(next(), 10);
        else if (a === "--cmc-delay") o.cmcDelay = parseInt(next(), 10);
        else if (a === "--per-page") o.perPage = parseInt(next(), 10);
        else if (a === "--reuse-found") o.reuseFound = true;
        else if (a === "--browser") o.browser = true;
        else if (a === "--channel") o.channel = next();
        else if (a === "--chrome") o.channel = "chrome";
        else if (a === "--edge") o.channel = "msedge";
        else if (a === "--chrome-profile") o.chromeProfile = next();
        else if (a === "--profile-name") o.profileName = next();
        else if (a === "--chrome-profile-copy") o.chromeProfileCopy = true;
        else if (a === "--headed") o.headed = true;
        else if (a === "--headless") o.headed = false;
        else if (a === "--browser-pages") o.browserPages = next();
        else if (/^\d+$/.test(a)) pos.push(parseInt(a, 10));
        else { console.error(`Unknown option: ${a}`); o.help = true; }
    }
    if (pos[0] !== undefined) o.cmc = pos[0];
    if (pos[1] !== undefined) o.cg = pos[1];
    if (!["chromium", "chrome", "msedge"].includes(o.channel)) { console.error(`--channel must be chromium, chrome or msedge`); o.help = true; }
    if (!["dead", "all"].includes(o.browserPages)) { console.error(`--browser-pages must be dead or all`); o.help = true; }
    // any browser-related flag switches the browser pass on
    o.useBrowser = o.browser || o.screenshots || !!o.chromeProfile || o.channel !== "chromium" || o.browserPages === "all";
    return o;
}
const HELP = `
Dead Links Scraper v3

  node dead_links_scraper.js [options]

Options
  --cmc <n>            CoinMarketCap coins to scan (default 100)
  --cmc-start <rank>   first CMC rank to scan (default 1). Dead links live in ranks 100-1000+
  --cg <n>             CoinGecko coins to scan (default 50)
  --cg-start <rank>    first CoinGecko rank to scan (default 1)
  --no-dex             skip DexScreener (latest profiles / boosted tokens, all chains)
  --out <dir>          output directory (default ./output)
  --no-page-check      don't download CMC coin pages (faster, but link placement is then estimated)
  --screenshots        also capture a screenshot of each dead link's spot on the page (needs: npm i playwright)

Browser mode (needs: npm i playwright). Opens the real pages, MEASURES where each link sits in the live DOM
(visible / below the fold / only after opening the '⌄ more' dropdown / not rendered) and takes the screenshots.
  --browser            use the browser pass with Playwright's bundled Chromium (headless, temp profile)
  --chrome | --edge    use your installed Google Chrome / Microsoft Edge instead (real fingerprint; headed by default).
                       This is what gets past Cloudflare on DexScreener / CoinGecko pages. Same as --channel chrome|msedge
  --chrome-profile <dir|default>
                       run on your real Chrome/Edge profile (cookies, logins, prior bot-check clearance).
                       "default" = the OS default "User Data" dir. Chrome must be CLOSED, or add --chrome-profile-copy
  --profile-name <n>   profile folder inside User Data (default "Default"; others are "Profile 1", "Profile 2", ...)
  --chrome-profile-copy
                       work on a temp copy of the profile so Chrome can stay open (cookies may not decrypt on new Chrome)
  --headed | --headless
                       show / hide the browser window (default: headed for chrome/msedge/profile, headless for chromium)
  --browser-pages dead|all
                       which pages to open: only pages that have a dead link (default) or every page with a link
  --cg-delay <ms>      pause between CoinGecko API calls (default 6000; 2500 is fine with COINGECKO_API_KEY set)
  --cmc-delay <ms>     pause between CMC page downloads (default 1500)
  --per-page <n>       dead links per HTML report page (default 10)
  --reuse-found        skip scraping; re-validate the links saved in <out>/found_links.json by the previous run

Env
  COINGECKO_API_KEY    optional demo/pro key -> sent as x-cg-demo-api-key

Examples
  node dead_links_scraper.js --cmc 300 --cmc-start 200 --cg 100 --cg-start 200
  node dead_links_scraper.js 100 50
  node dead_links_scraper.js --cmc 200 --cmc-start 300 --chrome --screenshots            # real Chrome, temp profile
  node dead_links_scraper.js --cmc 200 --cmc-start 300 --chrome-profile default --screenshots   # your own profile (close Chrome first)
  node dead_links_scraper.js --reuse-found --chrome-profile default --browser-pages all  # re-check + measure every page
`;

// ----------------------------------------------------------------------------
// HTTP helpers
// ----------------------------------------------------------------------------
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const http = axios.create({ timeout: 25000, headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, validateStatus: () => true, maxRedirects: 5 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(...a);

/** GET with retries on network errors and on 429/5xx (honours Retry-After). */
async function getWithRetry(url, cfg = {}, { retries = 4, baseDelay = 2000, label = "" } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const r = await http.get(url, cfg);
            if (r.status === 429 || r.status >= 500) {
                if (i === retries) return r;
                const ra = parseFloat(r.headers?.["retry-after"]);
                const wait = Number.isFinite(ra) ? Math.min(ra * 1000 + 500, 90000) : baseDelay * Math.pow(2, i) + (r.status === 429 ? 8000 : 0);
                log(`   ${label} HTTP ${r.status} - waiting ${Math.round(wait / 1000)}s then retrying`);
                await sleep(wait);
                continue;
            }
            return r;
        } catch (e) {
            lastErr = e;
            if (i === retries) throw e;
            await sleep(baseDelay * Math.pow(2, i));
        }
    }
    throw lastErr;
}

// ----------------------------------------------------------------------------
// Link extraction / normalisation
// ----------------------------------------------------------------------------
const TG_RESERVED = new Set(["share", "addstickers", "addemoji", "addtheme", "addlist", "setlanguage", "proxy", "socks", "iv", "bg", "confirmphone", "login", "invoice", "m", "contact", "boost", "giftcode", "nft", "c", "s", "joinchat", "web", "k", "a", "z"]);

/** Parse a single URL (or bare handle) into {platform, code, url} or null. */
function parseLink(raw) {
    if (!raw || typeof raw !== "string") return null;
    let s = raw.trim().replace(/^<|>$/g, "");
    if (!s) return null;
    // Discord: discord.gg/CODE, discord.gg/invite/CODE, discord.com/invite/CODE, discordapp.com/invite/CODE
    let m = s.match(/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.com)\/(?:invite\/)?([A-Za-z0-9_-]{2,64})/i);
    if (m && /discord/i.test(s)) {
        const code = m[1];
        // Not invites: discord.com/channels/..., /servers/..., /users/..., /app, /login, /download
        if (/discord\.com\/(channels|servers|users|app|login|download|register|developers|oauth2|api|terms|privacy|guidelines)\b/i.test(s)) return null;
        if (["invite", "channels", "servers"].includes(code.toLowerCase())) return null;
        return { platform: "discord", code, url: `https://discord.gg/${code}` };
    }
    // Telegram: t.me/handle, t.me/+HASH, t.me/joinchat/HASH, telegram.me/handle, t.me/s/handle, bare "@handle" or "handle"
    m = s.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?(joinchat\/[A-Za-z0-9_-]+|\+[A-Za-z0-9_-]+|[A-Za-z0-9_]{4,64})/i);
    if (m) {
        let code = m[1];
        if (code.toLowerCase().startsWith("joinchat/")) code = "+" + code.slice(9);
        if (!code.startsWith("+") && TG_RESERVED.has(code.toLowerCase())) return null;
        return { platform: "telegram", code, url: `https://t.me/${code}`, privateInvite: code.startsWith("+") };
    }
    if (/^@?[A-Za-z][A-Za-z0-9_]{3,63}$/.test(s) && !/\./.test(s)) { // bare handle (CoinGecko telegram_channel_identifier)
        const code = s.replace(/^@/, "");
        return { platform: "telegram", code, url: `https://t.me/${code}`, privateInvite: false };
    }
    return null;
}

/** Find every Discord / Telegram link inside a blob of text. */
function extractLinks(text) {
    const found = [];
    if (!text || typeof text !== "string") return found;
    const re = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|t\.me|telegram\.me)\/[A-Za-z0-9_+\/-]+/gi;
    let m;
    while ((m = re.exec(text)) !== null) { const p = parseLink(m[0]); if (p) found.push(p); }
    return found;
}

// ----------------------------------------------------------------------------
// Validators
// ----------------------------------------------------------------------------
/**
 * Discord invite check via the public invite endpoint.
 *  200 + guild            -> VALID
 *  404 code 50270         -> EXPIRED   ("Invite is expired.")
 *  404 code 10006         -> INVALID   ("Unknown Invite": revoked, never existed, or the server is gone)
 *  429 / Cloudflare 1015  -> wait and retry
 */
async function validateDiscord(code) {
    const url = `https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`;
    for (let attempt = 0; attempt < 6; attempt++) {
        let r;
        try { r = await http.get(url); } catch (e) { if (attempt === 5) return { status: "UNVERIFIED", reason: `network: ${e.message}` }; await sleep(3000 * (attempt + 1)); continue; }
        const body = r.data, isObj = body && typeof body === "object";
        if (r.status === 200 && isObj && body.guild) {
            return { status: "VALID", reason: "Invite resolves", name: body.guild.name, members: body.approximate_member_count || 0, online: body.approximate_presence_count || 0, expires_at: body.expires_at || "", verified: (body.guild.features || []).some(f => f === "VERIFIED" || f === "PARTNERED") };
        }
        if (r.status === 200 && isObj && body.code === 0 && !body.guild) return { status: "VALID", reason: "Invite resolves (group DM / non-guild invite)" };
        if (r.status === 429 || (typeof body === "string" && /error code: 1015/.test(body))) {
            // Discord's own 429 carries a sane Retry-After (seconds); Cloudflare's 1015 page carries nonsense (hours) - cap it.
            const ra = parseFloat(r.headers?.["retry-after"]);
            const wait = Math.min(Number.isFinite(ra) ? ra * 1000 + 1000 : 15000 * (attempt + 1), 20000 * (attempt + 1));
            log(`   [discord] rate limited, waiting ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
        }
        if (isObj && body.code === 50270) return { status: "EXPIRED", reason: "Invite is expired (Discord code 50270)" };
        if (isObj && body.code === 10006) return { status: "INVALID", reason: "Unknown invite: revoked, never existed, or the server was deleted (Discord code 10006)" };
        if (r.status === 404) return { status: "INVALID", reason: `Not found (HTTP 404${isObj && body.message ? ": " + body.message : ""})` };
        if (r.status >= 500) { await sleep(4000); continue; }
        return { status: "UNVERIFIED", reason: `Unexpected HTTP ${r.status}${isObj && body.message ? ": " + body.message : ""}` };
    }
    return { status: "UNVERIFIED", reason: "Gave up after repeated rate limits" };
}

const htmlAttr = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const decodeEntities = s => (s || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/**
 * Telegram check by reading the public t.me preview page (always HTTP 200, so we read the markers):
 *  og:title "Telegram: Contact @x" + no member count     -> NOT_FOUND       (username does not exist - it can even be claimed by anyone)
 *  og:title "Join group chat on Telegram" + no button    -> INVITE_INVALID  (private invite link revoked / expired)
 *  "N members" / "N subscribers"                         -> VALID group/channel
 *  "Send Message" + "@handle"                            -> USER_ACCOUNT    (works, but it's a personal account or bot, not a community)
 */
async function validateTelegram(code) {
    const url = `https://t.me/${code}`;
    for (let attempt = 0; attempt < 4; attempt++) {
        let r;
        try { r = await http.get(url, { responseType: "text" }); } catch (e) { if (attempt === 3) return { status: "UNVERIFIED", reason: `network: ${e.message}` }; await sleep(2000 * (attempt + 1)); continue; }
        if (r.status === 429 || r.status >= 500) { await sleep(8000 * (attempt + 1)); continue; }
        if (r.status === 404) return { status: "NOT_FOUND", reason: "t.me returned 404" };
        if (r.status !== 200) return { status: "UNVERIFIED", reason: `HTTP ${r.status}` };
        const html = typeof r.data === "string" ? r.data : "";
        const ogTitle = decodeEntities(htmlAttr(html, /property="og:title" content="([^"]*)"/));
        const extra = decodeEntities(htmlAttr(html, /tgme_page_extra">([^<]*)</) || "").trim();
        const button = decodeEntities(htmlAttr(html, /tgme_action_button_new[^>]*>([^<]*)</) || "").trim();
        const hasTitle = /class="tgme_page_title"/.test(html);
        const counts = extra.match(/([\d\s,.]+)\s*(members|subscribers)/i);
        const members = counts ? parseInt(counts[1].replace(/[^\d]/g, ""), 10) : null;
        const online = (extra.match(/([\d\s,.]+)\s*online/i) || [])[1];
        if (/^Telegram: Contact @/i.test(ogTitle) && !hasTitle) return { status: "NOT_FOUND", reason: "Username does not exist on Telegram (t.me shows 'Telegram: Contact @...' placeholder)" };
        if (/^Join group chat on Telegram$/i.test(ogTitle) && !button) return { status: "INVITE_INVALID", reason: "Private invite link is invalid or has been revoked" };
        if (counts) return { status: "VALID", reason: `${counts[2].toLowerCase() === "subscribers" ? "Channel" : "Group"} with ${members.toLocaleString("en-US")} ${counts[2].toLowerCase()}`, name: ogTitle, members, online: online ? parseInt(online.replace(/[^\d]/g, ""), 10) : null, kind: counts[2].toLowerCase() === "subscribers" ? "channel" : "group" };
        if (/^Send Message$/i.test(button)) return { status: "USER_ACCOUNT", reason: `Resolves to a personal account/bot (${extra || ogTitle}), not a group or channel`, name: ogTitle, kind: /bot$/i.test(code) ? "bot" : "user" };
        if (/^(Join|View) (Group|Channel)$/i.test(button)) return { status: "VALID", reason: `${button} (private ${/Channel/i.test(button) ? "channel" : "group"})`, name: ogTitle, kind: "private" };
        if (hasTitle) return { status: "VALID", reason: "Preview page exists", name: ogTitle };
        return { status: "UNVERIFIED", reason: `Unrecognised t.me page (title: ${ogTitle || "none"})` };
    }
    return { status: "UNVERIFIED", reason: "Repeated server errors from t.me" };
}

// ----------------------------------------------------------------------------
// Placement descriptions (from manually inspecting each site at 1440x900, Oct 2026)
// ----------------------------------------------------------------------------
const PLACEMENT = {
    CMC_VISIBLE: { visibility: "VISIBLE", section: "Left sidebar > Socials row", how: "Shown as an icon chip (no label) in the 'Socials' row of the left stats column, about 690px down - visible without scrolling on a desktop screen, one scroll on a laptop.", needsClick: false, needsScroll: false },
    CMC_DROPDOWN: { visibility: "HIDDEN_DROPDOWN", section: "Left sidebar > Socials row > '⌄ more' dropdown", how: "Not in the page until you click the small '⌄' chevron chip at the end of the 'Socials' row; a popover then lists it with its label (e.g. 'Discord').", needsClick: true, needsScroll: false },
    CMC_NOT_RENDERED: { visibility: "NOT_RENDERED", section: "CMC data only ('announcement' field)", how: "Stored in CoinMarketCap's coin record as an 'announcement' URL but not rendered anywhere on the public coin page; it still ships inside the page's embedded JSON and the detail API.", needsClick: false, needsScroll: false },
    CMC_UNKNOWN: { visibility: "UNKNOWN", section: "Left sidebar > Socials row (chip or '⌄ more' dropdown)", how: "Coin page could not be downloaded, so it is unknown whether this is a visible chip or hidden in the '⌄ more' dropdown.", needsClick: null, needsScroll: false },
    CG_COMMUNITY: { visibility: "BELOW_FOLD", section: "Left column > Info > Community row", how: "Labelled pill button ('Discord' / 't.me' / 'Telegram') in the 'Community' row of the Info panel, about 1130px down - you must scroll roughly one screen to see it.", needsClick: false, needsScroll: true },
    CG_NOT_RENDERED: { visibility: "NOT_RENDERED", section: "CoinGecko data only ('announcement_url' field)", how: "Returned by the CoinGecko API as an announcement URL; it is not one of the Community pills on the coin page.", needsClick: false, needsScroll: false },
    DEX_SOCIALS: { visibility: "VISIBLE", section: "Left token panel > token card > social buttons", how: "Button row (Website / Twitter / Telegram / Discord) in the token card at the top of the left panel on the pair page - visible on load. (Placement taken from DexScreener's API data; the page itself sits behind Cloudflare bot protection so it was not screenshotted.)", needsClick: false, needsScroll: false },
};

// ----------------------------------------------------------------------------
// Sources
// ----------------------------------------------------------------------------
function makeLink(parsed, meta) { return { ...parsed, ...meta, id: `${parsed.platform}:${parsed.code}`, found_at: nowIso() }; }

async function scrapeCMC(opts) {
    const links = [];
    if (opts.cmc <= 0) return links;
    log(`\n[CMC] Scanning ranks ${opts.cmcStart}-${opts.cmcStart + opts.cmc - 1} ...`);
    let coins = [];
    try {
        const r = await getWithRetry(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=${opts.cmcStart}&limit=${opts.cmc}&sortBy=market_cap&sortType=desc&convert=USD`, {}, { label: "[CMC listing]" });
        coins = r.data?.data?.cryptoCurrencyList || [];
    } catch (e) { log(`[CMC] listing failed: ${e.message}`); return links; }
    log(`[CMC] ${coins.length} coins`);
    for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        const pageUrl = `https://coinmarketcap.com/currencies/${coin.slug}/`;
        const meta = { source: "CMC", source_page: pageUrl, project: coin.name, symbol: coin.symbol, rank: coin.cmcRank || (opts.cmcStart + i), market_cap: Math.round(coin.quotes?.[0]?.marketCap || 0), chain: "" };
        try {
            const d = await getWithRetry(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?slug=${coin.slug}`, {}, { label: "[CMC detail]" });
            const urls = d.data?.data?.urls || {};
            const chipHrefs = new Set();
            let pageOk = false;
            if (opts.pageCheck) {
                try {
                    const p = await getWithRetry(pageUrl, { responseType: "text" }, { retries: 2, label: "[CMC page]" });
                    if (p.status === 200 && typeof p.data === "string") {
                        pageOk = true;
                        const re = /<a[^>]+data-test="chip-social-link"[^>]*>|<a[^>]+href="([^"]+)"[^>]+data-test="chip-social-link"/g;
                        let m; const anchorRe = /<a\b[^>]*data-test="chip-social-link"[^>]*>/g;
                        while ((m = anchorRe.exec(p.data)) !== null) { const h = m[0].match(/href="([^"]+)"/); if (h) chipHrefs.add(h[1].replace(/^\/\//, "https://").toLowerCase()); }
                        void re;
                    }
                } catch (e) { /* placement falls back to UNKNOWN */ }
            }
            const seen = new Set();
            const addAll = (arr, field) => {
                for (const u of (arr || [])) {
                    const parsed = parseLink(u);
                    if (!parsed || seen.has(parsed.platform + parsed.code)) continue;
                    seen.add(parsed.platform + parsed.code);
                    let placement;
                    if (field === "announcement") placement = PLACEMENT.CMC_NOT_RENDERED;
                    else if (!opts.pageCheck || !pageOk) placement = PLACEMENT.CMC_UNKNOWN;
                    else {
                        // a chip counts only if its href is this exact invite/handle (substring matching would let
                        // t.me/sandboxgame match twitter.com/thesandboxgame)
                        const code = parsed.code.toLowerCase().replace(/^\+/, "");
                        const chipRe = parsed.platform === "discord" ? new RegExp(`discord(?:app)?\\.(?:gg|com/invite)/(?:invite/)?${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?#]|$)`)
                                                                     : new RegExp(`(?:t\\.me|telegram\\.me)/(?:joinchat/|\\+)?${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?#]|$)`);
                        const isChip = [...chipHrefs].some(h => chipRe.test(h));
                        placement = isChip ? PLACEMENT.CMC_VISIBLE : PLACEMENT.CMC_DROPDOWN;
                    }
                    links.push(makeLink(parsed, { ...meta, raw_url: u, field, placement }));
                }
            };
            addAll(urls.chat, "chat");
            addAll(urls.announcement, "announcement");
        } catch (e) { log(`\n[CMC] ${coin.slug}: ${e.message}`); }
        process.stdout.write(`\r[CMC] ${i + 1}/${coins.length}  (${links.length} links so far)   `);
        await sleep(opts.cmcDelay);
    }
    log(`\n[CMC] Found ${links.filter(l => l.platform === "discord").length} Discord + ${links.filter(l => l.platform === "telegram").length} Telegram links`);
    return links;
}

async function scrapeCoinGecko(opts) {
    const links = [];
    if (opts.cg <= 0) return links;
    const key = process.env.COINGECKO_API_KEY;
    const cfg = key ? { headers: { "x-cg-demo-api-key": key } } : {};
    log(`\n[CoinGecko] Scanning ranks ${opts.cgStart}-${opts.cgStart + opts.cg - 1} ...${key ? " (API key set)" : " (no API key: slow, ~6s per coin)"}`);
    // the markets endpoint pages by 250 max; collect the needed rank window
    let coins = [];
    try {
        const perPage = 250, firstPage = Math.floor((opts.cgStart - 1) / perPage) + 1, lastPage = Math.floor((opts.cgStart + opts.cg - 2) / perPage) + 1;
        for (let p = firstPage; p <= lastPage; p++) {
            const r = await getWithRetry(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${p}`, cfg, { label: "[CG markets]" });
            if (Array.isArray(r.data)) coins.push(...r.data);
            await sleep(opts.cgDelay / 2);
        }
        const offset = (opts.cgStart - 1) % perPage;
        coins = coins.slice(offset, offset + opts.cg);
    } catch (e) { log(`[CoinGecko] markets failed: ${e.message}`); return links; }
    log(`[CoinGecko] ${coins.length} coins`);
    for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        const pageUrl = `https://www.coingecko.com/en/coins/${coin.id}`;
        const meta = { source: "COINGECKO", source_page: pageUrl, project: coin.name, symbol: (coin.symbol || "").toUpperCase(), rank: coin.market_cap_rank || (opts.cgStart + i), market_cap: Math.round(coin.market_cap || 0), chain: "" };
        try {
            const r = await getWithRetry(`https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, cfg, { label: "[CG detail]" });
            const L = r.data?.links;
            if (L) {
                const seen = new Set();
                const add = (u, field, placement) => { const parsed = parseLink(u); if (!parsed || seen.has(parsed.platform + parsed.code)) return; seen.add(parsed.platform + parsed.code); links.push(makeLink(parsed, { ...meta, raw_url: u, field, placement })); };
                for (const u of (L.chat_url || [])) add(u, "chat_url", PLACEMENT.CG_COMMUNITY);
                if (L.telegram_channel_identifier) add(L.telegram_channel_identifier, "telegram_channel_identifier", PLACEMENT.CG_COMMUNITY);
                for (const u of (L.announcement_url || [])) add(u, "announcement_url", PLACEMENT.CG_NOT_RENDERED);
            } else if (r.status !== 200) log(`\n[CoinGecko] ${coin.id}: HTTP ${r.status}`);
        } catch (e) { log(`\n[CoinGecko] ${coin.id}: ${e.message}`); }
        process.stdout.write(`\r[CoinGecko] ${i + 1}/${coins.length}  (${links.length} links so far)   `);
        await sleep(opts.cgDelay);
    }
    log(`\n[CoinGecko] Found ${links.filter(l => l.platform === "discord").length} Discord + ${links.filter(l => l.platform === "telegram").length} Telegram links`);
    return links;
}

async function scrapeDexScreener(opts) {
    const links = [];
    if (!opts.dex) return links;
    log(`\n[DexScreener] Collecting latest token profiles + boosted tokens (all chains) ...`);
    const tokens = new Map(); // chain:address -> {chainId, tokenAddress, description, url, links}
    for (const ep of ["token-profiles/latest/v1", "token-boosts/latest/v1", "token-boosts/top/v1"]) {
        try {
            const r = await getWithRetry(`https://api.dexscreener.com/${ep}`, {}, { label: `[DEX ${ep}]` });
            if (Array.isArray(r.data)) for (const t of r.data) { const k = `${t.chainId}:${t.tokenAddress}`; if (!tokens.has(k)) tokens.set(k, t); }
        } catch (e) { log(`[DexScreener] ${ep}: ${e.message}`); }
        await sleep(500);
    }
    log(`[DexScreener] ${tokens.size} unique tokens`);
    // enrich with name / symbol / market cap / typed socials via the pairs endpoint (max 30 addresses per call)
    const byChain = new Map();
    for (const t of tokens.values()) { if (!byChain.has(t.chainId)) byChain.set(t.chainId, []); byChain.get(t.chainId).push(t); }
    for (const [chain, list] of byChain) {
        for (let i = 0; i < list.length; i += 30) {
            const batch = list.slice(i, i + 30);
            let pairs = [];
            try {
                const r = await getWithRetry(`https://api.dexscreener.com/tokens/v1/${chain}/${batch.map(t => t.tokenAddress).join(",")}`, {}, { label: "[DEX tokens]" });
                if (Array.isArray(r.data)) pairs = r.data;
            } catch (e) { log(`[DexScreener] tokens ${chain}: ${e.message}`); }
            for (const t of batch) {
                const own = pairs.filter(p => p.baseToken?.address?.toLowerCase() === t.tokenAddress.toLowerCase());
                const best = own.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
                const meta = { source: "DEXSCREENER", source_page: best?.url || t.url || `https://dexscreener.com/${chain}/${t.tokenAddress}`, project: best?.baseToken?.name || (t.description || "").split(/[.\n]/)[0].slice(0, 60) || t.tokenAddress, symbol: best?.baseToken?.symbol || "", rank: null, market_cap: Math.round(best?.marketCap || best?.fdv || 0), chain };
                const seen = new Set();
                const add = (u, field) => { const parsed = parseLink(u); if (!parsed || seen.has(parsed.platform + parsed.code)) return; seen.add(parsed.platform + parsed.code); links.push(makeLink(parsed, { ...meta, raw_url: u, field, placement: PLACEMENT.DEX_SOCIALS })); };
                for (const s of (best?.info?.socials || [])) add(s.url, `socials.${s.type || "link"}`);
                for (const l of (t.links || [])) add(l.url, `links.${l.type || "link"}`);
            }
            await sleep(1200);
        }
    }
    log(`[DexScreener] Found ${links.filter(l => l.platform === "discord").length} Discord + ${links.filter(l => l.platform === "telegram").length} Telegram links`);
    return links;
}

// ----------------------------------------------------------------------------
// Categorisation
// ----------------------------------------------------------------------------
const DEAD_STATUSES = new Set(["EXPIRED", "INVALID", "NOT_FOUND", "INVITE_INVALID"]);
const CATEGORY = {
    discord: { EXPIRED: "DISCORD_EXPIRED", INVALID: "DISCORD_INVALID" },
    telegram: { NOT_FOUND: "TELEGRAM_NOT_FOUND", INVITE_INVALID: "TELEGRAM_INVITE_INVALID" },
};
const CATEGORY_LABEL = {
    DISCORD_EXPIRED: "Discord invite expired",
    DISCORD_INVALID: "Discord invite invalid / revoked / server gone",
    TELEGRAM_NOT_FOUND: "Telegram username does not exist",
    TELEGRAM_INVITE_INVALID: "Telegram private invite revoked",
};
/** Priority: how badly the project needs this fixed, based on what else works on the same page. */
function priority(link, siblings) {
    const validSiblings = siblings.filter(s => s.status === "VALID");
    const dead = DEAD_STATUSES.has(link.status);
    if (!dead) return "";
    if (validSiblings.length === 0) return "P1_NO_WORKING_COMMUNITY_LINK";
    if (link.placement.visibility === "VISIBLE" || link.placement.visibility === "BELOW_FOLD") return "P2_DEAD_LINK_IS_DISPLAYED";
    return "P3_DEAD_LINK_IS_HIDDEN";
}

// ----------------------------------------------------------------------------
// CSV
// ----------------------------------------------------------------------------
const csvCell = v => { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (header, rows) => "﻿" + header.join(",") + "\n" + rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
const fmtOther = s => `${s.platform}:${s.url} [${s.status}${s.members ? `, ${s.members} members` : ""}]`;

function writeCsvs(outDir, all, dead, pageIndex) {
    const deadHeader = ["#", "priority", "category", "category_label", "platform", "dead_link", "reason", "project", "symbol", "rank", "market_cap_usd", "chain", "source_site", "source_page_url", "link_field", "page_section", "visibility", "needs_click", "needs_scroll", "how_to_find_it", "placement_source", "page_x", "page_y", "working_alternatives", "other_dead_links_same_page", "unverified_links_same_page", "checked_at", "report_page"];
    const deadRows = dead.map((l, i) => {
        const sib = l.siblings || [];
        return [i + 1, l.priority, l.category, CATEGORY_LABEL[l.category], l.platform, l.url, l.reason, l.project, l.symbol, l.rank ?? "", l.market_cap, l.chain, l.source, l.source_page, l.field, l.placement.section, l.placement.visibility, l.placement.needsClick === null ? "unknown" : l.placement.needsClick ? "yes" : "no", l.placement.needsScroll ? "yes" : "no", l.placement.how, l.placement.measured ? `measured in browser (${l.placement.measured_mode})` : "estimated from site data", l.placement.x ?? "", l.placement.y ?? "",
            sib.filter(s => s.status === "VALID" || s.status === "USER_ACCOUNT").map(fmtOther).join(" | "),
            sib.filter(s => DEAD_STATUSES.has(s.status)).map(fmtOther).join(" | "),
            sib.filter(s => s.status === "UNVERIFIED").map(fmtOther).join(" | "),
            l.checked_at, pageIndex.get(l) || ""];
    });
    fs.writeFileSync(path.join(outDir, "DEAD_LINKS.csv"), csv(deadHeader, deadRows));
    const allHeader = ["platform", "link", "status", "is_dead", "reason", "name", "members", "online", "project", "symbol", "rank", "market_cap_usd", "chain", "source_site", "source_page_url", "link_field", "page_section", "visibility", "placement_source", "page_x", "page_y", "checked_at"];
    const allRows = all.map(l => [l.platform, l.url, l.status, DEAD_STATUSES.has(l.status) ? "yes" : "no", l.reason, l.name || "", l.members ?? "", l.online ?? "", l.project, l.symbol, l.rank ?? "", l.market_cap, l.chain, l.source, l.source_page, l.field, l.placement.section, l.placement.visibility, l.placement.measured ? `measured in browser (${l.placement.measured_mode})` : "estimated from site data", l.placement.x ?? "", l.placement.y ?? "", l.checked_at]);
    fs.writeFileSync(path.join(outDir, "ALL_LINKS.csv"), csv(allHeader, allRows));
}

// ----------------------------------------------------------------------------
// Browser pass (optional, Playwright): measure real placement in the live page + screenshots.
// Uses your installed Chrome / real profile when asked - see browser.js.
// ----------------------------------------------------------------------------
async function browserPass(found, dead, opts) {
    const { openBrowser, inspectPage } = require("./browser");
    const b = await openBrowser(opts, log);
    if (!b) return;
    b.context._dlsMode = b.mode;
    const imgDir = path.join(opts.out, "report", "img"); fs.mkdirSync(imgDir, { recursive: true });
    const byPage = new Map();
    for (const l of found) { if (!byPage.has(l.source_page)) byPage.set(l.source_page, []); byPage.get(l.source_page).push(l); }
    const deadPages = new Set(dead.map(l => l.source_page));
    const pages = [...byPage.keys()].filter(u => opts.browserPages === "all" || deadPages.has(u));
    log(`\n=== BROWSER PASS: ${pages.length} page(s) (${b.mode}) ===`);
    let n = 0, blocked = 0, measured = 0, shots = 0;
    for (const url of pages) {
        n++;
        const links = byPage.get(url);
        const shotLinks = opts.screenshots ? links.filter(l => deadPages.has(url) && DEAD_STATUSES.has(l.status)) : [];
        let r;
        try { r = await inspectPage(b.context, url, links, { imgDir, screenshotLinks: shotLinks, log }); } catch (e) { r = { error: e.message }; }
        if (r.blocked) blocked++;
        measured += r.updated || 0; shots += r.shots || 0;
        log(`[browser ${n}/${pages.length}] ${url}  ->  ${r.blocked ? "BLOCKED by bot check (kept API-derived placement)" : r.ok ? `${r.updated} link(s) measured` : `failed: ${r.error || r.title}`}${r.shots ? `, ${r.shots} screenshot(s)` : ""}`);
        await sleep(800);
    }
    await b.close();
    log(`[browser] done: ${measured} placements measured, ${shots} screenshots, ${blocked} page(s) blocked${blocked ? " - try --chrome or --chrome-profile default for those" : ""}`);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(HELP); return; }
    const started = Date.now();
    log("=== DEAD LINKS SCRAPER v3 ===");
    log(`CMC: ${opts.cmc} coins from rank ${opts.cmcStart} | CoinGecko: ${opts.cg} coins from rank ${opts.cgStart} | DexScreener: ${opts.dex ? "on" : "off"} | out: ${opts.out}`);
    if (opts.useBrowser) log(`Browser pass: ${opts.channel}${opts.chromeProfile ? ` + profile ${opts.chromeProfile}/${opts.profileName}${opts.chromeProfileCopy ? " (copy)" : ""}` : ""}, pages=${opts.browserPages}${opts.screenshots ? ", screenshots" : ""}`);
    fs.mkdirSync(path.join(opts.out, "report"), { recursive: true });

    const foundFile = path.join(opts.out, "found_links.json");
    let found;
    if (opts.reuseFound) {
        found = JSON.parse(fs.readFileSync(foundFile, "utf8"));
        log(`Loaded ${found.length} previously found links from ${foundFile} (scraping skipped)`);
    } else {
        found = [...await scrapeCMC(opts), ...await scrapeCoinGecko(opts), ...await scrapeDexScreener(opts)];
        fs.writeFileSync(foundFile, JSON.stringify(found, null, 1));
    }

    // Validate each unique link once, then copy the result onto every occurrence
    const unique = new Map();
    for (const l of found) if (!unique.has(l.id)) unique.set(l.id, l);
    const discords = [...unique.values()].filter(l => l.platform === "discord"), telegrams = [...unique.values()].filter(l => l.platform === "telegram");
    log(`\n=== VALIDATING ${discords.length} Discord + ${telegrams.length} Telegram unique links (${found.length} occurrences) ===`);
    const results = new Map();
    for (let i = 0; i < discords.length; i++) {
        const d = discords[i];
        process.stdout.write(`[discord ${i + 1}/${discords.length}] ${d.url} ... `);
        const r = await validateDiscord(d.code); results.set(d.id, r);
        log(r.status === "VALID" ? `OK (${r.name}, ${r.members} members)` : `${r.status} - ${r.reason}`);
        await sleep(1500 + Math.random() * 1000);
    }
    // Telegram: 3 at a time
    let ti = 0;
    await Promise.all([0, 1, 2].map(async () => {
        while (ti < telegrams.length) {
            const t = telegrams[ti++];
            const r = await validateTelegram(t.code); results.set(t.id, r);
            log(`[telegram ${ti}/${telegrams.length}] ${t.url} ... ${r.status === "VALID" ? `OK (${r.reason})` : `${r.status} - ${r.reason}`}`);
            await sleep(400);
        }
    }));
    for (const l of found) { const r = results.get(l.id) || { status: "UNVERIFIED", reason: "not checked" }; Object.assign(l, r); l.checked_at = nowIso(); if (DEAD_STATUSES.has(l.status)) l.category = CATEGORY[l.platform][l.status]; }

    // Siblings = other links found on the same source page (what else the reader could click)
    const byPage = new Map();
    for (const l of found) { if (!byPage.has(l.source_page)) byPage.set(l.source_page, []); byPage.get(l.source_page).push(l); }
    for (const l of found) l.siblings = byPage.get(l.source_page).filter(s => s !== l);

    let dead = found.filter(l => DEAD_STATUSES.has(l.status));
    // Browser pass runs before prioritising, because priority depends on the (measured) visibility
    if (opts.useBrowser && (dead.length || opts.browserPages === "all")) await browserPass(found, dead, opts);

    for (const l of found) l.priority = priority(l, l.siblings);
    const prioRank = { P1_NO_WORKING_COMMUNITY_LINK: 0, P2_DEAD_LINK_IS_DISPLAYED: 1, P3_DEAD_LINK_IS_HIDDEN: 2 };
    dead = dead.sort((a, b) => (prioRank[a.priority] - prioRank[b.priority]) || (b.market_cap - a.market_cap) || a.project.localeCompare(b.project));

    const pageIndex = buildReports({ outDir: opts.out, all: found, dead, perPage: opts.perPage, opts, categoryLabel: CATEGORY_LABEL, startedAt: new Date(started).toISOString() });
    writeCsvs(opts.out, found, dead, pageIndex);
    fs.writeFileSync(path.join(opts.out, "all_links.json"), JSON.stringify(found.map(l => { const { siblings, ...rest } = l; return rest; }), null, 1));

    const count = (arr, f) => arr.filter(f).length;
    log("\n=== RESULTS ===");
    log(`Checked: ${discords.length} Discord + ${telegrams.length} Telegram unique links`);
    log(`Dead:    ${count(dead, l => l.platform === "discord")} Discord + ${count(dead, l => l.platform === "telegram")} Telegram (${dead.length} occurrences)`);
    log(`         P1 no working community link: ${count(dead, l => l.priority === "P1_NO_WORKING_COMMUNITY_LINK")} | P2 dead link displayed: ${count(dead, l => l.priority === "P2_DEAD_LINK_IS_DISPLAYED")} | P3 dead link hidden: ${count(dead, l => l.priority === "P3_DEAD_LINK_IS_HIDDEN")}`);
    log(`Other:   ${count(found, l => l.status === "USER_ACCOUNT")} Telegram links point at personal accounts/bots, ${count(found, l => l.status === "UNVERIFIED")} unverified`);
    log(`Output:  ${path.join(opts.out, "DEAD_LINKS.csv")}, ${path.join(opts.out, "ALL_LINKS.csv")}, ${path.join(opts.out, "report", "index.html")}`);
    log(`Took ${Math.round((Date.now() - started) / 1000)}s`);
    if (dead.length) { log("\n=== DEAD LEADS ==="); for (const d of dead) log(`${d.priority.split("_")[0]} ${d.category.padEnd(23)} ${d.url.padEnd(40)} ${d.project} (${d.symbol}) via ${d.source} [${d.placement.visibility}]`); }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { parseLink, extractLinks, validateDiscord, validateTelegram, PLACEMENT };
