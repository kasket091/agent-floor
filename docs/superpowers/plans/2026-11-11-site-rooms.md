# Site Rooms, Fast Hook and Secret Hiding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every WordPress MCP connection its own pinned room, move Claude sessions to the site they touch, show the lead's current step on the whiteboard, make the hook a `curl` call, hide secrets, and drop Electron and the npm/npx path.

**Architecture:** The Claude hook becomes a shell one-liner that posts the raw hook payload to a new `POST /hooks/claude` endpoint. All translation moves into the server: a Claude ingest module trims and redacts the payload, works out the session's room (Lobby or a site from `~/.claude.json`), tracks the lead's task list, then reuses `fromClaude()` and the shared reducer. A new `rooms` event pins site rooms so the browser and server agree through `shared/protocol.js`.

**Tech Stack:** Node >= 20, zero-dependency server (ESM), `node:test`, three.js + Vite front end (TypeScript), POSIX `sh` + `curl` for the hook.

**Spec:** `docs/superpowers/specs/2026-11-11-site-rooms-design.md`

## Global Constraints

- Work only in the worktree `~/Tools/agent-floor-upgrade` (branch `upgrade/site-rooms`). Don't touch `~/Tools/agent-floor` until Task 9: Dave's live hooks run from it.
- Server stays zero-dependency Node >= 20, bound to `127.0.0.1`. No new npm dependencies anywhere.
- `shared/protocol.js` stays the single reducer for server and browser.
- The hook prints nothing to stdout, always exits 0, never blocks longer than about 1 second.
- No token, password or `Authorization` value in any displayed field or in `GET /state` / `/stream`.
- From `~/.claude.json` keep only each MCP server's `name` and `url`; never log, store or send anything else.
- Nothing is sent off the machine. Nothing is pushed to GitHub until Dave says so.
- Keep Dave's other hooks in `~/.claude/settings.json`; back it up as `settings.json.before-agent-floor-<YYYY-MM-DD>` before writing.
- macOS only for the new hook; Codex and Cursor adapters keep working unchanged.
- `npm test` and `npm run build` pass at the end of every task.

## Review Focus

1. **A hook payload with no `session_id` or no `hook_event_name`** (other tools, odd versions): the endpoint returns 2xx with nothing ingested, never 500. Test in Task 5.
2. **`~/.claude.json` missing, unreadable, or mid-write (invalid JSON):** the server keeps the last good site list and keeps running. Test in Task 2.
3. **A Bash command that is mostly a secret** (`curl -H "Authorization: Bearer <80 chars>" …`): the monitor text still reads sensibly (`Running curl -H "Authorization: •••" …`), not empty. Test in Task 1.
4. **The floor server is down and auto-launch is snoozed or disabled:** the hook still exits 0 within about 1 second and leaves no stuck processes. Test in Task 6.
5. **A site host that is a substring of another** (`site.com.au` vs `mysite.com.au`): host matching is on host boundaries, so the wrong room is never chosen. Test in Task 2.

---

### Task 1: Secret hiding

**Files:**
- Create: `server/redact.mjs`
- Test: `test/redact.test.mjs`

**Interfaces:**
- Produces: `redact(text: string): string` (non-strings returned unchanged); `redactDeep(value: unknown, maxString = 2000): unknown`, a copy with every string clipped to `maxString` characters **after** redaction is applied to the full string. Placeholder: `MASK = '•••'` (exported).

