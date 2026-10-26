"use strict";
/**
 * Browser layer for dead_links_scraper.js (optional, needs `npm i playwright`).
 *
 * Why: Cloudflare-protected pages (DexScreener, sometimes CoinGecko) reject curl/axios and headless Chromium
 * no matter what headers you send - they fingerprint the TLS handshake and run JavaScript challenges.
 * A real, installed Chrome, ideally with your own profile (cookies, prior clearance), passes them.
 *
 * What it does for the scraper:
 *   - opens each source page in the browser, finds the Discord/Telegram anchors in the live DOM,
 *     and MEASURES where each one is (visible on load / below the fold / only after opening a dropdown /
 *     present but hidden / not rendered at all) instead of relying on the hand-written placement table
 *   - takes the screenshot with the dead link outlined, in the same visit
 *
 * Launch modes:
 *   channel "chromium" (default)    Playwright's bundled Chromium, headless, temp profile
 *   channel "chrome" | "msedge"     your installed Google Chrome / Microsoft Edge, headed by default
 *   chromeProfile <dir>             persistent context on a real "User Data" dir (+ profileName, e.g. "Default")
 *   chromeProfileCopy               copy the key profile files to a temp dir first (lets Chrome stay open; cookies
 *                                   may not decrypt on recent Chrome versions - best effort)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const VIEWPORT = { width: 1440, height: 900 };
const BLOCKED_TITLE = /just a moment|security verification|attention required|access denied|verify you are human|checking your browser|cloudflare/i;
const HEADLESS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Default "User Data" directory of Chrome / Edge on this OS. */
function defaultUserDataDir(channel = "chrome") {
    const home = os.homedir();
    const isEdge = channel === "msedge";
    if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), isEdge ? "Microsoft\\Edge\\User Data" : "Google\\Chrome\\User Data");
    if (process.platform === "darwin") return path.join(home, "Library", "Application Support", isEdge ? "Microsoft Edge" : "Google", isEdge ? "" : "Chrome");
    return path.join(home, ".config", isEdge ? "microsoft-edge" : "google-chrome");
}

/** Best-effort copy of the files that matter (cookies, prefs, encryption key) into a temp dir. */
function copyProfile(userDataDir, profileName) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "dls-chrome-profile-"));
    const copy = (rel) => { const src = path.join(userDataDir, rel); if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true }); fs.cpSync(src, path.join(dest, rel), { recursive: true, force: true }); } };
    copy("Local State");
    for (const f of ["Cookies", "Cookies-journal", "Network/Cookies", "Network/Cookies-journal", "Preferences", "Secure Preferences", "Local Storage", "Session Storage", "IndexedDB"]) copy(path.join(profileName, f));
    return dest;
}

/**
 * Open the browser according to opts. Returns { context, close, mode } or null (with a logged reason).
 * opts: { channel, chromeProfile, profileName, chromeProfileCopy, headed }
 */
