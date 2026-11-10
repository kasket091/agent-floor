# Agent Floor: site rooms and the fast, safe hook

Fork: `kasket091/agent-floor`, installed at `~/Tools/agent-floor`, branch `upgrade/site-rooms`.
Upstream: `develop212/agent-floor` at `c5422bb`.

## Why

Dave builds and QA-reworks client WordPress sites from Figma with Claude Code, in the Claude desktop app. Each site is an Elementor MCP connection. Builds now fan out into helper agents (section helpers, Header and Footer agents, reviewers, a Fable escalation specialist). Dave wants to glance at the office and see, per client site, who is working on it and what step they're on.

Upstream groups agents by project folder, and all of Dave's sessions start in the same folder (`Figma To Elementor Projects`), so everything lands in one room. Its hook also starts Node on every tool call, depends on Electron, shows raw Bash commands (which can hold site tokens) on monitors, and can install itself through `npx` from an npm name nobody owns.

## Goals

1. **One room per website connection.** Every MCP server that is a WordPress site gets a room, present even when nobody is working there.
2. **Agents go to the site they work on.** A session starts in a **Lobby** room and moves to a site's room the first time it touches that site. Its helpers join it there.
3. **The whiteboard shows the current step** from the desktop app's task list.
4. **Fast hook:** the common path costs a few milliseconds, not a Node start.
5. **No Electron.**
6. **Secrets never reach the screen.**
7. **No npm/npx install path**, and the package can't be published by accident.

## Non-goals

- A separate QA room. Reviewers sit in the site's room.
- Reading `build-notes.md` or any skill file for build phases.
- Windows or Linux support for the new hook (Dave is on macOS; upstream's Windows paths may break, that's acceptable).
- Codex and Cursor adapters: keep them working as they are, no new features.
- Real corridor walking between rooms (see "Moving rooms").

## Anti-goals (fail even if it works)

- **The hook ever slows Claude down or changes what it does:** it must print nothing to stdout, always exit 0, and never block longer than about 1 second, even when the floor is down or the payload is huge.
- **A token, password or `Authorization` value is visible anywhere in the UI** (monitor, name tag, speech bubble, whiteboard, agent card history) or in `GET /state` / `/stream`.
- **The office reads secrets from Claude's config:** it may read MCP server names and URLs only, never headers or env.
- Anything is sent off the machine.

## Constraints

- Server stays zero-dependency Node (>= 20), bound to `127.0.0.1`, as upstream.
- Keep the existing 3D scene and its quality; change it only where a goal needs it.
- Keep `shared/protocol.js` as the single reducer used by server and browser.
- `npm test` must cover the new logic (see "Tests").
- **Dave's live hooks run from `~/Tools/agent-floor`.** Build in a separate git worktree and only update that checkout at the end, so his real sessions don't run half-built code.
- Hook installation must keep Dave's other hooks in `~/.claude/settings.json` (task-observer, claude-mem, ponytail) and back up the file with a dated name, not just `.bak`.

## Decisions

### Sites and rooms

