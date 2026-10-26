# Dead Links Scraper v3

Finds Discord and Telegram community links on **CoinMarketCap**, **CoinGecko** and **DexScreener**,
validates them, and reports every dead one together with *where on the page it sits*
(visible chip, hidden dropdown, below the fold, or only in the site's data and never rendered)
and whether the same page still has a working alternative.

## Install

```bash
npm install                 # axios only
# optional, for --screenshots:
npm install playwright && npx playwright install chromium
```

## Run (Windows: just double-click `run.bat`)

`run.bat` shows a menu: pick a preset (quick check / dead-link hunt ranks 200-499 / deep hunt 500-1499 / custom ranks /
re-validate last scan), then a browser mode (none / headless Chromium / your Chrome / your Chrome with your profile / Edge).
It installs what is missing, writes to `output\<date>_<preset>\`, and opens the HTML report when done.

## Run from the command line

```bash
node dead_links_scraper.js --cmc 300 --cmc-start 200 --cg 100 --cg-start 200
node dead_links_scraper.js 100 50          # old positional form still works (CMC count, CoinGecko count)
node dead_links_scraper.js --help
```

| Option | Default | Meaning |
|---|---|---|
| `--cmc <n>` / `--cmc-start <rank>` | 100 / 1 | CoinMarketCap coins to scan and the first rank. Dead links live in ranks 100–1000+ |
| `--cg <n>` / `--cg-start <rank>` | 50 / 1 | CoinGecko coins to scan and the first rank |
| `--no-dex` | off | Skip DexScreener (latest token profiles + boosted tokens, all chains) |
| `--out <dir>` | `output` | Output folder |
| `--no-page-check` | off | Don't download CMC coin pages (faster; link placement is then "unknown" instead of chip vs dropdown) |
| `--screenshots` | off | Screenshot each dead link's spot on the real page with the element outlined in red (needs Playwright) |
| `--browser`, `--chrome`, `--edge`, `--chrome-profile`, ... | off | Browser mode, see the next section |
| `--cg-delay <ms>` | 6000 | Pause between CoinGecko calls. With `COINGECKO_API_KEY` set, 2500 is fine |
| `--per-page <n>` | 10 | Dead links per HTML report page |
| `--reuse-found` | off | Skip scraping and re-validate the links saved in `output/found_links.json` by the previous run |

## Browser mode: real Chrome / your own profile

Cloudflare-protected pages (DexScreener, often CoinGecko) reject curl, axios and headless Chromium regardless of
headers, because they fingerprint the TLS handshake and run a JavaScript challenge. Header spoofing does not help.
What does help is a **real installed Chrome**, ideally with **your own profile** (cookies, prior bot-check clearance).
That is also how tools like Kimi WebBridge work: they drive your actual browser instead of faking requests.

```bash
npm install playwright                      # no "npx playwright install" needed for --chrome / --edge

# 1) your installed Chrome, temporary profile, window visible
node dead_links_scraper.js --cmc 200 --cmc-start 300 --chrome --screenshots

# 2) your installed Chrome with YOUR profile (close Chrome completely first - check the tray)
node dead_links_scraper.js --cmc 200 --cmc-start 300 --chrome-profile default --screenshots
node dead_links_scraper.js ... --chrome-profile "C:\Users\you\AppData\Local\Google\Chrome\User Data" --profile-name "Profile 2"

# 3) keep Chrome open: work on a temporary copy of the profile (cookies may not decrypt on recent Chrome builds)
node dead_links_scraper.js ... --chrome-profile default --chrome-profile-copy

# Edge instead of Chrome
node dead_links_scraper.js ... --edge --chrome-profile default
```

| Option | Meaning |
|---|---|
| `--browser` | Browser pass with Playwright's bundled Chromium (headless). Fine for CMC, blocked on DexScreener |
| `--chrome` / `--edge` / `--channel <chromium\|chrome\|msedge>` | Which browser to drive. Real channels are headed by default |
| `--chrome-profile <dir\|default>` | Persistent context on a real "User Data" directory. `default` resolves to the OS default location |
| `--profile-name <name>` | Profile folder inside User Data (`Default`, `Profile 1`, ...) |
| `--chrome-profile-copy` | Copy Local State, Cookies, Preferences, Local Storage to a temp dir and run on that |
| `--headed` / `--headless` | Force the window on or off |
| `--browser-pages dead\|all` | Open only pages with a dead link (default) or every page that has a link |
| `--screenshots` | Save a PNG of each dead link's spot with the element outlined in red (implies the browser pass) |

What the browser pass changes in the output:

* Placement is **measured in the live DOM** instead of estimated: `visibility` becomes `VISIBLE`, `BELOW_FOLD`,
  `HIDDEN_DROPDOWN` (only after clicking CMC's `⌄` chip) or `NOT_RENDERED`, and the CSVs gain
  `placement_source`, `page_x`, `page_y`. The HTML report shows "Placement measured in the live page".
* Pages that still come back as a bot-check page are reported as `BLOCKED` in the console and keep the estimated
  placement, so nothing is silently wrong.
* If Chrome is already running with the profile you asked for, Playwright cannot attach to it. The script prints a
  clear message and continues without the browser pass. Close Chrome, or use `--chrome-profile-copy`.
* Default Windows paths: Chrome `%LOCALAPPDATA%\Google\Chrome\User Data`, Edge `%LOCALAPPDATA%\Microsoft\Edge\User Data`.
  macOS: `~/Library/Application Support/Google/Chrome`. Linux: `~/.config/google-chrome`.

## Output

```
output/
  DEAD_LINKS.csv            one row per dead link, prioritised & categorised
  ALL_LINKS.csv             every link checked (valid ones too) with status, member counts, placement
  all_links.json            raw data
  report/index.html         summary tiles, per-source table, legend, table of all dead links
  report/dead_links_01.html 10 dead links per page -> wireframe of the site with the dead link marked,
  report/dead_links_02.html the other links on that page (working or not), reason, how to reach it
  report/img/*.png          screenshots (only with --screenshots)
  found_links.json          links found by the scrape, reusable with --reuse-found
```

### DEAD_LINKS.csv columns

| Column | Meaning |
|---|---|
| `priority` | `P1_NO_WORKING_COMMUNITY_LINK` (page has no working Discord/Telegram at all), `P2_DEAD_LINK_IS_DISPLAYED` (visitors see and click it, but a working alternative exists), `P3_DEAD_LINK_IS_HIDDEN` (in a dropdown or not rendered) |
| `category` | `DISCORD_EXPIRED` (Discord code 50270), `DISCORD_INVALID` (code 10006: revoked / server gone / never existed), `TELEGRAM_NOT_FOUND` (username doesn't exist, claimable), `TELEGRAM_INVITE_INVALID` (private `+`/`joinchat` link revoked) |
| `dead_link`, `reason` | the link and the exact reason returned by Discord / parsed from t.me |
| `project`, `symbol`, `rank`, `market_cap_usd`, `chain` | project identity |
| `source_site`, `source_page_url` | CMC / COINGECKO / DEXSCREENER and the page the link was found on |
| `link_field` | which data field held it (`chat`, `announcement`, `chat_url`, `telegram_channel_identifier`, `socials.telegram`, …) |
| `page_section`, `visibility`, `needs_click`, `needs_scroll`, `how_to_find_it` | where it sits on the page: `VISIBLE`, `BELOW_FOLD`, `HIDDEN_DROPDOWN`, `NOT_RENDERED`, `UNKNOWN` |
| `working_alternatives` | other Discord/Telegram links on the same page that work (with member counts) |
| `other_dead_links_same_page`, `unverified_links_same_page` | the rest of the page's links |
| `report_page` | which HTML page/anchor shows this entry |

## How each site is laid out (checked by hand, Oct 2026, 1440×900)

* **CoinMarketCap** coin page – left stats sidebar has a `Socials` row of *icon-only* chips about 690 px down
  (visible without scrolling on desktop). Only a few chips fit; the rest (very often **Discord**) go behind a
  small `⌄` chevron that opens a popover – those links are not in the page DOM until clicked. Links in CMC's
  `announcement` field are not rendered at all, they only exist in the page's embedded JSON / detail API.
* **CoinGecko** coin page – `Info ▸ Community` row with labelled pills (`Discord`, `t.me`, …) about 1130 px
  down, i.e. one screen below the fold. CoinGecko's own Telegram/Discord sit in the footer and are ignored.
* **DexScreener** pair page – social buttons in the token card at the top of the left panel. The site is
  behind Cloudflare bot protection, so the layout is taken from the API's `info.socials` and not screenshotted.

## Validation rules

* **Discord** – `GET discord.com/api/v9/invites/<code>`: 200 + guild → valid (name, members, online);
  404 code `50270` → expired; 404 code `10006` → invalid/unknown. 429 / Cloudflare 1015 → wait (Retry-After) and retry.
* **Telegram** – `t.me/<handle>` always answers 200, so the page markers are read:
  `og:title "Telegram: Contact @…"` → username doesn't exist; `"Join group chat on Telegram"` without a button →
  private invite revoked; `N members / subscribers` → valid group/channel; `Send Message` → personal account or bot
  (reported as `USER_ACCOUNT`, not dead).
* Anything that could not be checked is `UNVERIFIED` and never counted as dead.

## What changed from v2

* v2 regex-scraped the whole CMC HTML – it picked up CMC's own footer `t.me/CoinMarketCapAnnouncements` and
  attributed it to the coin, turned `discord.gg/invite/<code>` into the bogus invite `invite`, and could not say
  whether a link was visible or hidden.
* v2 treated "Unknown Invite" as `BANNED` and any other Discord answer as *valid*; v3 uses Discord's error codes.
* v2's Telegram check accepted nearly everything (t.me always returns 200) – it never found a dead Telegram link.
* v2 only read CoinGecko's `telegram_channel_identifier` (usually empty) and the *first* Discord in `chat_url`;
  v3 reads all `chat_url`, the identifier and `announcement_url`, and records the CoinGecko page as the source.
* v2 only looked at 30 boosted Solana tokens on DexScreener with a made-up project name; v3 merges latest
  profiles + latest/top boosts on every chain and resolves name, symbol and market cap.
* CSV is now properly escaped, prioritised and categorised; HTML report with wireframes added.