- [ ] **Step 1: Write the failing tests** in `test/redact.test.mjs`, one `test()` per pattern, each asserting the secret is gone and `•••` is present:
  - `curl -H "Authorization: Bearer abc.def.ghi" https://x.com` → contains `Authorization: •••`, not `abc.def`
  - `Proxy-Authorization: Basic dXNlcjpwYXNz` → value masked
  - `curl -u admin:s3cret https://x.com` and `--user admin:s3cret` → `s3cret` gone
  - `https://admin:s3cret@site.com/wp-json` → `s3cret` gone, host kept
  - `password=hunter2`, `"token": "abc123"`, `api_key: xyz`, `apikey=xyz`, `secret=xyz`, `auth=xyz`, `key=xyz` → values gone
  - `export WP_APP_PASSWORD=abcd` and `GITHUB_TOKEN=abcd node x.js` → values gone
  - token shapes: `ghp_` + 36 chars, `gho_…`, `github_pat_…`, `sk-ant-api03-…`, `sk-…` (20+ chars), `xoxb-…`, `AKIA` + 16 chars, a JWT `eyJhbGciOi….eyJzdWIi….sig` → each gone
  - WordPress application password `abcd EFGH 1234 ijkl MNOP 5678` → gone
  - no false positives: `npm run build`, `python3 tools/site.py push`, `Reading SKILL.md`, `git commit -m "fix key handling"` unchanged
  - Review Focus 3: `redact('curl -H "Authorization: Bearer ' + 'x'.repeat(80) + '" https://a.com')` contains `Authorization: •••` and `https://a.com`
  - `redactDeep({ a: 'password=x', b: ['ghp_' + 'a'.repeat(36)], c: 5 })` masks both strings and keeps `c: 5`
  - `redactDeep({ s: 'y'.repeat(5000) + ' password=x' }, 2000).s.length <= 2000`, and a secret straddling the 2000 boundary in the original is not partly visible

- [ ] **Step 2: Run** `node --test test/redact.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement** `redact` and `redactDeep` in `server/redact.mjs` as an ordered list of regexes (headers first, then URL userinfo, curl `-u`, key/value, env assignments, token shapes, app passwords). Header rule masks up to the closing quote or end of line.

- [ ] **Step 4: Run** `node --test test/redact.test.mjs` → PASS. Then `npm test` → all pass.

- [ ] **Step 5: Commit** `git add server/redact.mjs test/redact.test.mjs && git commit -m "Add secret hiding for displayed text"`

### Task 2: Sites from the Claude config

**Files:**
- Create: `server/sites.mjs`
- Test: `test/sites.test.mjs` (fixtures written to a temp dir inside the test)

**Interfaces:**
- Produces:
  - `type Site = { id: string, host: string, name: string, servers: string[] }`, where `id` = `host`
  - `readSites(configPath: string): Site[] | null`. `null` when the file is missing or invalid (the caller keeps its last list).
  - `roomNameFor(serverName: string): string`
  - `siteForPayload(sites: Site[], toolName?: string, toolInput?: unknown): Site | null`
  - `watchSites(configPath: string, onChange: (sites: Site[]) => void, intervalMs = 30000): () => void` (returns stop)
  - `DEFAULT_CONFIG = join(homedir(), '.claude.json')`, overridable with env `AGENT_FLOOR_CLAUDE_CONFIG`

- [ ] **Step 1: Write the failing tests:**
  - `roomNameFor('penrith-plastering-and-gyprock-elementor') === 'Penrith Plastering And Gyprock'`; trailing `-mcp` and `-mcp-adapter-default-server` also stripped
  - `readSites` on a fixture with top-level `mcpServers` (`figma` with a non-wp URL; `penrith-plastering-and-gyprock-elementor` with `https://www.penrithplastering.com.au/wp-json/elementor/mcp/` and a `headers.Authorization`) plus `projects['/x'].mcpServers` (`sydney-app-development-developers-elementor`) returns exactly 2 sites, hosts `penrithplastering.com.au` and `sydneyappdevelopers.com.au` (`www.` dropped, lowercased), and `JSON.stringify(result)` contains no `Authorization` and no header value
  - two servers on one host (`penrith-…-elementor` and `penrith-mcp-adapter-default-server`, both wp-json URLs) give 1 site with both names in `servers` and `name` = the shortest room name
  - missing file and a file containing `{"mcpServers": {` both return `null` (Review Focus 2)
  - `siteForPayload(sites, 'mcp__penrith-plastering-and-gyprock-elementor__elementor-get-page-structure')` → penrith; `'mcp__figma__get_metadata'` → null
  - `siteForPayload(sites, 'Bash', { command: 'curl -s https://penrithplastering.com.au/wp-json/wp/v2/pages' })` → penrith; nested arrays and objects searched too
  - Review Focus 5: with sites `site.com.au` and `mysite.com.au`, `curl https://mysite.com.au/x` → mysite, `curl https://site.com.au/x` → site
  - `watchSites` calls `onChange` once at start and again after the fixture file changes (poll interval set low in the test); not again when the list is unchanged