- **Source of sites:** at startup and then whenever the file changes (or every 30 s, builder's choice), the server reads `~/.claude.json`: top-level `mcpServers`, and each `projects[*].mcpServers`. It looks at each server's **name and `url` only**.
- **A server is a website** if its `url` contains `/wp-json/`. (Dave's site servers are named `<site>-elementor` with URLs like `https://penrithplastering.com.au/wp-json/elementor/mcp/`.)
- **Parsing the config:** a normal `JSON.parse` of the file is fine. Keep only `{name, url}` per server and drop the rest immediately; never log, store or send anything else from it. *(My call: the anti-goal is about the office holding or showing secrets, not about the parser seeing the bytes.)*
- **One room per website, keyed by host** (`url` host, lowercased, without `www.`). Elementor is moving sites from the `/wp-json/elementor/mcp/` endpoint to a newer one (`mcp-adapter-default-server`), so one site may end up with two connections, under names that may not end in `-elementor`. Both map to the same room. *(My call.)*
- **Room name:** from the server name with a trailing `-elementor`, `-mcp` or `-mcp-adapter-default-server` removed, words title-cased: `penrith-plastering-and-gyprock-elementor` → **"Penrith Plastering And Gyprock"**. If a host has several servers, use the shortest resulting name. *(My call.)*
- **Site rooms are pinned:** they exist with zero agents and are not pruned when empty. When a site is removed from the config, its room is unpinned and goes once empty. Pinning is a new flag on teams in the reducer (`pinned: true`), so the snapshot carries it.
- **Empty pinned rooms** render with their name on the door, "0 agents", and their lights dimmed. Exact look is the builder's call within the existing style.
- **Lobby:** a normal team with id `lobby`, name "Lobby". Not pinned (it appears when someone is in it).
- Order of rooms: Lobby first, then sites alphabetically. Builder's call if the layout code makes that awkward.

Note: today Dave has removed all site connections, so there will be no site rooms until he adds them back with `claude mcp add`. That is expected.

### Which room an agent is in

- A Claude session's lead starts in **Lobby** (replaces upstream's project-folder room). `AGENT_FLOOR_TEAM` still overrides, as upstream.
- The server keeps a per-session "current site". It changes when **any** hook payload for that session, the lead's or a helper's (helper payloads carry the same `session_id` plus `agent_id`), shows site work:
  1. `tool_name` is `mcp__<server>__…` and `<server>` is a known site → that site; or
  2. any string in `tool_input` contains a known site's host (e.g. `curl https://penrithplastering.com.au/...`, or a script argument) → that site.
- When the current site changes, **the whole session moves**: the lead and every helper of that session that is still active get the site's room as their `team`. Helpers spawned afterwards join the lead's room. *(My call: a session works on one site at a time, so its team stays together.)*
- Every event the server makes for a session carries the session's current room as `team`, so `ensureAgent` never pulls an agent back to an old room.
- A session never goes back to the Lobby on its own; it stays in the last site's room until it ends.

### Moving rooms

Upstream already handles a team change: the character is removed from the old room and walks in from the new room's entrance. That's good enough. A walk along the corridor is out of scope.

### Whiteboard: the current step

- The desktop app's task list is the `mcp__ccd_turn__update_plan` tool. Its input is either `{ items: [{content, status}], scope? }` (the whole list), or a delta: `{ advance: true }` (complete the `in_progress` step, start the next `pending`), or `{ done: [n…], start: m }` (1-based).
- **Only the lead's task list goes on the whiteboard.** Helpers also have this tool; their `update_plan` calls (payloads with an `agent_id`) are ignored for the whiteboard, so they can't replace or corrupt the lead's list. *(My call.)*
- The server keeps the lead's last list per session, applies deltas, and writes the room's whiteboard as **`<step>/<total> · <content of the in_progress step>`**. With no `in_progress` step, keep the last text.
- Upstream's `TodoWrite` handling stays as it is.
- When several sessions share a site room, the whiteboard shows whichever updated last (upstream behaviour for `task`).

### Fast hook

- The hook command in `settings.json` becomes a short `/bin/sh` command that:
  1. reads stdin once,
  2. `curl`s it to `POST http://127.0.0.1:4317/hooks/claude` with `-sf`, a 1-second max time, `Content-Type: application/json`, output to `/dev/null`;
  3. only if that fails, hands the same payload to `node <abs path>/bin/agent-floor.mjs hook claude` **detached, in the background**, so the hook itself returns at once. The Node fallback keeps upstream's launch-and-retry (which can take about 5 seconds) and then forwards the payload to the same endpoint; *(my call: upstream's wait would break the 1-second anti-goal)*
  4. always exits 0 and prints nothing.
- **All translation moves to the server.** `POST /hooks/claude` takes the raw Claude Code hook payload and does: site detection, plan tracking, `fromClaude()` (reused), secret hiding, then the reducer. The Node fallback no longer translates anything itself.
- **Big payloads** (`Write` content, large `Edit`s): the endpoint accepts up to 4 MB and drops anything above. It only ever keeps what the events need. The Node fallback trims oversized string fields before forwarding.
- Upstream's `/events` endpoint stays for other tools and `agent-floor emit`.
- **Target:** under 20 ms for the hook command when the floor is up, measured on Dave's Mac (upstream's Node path is about 50 ms). Report the measured before/after.

