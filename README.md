# The Portal UniversalBot

Unified Discord bot implementing the **arena finalist (a010, 64-56) design**: one bot/process for auction, stock, weather/BMKG fallback, and wiki.

## What's implemented
- **Core:** unified config (`.env.example`), validation (rejects `DISCORD_USER_TOKEN`), structured JSON logger, `/health` endpoint, single interaction/message router, idempotent scheduler, graceful shutdown.
- **DB:** SQLite (WAL) or Turso shim, legacy-compatible auction schema (`scope`), plus `stock_state`, `stock_events`, `wiki_cache`.
- **Stock (gateway, no selfbot):** `messageCreate/Update` watcher for `STOCK_CHANNEL_ID`, merchant parser ported, restart-safe dedupe state in DB, webhook ping on new target restock; HMAC-signed `/ingest/stock` fallback.
- **Wiki:** Fandom MediaWiki client with cache/negative-cache, infobox parser, resolve with search+token-truncation fallback, `/wiki` and `/item`.
- **Weather:** `/weather` command with Python renderer hook (spawn, timeout, `LITE_MODE`/fallback text embed). `python/render_card.py` not included—add from BMKG if needed.
- **Auction:** schema-compatible foundation with idempotent finalize-claim scheduler and `/auction status`; **full create/bid/panel/thread/restore UI parity must be ported from** `D:/Projects/the-portal-auction` into `src/modules/auction/*`.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill required values (`DISCORD_TOKEN`, `CLIENT_ID`, scope/channel IDs as needed). **Do not set `DISCORD_USER_TOKEN`.**
3. Deploy commands: `npm run deploy-commands`
4. Migrate legacy auctions DB (optional): `npm run migrate:legacy-auctions -- --from "D:/Projects/the-portal-auction/data/auctions.db"`
5. Run: `npm start` (or `npm run dev`)

## Tests
`npm test` runs `node --test` (add tests under `test/`).

## Notes
- No hardcoded secrets/tokens/webhook URLs. `LITE_MODE=true` disables heavy rendering for 512 MB hosts.
- Legacy sources (read-only reference): `D:/Projects/the-portal-auction`, `D:/Projects/the-portal-stock`, `D:/Projects/the-portal-bmkg`.