- [ ] **Step 2: Run** `node --test test/sites.test.mjs` → FAIL.

- [ ] **Step 3: Implement** in `server/sites.mjs`. Website rule: `url` contains `/wp-json/`. Host matching: a host (or `www.` + host) matches only when the character before it is not a letter, digit, `.` or `-`, and the character after it is `/`, `:`, a quote, whitespace or the end of the string. `readSites` builds `{name, url}` pairs and discards the parsed object before returning.

- [ ] **Step 4: Run** the tests → PASS; `npm test` → all pass.

- [ ] **Step 5: Commit** `git commit -m "Read website MCP connections from the Claude config"`

### Task 3: Lead task-list tracking

**Files:**
- Create: `server/plan.mjs`
- Test: `test/plan.test.mjs`

**Interfaces:**
- Produces: `type PlanItem = { content: string, status: 'pending' | 'in_progress' | 'completed' }`; `applyPlan(items: PlanItem[] | undefined, input: object): PlanItem[]`; `planText(items: PlanItem[]): string | undefined`, giving `'<n>/<total> · <content>'` for the first `in_progress` item, or `undefined` when there is none.

- [ ] **Step 1: Write the failing tests:**
  - `{ items: [a:completed, b:in_progress, c:pending] }` → `planText` = `'2/3 · b'`
  - then `{ advance: true }` → b completed, c in_progress, `'3/3 · c'`
  - `{ advance: true }` on the last step → all completed, `planText` undefined
  - `{ done: [1, 2], start: 3 }` on a 3-item list → 1 and 2 completed, 3 in_progress
  - a delta with no previous list → returns `[]`, no throw
  - out-of-range `done`/`start` numbers ignored

- [ ] **Step 2: Run** `node --test test/plan.test.mjs` → FAIL.
- [ ] **Step 3: Implement** both functions in `server/plan.mjs` (pure, returning new arrays).
- [ ] **Step 4: Run** → PASS; `npm test` → all pass.
- [ ] **Step 5: Commit** `git commit -m "Track the lead's task list for the whiteboard"`

### Task 4: Pinned rooms in the protocol

**Files:**
- Modify: `shared/protocol.js` (`EVENT_TYPES`, `normalizeEvent`, `ensureTeam`, the reducer switch, `sweep`)
- Modify: `shared/protocol.d.ts` (`Team.pinned?: boolean`, the `rooms` event type)
- Modify: `docs/protocol.md` (document `rooms` and pinning)
- Test: `test/protocol.test.mjs`

**Interfaces:**
- Produces: event `{ type: 'rooms', rooms: [{ id: string, name: string }] }`. `normalizeEvent` accepts it without `agent` (like `reset`) and keeps up to 64 rooms, ids slugged, names clipped to 48. Reducer: every listed room exists with `pinned: true` and the given name; every other team gets `pinned: false`. `sweep` never deletes a team with `pinned: true`.

- [ ] **Step 1: Write the failing tests:**
  - after `rooms` with `[{id:'penrithplastering.com.au', name:'Penrith Plastering'}]`, `state.teams['penrithplastering-com-au']` exists, `pinned === true`, no agents, and survives `sweep`
  - a second `rooms` event without it sets `pinned: false`, and the next `sweep` removes it (empty)
  - an unpinned empty team is still removed by `sweep` (upstream behaviour)
  - `normalizeEvent({ type: 'rooms', rooms: 'x' })` returns `{ type: 'rooms', rooms: [] }`