### Secret hiding

- Applied on the server to every string that can be displayed or stored: `activity`, `text`, `task`, `name`, and history entries, for every event source (hooks and `/events`). Done before the reducer, so neither the state nor the stream ever holds the secret.
- Replace with `•••`. At least:
  - `Authorization:` / `Proxy-Authorization:` header values (Bearer, Basic, anything)
  - `-u` / `--user user:pass` in curl, and `user:pass@` in URLs
  - `password`, `passwd`, `pwd`, `token`, `secret`, `api_key`, `apikey`, `key`, `auth` as `=`, `:` or JSON values
  - env-style assignments whose name contains `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `AUTH`
  - known token shapes: `gh[pousr]_…`, `github_pat_…`, `sk-ant-…`, `sk-…`, `xox[abpr]-…`, `AKIA…`, JWTs (`eyJ…`)
  - WordPress application passwords: six groups of four letters/digits separated by spaces
- Hide **before** any clipping. Upstream cuts Bash commands to 60 characters and activity to 280; a token cut in half can slip past the patterns.
- Prefer hiding too much over too little. It's a display, not a log.

### No Electron

- Remove `electron` from `optionalDependencies` and delete `desktop/` (move `desktop/state.cjs`, the snooze and launch-lock helper, somewhere the CLI keeps using).
- `agent-floor` (and the hook's launch path) opens a Chrome/Edge/Brave "app window" onto the floor, falling back to the default browser: upstream's existing non-Electron path.
- Closing the window leaves the server running, so hooks don't reopen it. Run `agent-floor` to open it again.
- The tray's "Quit (pause auto-open for 6 hours)" goes away. Replace it with `agent-floor quiet [hours]` (default 6), which uses the existing snooze file, plus `agent-floor stop` to stop the server. *(My call.)*

### No npm / npx

- Remove the `npx` branch from setup; hook commands always use the absolute path of this checkout. `setup` refuses to run from an `_npx` cache path.
- `"private": true` in `package.json` so it can't be published.
- README: install is clone → `npm ci` → `npm run build` → `node bin/agent-floor.mjs setup claude --write`. Remove the `npm i -g` and `npx` instructions.

## Tests

`npm test` (node's test runner, as upstream) covers:
- site detection: MCP tool names, URL hosts inside `tool_input`, non-site servers ignored, naming, two servers on one host giving one room, a helper's site call moving the whole session
- whiteboard: a helper's `update_plan` doesn't change the lead's list
- config reading: names and URLs only, project-scoped servers included, a removed site unpins its room
- plan tracking: full list, `advance`, `done`/`start`, no `in_progress` keeps the last text
- secret hiding: one case per pattern above, plus "no false positive" cases for ordinary commands
- `/hooks/claude` end to end: a payload in, the right events out, nothing secret in `/state`
- pinned rooms survive pruning; unpinned empty rooms still go
- the hook command: exits 0 with empty stdout when the server is up, when it's down with launch disabled (`AGENT_FLOOR_AUTOLAUNCH=0`), and with a 5 MB payload

## Left to the builder

- File layout for the new server code.
- How empty pinned rooms look, within the existing style.
- Config re-read mechanism (watch vs poll).
- How `quiet`/`stop` are implemented.
- Exact regexes for secret hiding, within the list above.

## Done means

- All tests pass and the build succeeds.
- Hook timing measured before and after on Dave's Mac.
- Checked live: with a site connection added back, a session starts in Lobby, moves to the site's room on its first site tool call, its whiteboard shows the current step, a helper joins it there, and a Bash command containing a fake `Authorization: Bearer …` shows `•••` on the monitor.
- Dave's other hooks in `~/.claude/settings.json` are untouched.
- Nothing is pushed until Dave says so.