async function openBrowser(opts, log = console.log) {
    let chromium;
    try { ({ chromium } = require("playwright")); } catch { log("[browser] playwright is not installed - run: npm i playwright && npx playwright install chromium   (skipping browser features)"); return null; }
    const channel = opts.channel && opts.channel !== "chromium" ? opts.channel : undefined;
    const headless = opts.headed === undefined ? !(channel || opts.chromeProfile) : !opts.headed;
    // No automation-hiding flags on purpose: the point of this mode is to be a genuine browser, not to disguise one.
    const common = { headless, channel, viewport: VIEWPORT, locale: "en-US", args: [] };
    const describe = `${channel || "bundled chromium"}, ${headless ? "headless" : "headed"}`;
    try {
        if (opts.chromeProfile) {
            let userDataDir = opts.chromeProfile === "default" ? defaultUserDataDir(opts.channel) : path.resolve(opts.chromeProfile);
            const profileName = opts.profileName || "Default";
            if (!fs.existsSync(userDataDir)) { log(`[browser] profile dir not found: ${userDataDir}`); return null; }
            if (opts.chromeProfileCopy) { userDataDir = copyProfile(userDataDir, profileName); log(`[browser] using a temporary copy of the profile: ${userDataDir}`); }
            const context = await chromium.launchPersistentContext(userDataDir, { ...common, args: [...common.args, `--profile-directory=${profileName}`] });
            log(`[browser] ${describe}, real profile "${profileName}" in ${userDataDir}`);
            return { context, mode: describe + ", real profile", close: () => context.close().catch(() => { }) };
        }
        const browser = await chromium.launch(common);
        const context = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", ...(channel ? {} : { userAgent: HEADLESS_UA }) });
        log(`[browser] ${describe}, temporary profile`);
        return { context, mode: describe, close: () => browser.close().catch(() => { }) };
    } catch (e) {
        const msg = String(e.message || e);
        if (/ProcessSingleton|already running|profile.*in use|Failed to create a ProcessSingleton|Opening in existing browser session/i.test(msg) || (opts.chromeProfile && /Target page, context or browser has been closed|browser has disconnected/i.test(msg)))
            log(`[browser] Chrome is already running with that profile, so it cannot be opened a second time.\n          Close Chrome completely (also from the tray), or add --chrome-profile-copy to work on a copy, or drop --chrome-profile and just use --channel chrome.`);
        else if (/Executable doesn't exist|chrome.*not found|Chromium distribution .* is not found/i.test(msg))
            log(`[browser] ${opts.channel || "chromium"} is not installed where Playwright expects it. Install Chrome/Edge, or run: npx playwright install chromium`);
        else log(`[browser] failed to launch (${describe}): ${msg.split("\n")[0]}`);
        return null;
    }
}

async function dismissBanners(page) {
    try { const ot = page.locator("#onetrust-accept-btn-handler"); if (await ot.isVisible({ timeout: 1200 })) await ot.click({ timeout: 1500 }); } catch { }
    for (const t of ["Accept Cookies and Continue", "Accept all", "Accept", "I agree", "Got it"]) { try { const b = page.getByRole("button", { name: t }).first(); if (await b.isVisible({ timeout: 250 })) await b.click({ timeout: 800 }); } catch { } }
    try { await page.evaluate(() => { for (const sel of ["#onetrust-consent-sdk", "#cmc-cookie-policy-banner", "[id*='cookie-banner']", "[class*='cookie-banner']", "[id*='CookieBanner']"]) document.querySelectorAll(sel).forEach(e => e.remove()); }); } catch { }
}

/** Collect every Discord/Telegram anchor in the live DOM with geometry + context. Runs in the page. */
function collectAnchors() {
    const out = [];
    const sel = 'a[href*="discord.gg"],a[href*="discord.com/invite"],a[href*="discordapp.com/invite"],a[href*="t.me/"],a[href*="telegram.me/"]';
    const isFooter = el => !!el.closest("footer,[data-test*='footer'],[class*='footer' i],[id*='footer' i]");
    const popSel = "[role='tooltip'],[role='dialog'],[role='menu'],[role='listbox'],[data-test*='popover'],[class*='popover' i],[class*='dropdown' i],[class*='menu' i]";
    const labelRe = /^(socials?|community|links|official links|social links|chat|channels?)$/i;
    document.querySelectorAll(sel).forEach(a => {
        const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
        let label = "", e = a, depth = 0;
        while (e && e !== document.body && depth < 8 && !label) {
            for (const c of e.children) { const t = (c.innerText || c.textContent || "").trim(); if (t.length <= 20 && labelRe.test(t)) { label = t; break; } }
            e = e.parentElement; depth++;
        }
        const visible = !!a.offsetParent && r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.05;
        out.push({ href: a.getAttribute("href") || "", text: (a.innerText || a.getAttribute("aria-label") || a.title || "").trim().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), visible, footer: isFooter(a), popover: !!a.closest(popSel), label, dataTest: (a.closest("[data-test]") || {}).getAttribute ? (a.closest("[data-test]").getAttribute("data-test")) : "" });
    });
    return { scrollHeight: document.documentElement.scrollHeight, anchors: out };
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hrefMatches(href, link) {
    const h = (href || "").toLowerCase().replace(/^\/\//, "https://");
    const code = link.code.toLowerCase().replace(/^\+/, "");
    const re = link.platform === "discord" ? new RegExp(`discord(?:app)?\\.(?:gg|com/invite)/(?:invite/)?${escRe(code)}(?:[/?#]|$)`) : new RegExp(`(?:t\\.me|telegram\\.me)/(?:s/)?(?:joinchat/|\\+)?${escRe(code)}(?:[/?#]|$)`);
    return re.test(h);
}

const SITE_BASE = { CMC: "Left sidebar", COINGECKO: "Left column > Info", DEXSCREENER: "Left token panel" };
/** Turn measurements into the placement object the CSV/report use. */
function placementFrom(site, link, initial, afterClick, info) {
    const mine = a => hrefMatches(a.href, link) && !a.footer;
    const hits = initial.filter(mine), later = afterClick.filter(mine);
    const base = SITE_BASE[site] || "Page";
    const rowOf = a => a.label ? `${a.label} row` : (a.dataTest ? a.dataTest.replace(/^section-/, "").replace(/-/g, " ") : "social links");
    const mk = (visibility, section, how, needsClick, needsScroll, a) => ({ visibility, section, how, needsClick, needsScroll, measured: true, measured_mode: info.mode, measured_at: new Date().toISOString(), x: a?.x, y: a?.y, w: a?.w, h: a?.h });
    const vis = hits.find(a => a.visible);
    if (vis) {
        const screens = vis.y / VIEWPORT.height;
        if (vis.y + vis.h <= VIEWPORT.height) return mk("VISIBLE", `${base} > ${rowOf(vis)}`, `Measured in the live page: ${vis.text ? `"${vis.text}" ` : "icon "}link at (${vis.x}, ${vis.y}) px, ${vis.w}×${vis.h} px - inside the first screen on a 1440×900 window, no scrolling or clicking needed.`, false, false, vis);
        return mk("BELOW_FOLD", `${base} > ${rowOf(vis)}`, `Measured in the live page: ${vis.text ? `"${vis.text}" ` : ""}link at (${vis.x}, ${vis.y}) px - about ${screens.toFixed(1)} screens down on a 1440×900 window, so the visitor has to scroll to see it.`, false, true, vis);
    }
    if (hits.length) return mk("HIDDEN_DROPDOWN", `${base} > ${rowOf(hits[0])} (hidden element)`, `Present in the page's DOM at (${hits[0].x}, ${hits[0].y}) px but not displayed (collapsed/hidden container); it only shows after some interaction.`, true, false, hits[0]);
    if (later.length) { const a = later[0]; return mk("HIDDEN_DROPDOWN", `${base} > ${rowOf(initial.find(i => !i.footer && i.label) || a)} > '⌄ more' dropdown`, `Not in the page until the '⌄ more' control is clicked; the popover then lists it${a.text ? ` as "${a.text}"` : ""} at (${a.x}, ${a.y}) px.`, true, false, a); }
    if (info.blocked) return null; // keep the API-derived placement
    return mk("NOT_RENDERED", `${site === "CMC" ? "CMC" : site === "COINGECKO" ? "CoinGecko" : "DexScreener"} data only (${link.field})`, `Checked the live page (title: "${info.title}") - this link is not rendered anywhere, it exists only in the site's data/API (${link.field}).`, false, false, null);
}

/**
 * Visit one source page: measure placement for every link found on it, optionally screenshot the dead ones.
 * links: all links with this source_page. Returns { ok, blocked, title, updated: n, shots: n }.
 */
async function inspectPage(context, url, links, { imgDir, screenshotLinks = [], log = () => { } } = {}) {
    const site = links[0]?.source || "CMC";
    const page = await context.newPage();
    const result = { ok: false, blocked: false, title: "", updated: 0, shots: 0 };
    try {
        let resp = null;
        try { resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch (e) { result.error = e.message.split("\n")[0]; }
        // give bot challenges (Cloudflare "Just a moment") up to 25s to clear - they usually do in a real Chrome
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) { result.title = await page.title().catch(() => ""); if (!BLOCKED_TITLE.test(result.title)) break; await page.waitForTimeout(1000); }
        await page.waitForTimeout(site === "DEXSCREENER" ? 4000 : 3000);
        await dismissBanners(page);
        result.title = await page.title().catch(() => "");
        result.blocked = BLOCKED_TITLE.test(result.title) || (resp && [403, 429, 503].includes(resp.status()) && !/coinmarketcap|coingecko|dex screener/i.test(result.title));
        const initial = (await page.evaluate(collectAnchors)).anchors;
        // open "more" controls that hide social links (CMC's ⌄ chip; generic "more"/"socials" buttons)
        let afterClick = [];
        const moreSel = ['[data-test="chip-more-social-links"]', 'button[aria-haspopup="true"][aria-label*="more" i]', 'button[aria-label*="social" i]'];
        for (const s of moreSel) { try { const b = page.locator(s).first(); if (await b.count() && await b.isVisible({ timeout: 300 })) { await b.scrollIntoViewIfNeeded(); await b.click({ timeout: 2000 }); await page.waitForTimeout(900); afterClick = (await page.evaluate(collectAnchors)).anchors; break; } } catch { } }
        const info = { blocked: result.blocked, title: result.title, mode: context._dlsMode || "browser" };
        if (!result.blocked) {
            for (const l of links) { const p = placementFrom(site, l, initial, afterClick, info); if (p) { l.placement = p; result.updated++; } }
            result.ok = true;
        }
        // screenshots (dead links only)
        for (const l of screenshotLinks) {
            if (!imgDir) break;
            try {
                const hiddenInPop = l.placement?.visibility === "HIDDEN_DROPDOWN";
                let el = null;
                for (const a of [...afterClick, ...initial]) { if (hrefMatches(a.href, l) && !a.footer) { el = a; break; } }
                let clip;
                if (el) {
                    if (hiddenInPop) { for (const s of moreSel) { try { const b = page.locator(s).first(); if (await b.count() && await b.isVisible({ timeout: 300 })) { const opened = await page.locator(`a[href*="${l.code.replace(/^\+/, "")}"]`).first().isVisible().catch(() => false); if (!opened) { await b.click({ timeout: 2000 }); await page.waitForTimeout(700); } break; } } catch { } } }
                    const loc = page.locator(`a[href*="${l.code.replace(/^\+/, "")}"]`).filter({ hasNot: page.locator("footer a") }).first();
                    if (await loc.count()) {
                        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
                        await loc.evaluate(e => { e.style.outline = "4px solid #e5484d"; e.style.outlineOffset = "3px"; e.style.boxShadow = "0 0 0 8px rgba(229,72,77,.25)"; }).catch(() => { });
                        const box = await loc.boundingBox().catch(() => null);
                        if (box) clip = { x: Math.max(0, box.x - 320), y: Math.max(0, box.y - 220), width: 720, height: 460 };
                    }
                }
                const file = `${l.platform}_${l.code.replace(/[^A-Za-z0-9_-]/g, "_")}.png`;
                await page.screenshot({ path: path.join(imgDir, file), clip });
                l.screenshot = `img/${file}`;
                l.screenshot_note = result.blocked ? "Page was blocked by a bot check - screenshot shows the challenge page" : clip ? `Red outline = the dead link (${info.mode})` : "Link element not found in the live page; viewport screenshot only";
                result.shots++;
            } catch (e) { l.screenshot_note = `screenshot failed: ${String(e.message).split("\n")[0]}`; }
        }
    } finally { await page.close().catch(() => { }); }
    return result;
}

module.exports = { openBrowser, inspectPage, defaultUserDataDir, VIEWPORT };