- [ ] **Step 2: Run** `npm test` → new tests FAIL.
- [ ] **Step 3: Implement** in `shared/protocol.js`, then update `protocol.d.ts` and `docs/protocol.md`. Room ids are slugged with the existing `slug()`, so `penrithplastering.com.au` becomes `penrithplastering-com-au`; Task 5 uses that slug as the `team`.
- [ ] **Step 4: Run** `npm test` and `npm run build` (typecheck) → pass.
- [ ] **Step 5: Commit** `git commit -m "Add pinned rooms to the protocol"`

### Task 5: Claude ingest and the server endpoints

**Files:**
- Create: `server/claude-ingest.mjs`
- Modify: `server/index.mjs` (routes, per-route body limit, redaction of `/events`, site watching, `rooms` broadcast)
- Modify: `adapters/claude.mjs` only if a change is unavoidable (prefer overriding `team` after it runs)
- Test: `test/claude-ingest.test.mjs`, `test/server.test.mjs`

**Interfaces:**
- Consumes: `redact`, `redactDeep` (Task 1); `Site`, `siteForPayload`, `watchSites`, `DEFAULT_CONFIG` (Task 2); `applyPlan`, `planText` (Task 3); the `rooms` event (Task 4); `fromClaude(input)` from `adapters/claude.mjs`.
- Produces:
  - `createClaudeIngest({ getSites: () => Site[], getState: () => WorldState }): (payload: object) => InboundEvent[]`. Pure apart from its own per-session memory: `Map<session_id, { room: { id, name }, plan: PlanItem[] }>`.
  - `LOBBY = { id: 'lobby', name: 'Lobby' }`
  - `startServer({ ..., claudeConfig = process.env.AGENT_FLOOR_CLAUDE_CONFIG || DEFAULT_CONFIG, sitesPollMs = 30000 })`
  - Routes: `POST /hooks/claude` (body limit 4 MB, returns `202 { accepted }`), `POST /shutdown` (returns 200, then closes the server and exits the process only when started from the CLI; in tests `close()` is used), `/events` unchanged except that `activity`, `text`, `task` and `name` are passed through `redact` before `normalizeEvent`.

Ingest order for one payload: `redactDeep(payload, 2000)` → if no `session_id` or `hook_event_name`, return `[]` → site check with `siteForPayload` on the redacted copy (any agent: lead or helper) → if the site changed, update the session's room and add a `status` event with the new `team`/`teamName` for every agent in `getState().agents` whose id is the lead id or starts with `lead + ':'` → if `tool_name === 'mcp__ccd_turn__update_plan'` and no `agent_id`, update the plan and add a `task` event with `planText` (when defined) → `fromClaude(redactedPayload)` → set `team`/`teamName` on every event to the session's room. `AGENT_FLOOR_TEAM` in the server's env overrides the Lobby as the starting room.

- [ ] **Step 1: Write the failing tests** in `test/claude-ingest.test.mjs`, using `fromClaude`-shaped payloads, `session_id: 's1'`, and a fixed site list:
  - `SessionStart` → join for `claude-code:s1` with `team: 'lobby'`
  - `PreToolUse` `mcp__penrith…-elementor__x` → events carry the penrith room; a later `Read` stays in the penrith room
  - a helper payload (`agent_id: 'h1'`, `agent_type: 'general-purpose'`) with `Bash` `curl https://penrithplastering.com.au/...` moves the session; with the lead and `claude-code:s1:abc` in the given state, both get a `status` event with the penrith team
  - `update_plan` `{ items: [...] }` from the lead → a `task` event `'1/3 · …'`; then `{ advance: true }` → `'2/3 · …'`; the same tool from a helper (`agent_id` set) → no `task` event
  - `Bash` with `Authorization: Bearer secret123` → no event field contains `secret123`
  - Review Focus 1: `{}` and `{ session_id: 's1' }` → `[]`
  - in `test/server.test.mjs`: start with `claudeConfig` pointing at a temp fixture with one site and `sitesPollMs: 50`; `/state` shows that site's room `pinned: true`; `POST /hooks/claude` with a `SessionStart` → 202 and the lead in `lobby`; a 5 MB body → 413; posting `{ type: 'status', agent: 'a', activity: 'password=x' }` to `/events` → `/state` doesn't contain `password=x`; rewriting the fixture without the site unpins it

- [ ] **Step 2: Run** `npm test` → new tests FAIL.
- [ ] **Step 3: Implement** `server/claude-ingest.mjs`, then wire it into `server/index.mjs`: `readBody(req, limit)`, the two routes, a `watchSites` subscription that ingests a `rooms` event on change (and on start), and stopping the watcher in `close()`.
- [ ] **Step 4: Run** `npm test` → all pass.
- [ ] **Step 5: Commit** `git commit -m "Translate Claude hooks on the server: site rooms, lead plan, redaction"`

### Task 6: Fast hook, no npx, no Electron, quiet and stop

**Files:**
- Modify: `bin/agent-floor.mjs` (`hookCmd`, `claudeHooks`, `hook`, `postOrLaunch`, `openApp`, `setup`, `backupAndWrite`, command dispatch, help text)
- Move: `desktop/state.cjs` → `bin/state.cjs`; delete `desktop/main.cjs`, `desktop/icon.cjs`
- Modify: `package.json` (remove `optionalDependencies.electron`, remove `desktop` from `files`, add `"private": true`), then `npm install` to refresh `package-lock.json`
- Test: `test/hook.test.mjs`

**Interfaces:**
- Consumes: `POST /hooks/claude` and `POST /shutdown` (Task 5).
- Produces:
  - `claudeHookCommand(port: number, self: string): string`, exported for tests. The exact shell:
    ```sh
    p=$(cat); printf '%s' "$p" | curl -sf -m 1 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:<port>/hooks/claude >/dev/null 2>&1 || { printf '%s' "$p" | nohup node "<self>" hook claude >/dev/null 2>&1 & }; exit 0
    ```
  - `agent-floor hook claude`: reads stdin, clips any string over 2000 chars, then `postOrLaunch` posts the raw payload to `/hooks/claude` (launching if needed). No translation happens client-side any more.
  - `agent-floor quiet [hours=6]` (uses `snooze`), `agent-floor stop` (`POST /shutdown`, prints whether a floor was running).
  - `setup claude --write`: refuses with a clear message when `SELF` is under an `_npx` path; writes the backup `settings.json.before-agent-floor-<YYYY-MM-DD>` (suffix `-2`, `-3` if it exists) as well as `.bak`; replaces older Agent Floor entries via `isOurs`.

- [ ] **Step 1: Write the failing tests** in `test/hook.test.mjs`, running `claudeHookCommand(port, SELF)` with `spawnSync('/bin/sh', ['-c', cmd], { input })`:
  - server up (started in-test on port 0): exit 0, stdout `''`, under 1000 ms, and the lead appears in `/state`
  - server down (unused port) with env `AGENT_FLOOR_AUTOLAUNCH=0`: exit 0, stdout `''`, under 1000 ms (Review Focus 4), and no `node … hook claude` process still running 3 s later
  - 5 MB payload with the server up: exit 0, stdout `''`, under 1500 ms, and the lead still appears (through the fallback's clipping)
  - `claudeHooks()` output contains no `npx`, and every command contains the absolute `SELF`

- [ ] **Step 2: Run** `node --test test/hook.test.mjs` → FAIL.
- [ ] **Step 3: Implement** the CLI changes, the file moves and the `package.json` edits, then run `npm install` and check `node_modules/electron` is gone.
- [ ] **Step 4: Run** `npm test` and `npm run build` → pass. `grep -rn "electron\|npx" bin server shared package.json` shows nothing that runs Electron or installs through npx.
- [ ] **Step 5: Commit** `git commit -m "Fast curl hook; drop Electron and the npx path; add quiet and stop"`

### Task 7: Empty pinned rooms in the scene

**Files:**
- Modify: `src/world/layout.ts` (`SeatBook` keeps wings for pinned teams; ordering)
- Modify: `src/world/TeamRoom.ts` (dimmed lights and "0 AGENTS" when empty)
- Modify: `src/world/World.ts` only if needed to pass the empty state through

**Interfaces:**
- Consumes: `Team.pinned` (Task 4).
- Produces: no new exports. Behaviour: pinned rooms with no agents are laid out, keep their position when agents come and go, show the name on the door and "0 AGENTS", and have their pod lights dimmed. Order: `lobby` first, then the rest by `team.name` (A–Z). If the existing wing logic makes that awkward, keep upstream order and say so in the commit message (the spec allows it).

- [ ] **Step 1: Run** `npm run build` → passes before changes (baseline).
- [ ] **Step 2: Implement** the layout and room changes.
- [ ] **Step 3: Verify visually:** `npm run dev`; post a `rooms` event with three sites and one `join` into `lobby` (`curl` to `/events`). In the browser at `http://localhost:5173`: Lobby first, three dim empty rooms with their names and "0 AGENTS". Post a join into one site room: its lights come up and nothing else moves. Screenshot both states.
- [ ] **Step 4: Run** `npm run build` and `npm test` → pass.
- [ ] **Step 5: Commit** `git commit -m "Show empty pinned site rooms, dimmed, Lobby first"`

### Task 8: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite** Quick start, Connect your tools (Claude Code), Configuration, Privacy and safety, and The desktop app sections:
  - install = clone → `npm ci` → `npm run build` → `node bin/agent-floor.mjs setup claude --write`
  - remove `npm i -g` and every `npx` line
  - rooms = Lobby plus one per WordPress MCP connection
  - secrets shown as `•••`
  - `quiet` and `stop` replace the tray menu
  - new env `AGENT_FLOOR_CLAUDE_CONFIG`
  - Electron removed
- [ ] **Step 2: Check** `grep -n "npx\|npm i -g\|Electron\|menu bar" README.md` → nothing left that describes the old behaviour.
- [ ] **Step 3: Commit** `git commit -m "README: install from source, site rooms, secret hiding"`

### Task 9: Measure, install, check live

**Files:** none in the repo. This changes Dave's live checkout and settings.

- [ ] **Step 1: Measure the old hook** from the live checkout `~/Tools/agent-floor` (still upstream), with the floor running: time 20 runs of `node ~/Tools/agent-floor/bin/agent-floor.mjs hook claude` fed a `PreToolUse` payload. Record the average.
- [ ] **Step 2: Whole-branch review** by a fresh reviewer (`opus`, high effort) against the spec. Fix what it finds and re-run `npm test` and `npm run build`.
- [ ] **Step 3: Install locally:** in `~/Tools/agent-floor`, run `node bin/agent-floor.mjs stop` (or stop the running server), `git merge --ff-only upgrade/site-rooms`, `npm ci`, `npm run build`, `node bin/agent-floor.mjs setup claude --write`. Confirm the dated backup exists and Dave's non-Agent-Floor hooks are byte-identical to before (compare with the backup).
- [ ] **Step 4: Measure the new hook** the same way with the new command (20 runs through `/bin/sh -c`). Target: under 20 ms average. Record both numbers.
- [ ] **Step 5: Live check** with `AGENT_FLOOR_CLAUDE_CONFIG` pointing at a temp config holding one fake site (`example-site-elementor`, `https://example.com/wp-json/elementor/mcp/`), feeding real-shaped payloads through the installed hook command:
  - the session appears in Lobby
  - an `mcp__example-site-elementor__…` call moves it to "Example Site"
  - an `update_plan` shows `1/3 · …` on the whiteboard
  - a helper join sits with it
  - a Bash command with `Authorization: Bearer test123` shows `•••` on the monitor

  Screenshot each. Then restart the floor without the override, so it reads the real `~/.claude.json`.
- [ ] **Step 6: Report** to Dave: before/after hook timing, the screenshots, the backup path, and that nothing is pushed. **Push only after Dave says so:** `git push -u origin upgrade/site-rooms` and `git push origin main`.
