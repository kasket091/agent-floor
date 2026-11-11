# Skill Staff Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permanent Build and QA Rework rooms. They are staffed by one standby employee per skill role. Role-tagged agents from the two Figma-to-Elementor skills wake their employee, who walks to the client's room, works, and walks back.

**Architecture:**
- **Server:** the server owns the staff. A roster file defines them. `server/staff.mjs` turns the roster into events, and the Claude ingest maps role-tagged spawns, subagent tool calls and `SubagentStop` onto employees and extras.
- **Protocol:** staff agents carry a `staff` flag that `sweep` respects.
- **Browser:** walks an agent between rooms when its team changes, instead of dropping it and re-entering from the street.
- **Skills:** gain a Tag column.

**Tech Stack:** Node 22 ESM server, `node --test`, TypeScript and three.js in the browser, Markdown skills.

**Spec:** `docs/superpowers/specs/2026-11-12-skill-staff-rooms-design.md`. Read it first. Its "Role tags" section replaces the rosters' "Matched by" column.

## Global Constraints

- **Zero tokens:** no network calls. All matching uses hook payloads the server already receives.
- **Hook speed:** the hook command in `bin/agent-floor.mjs` (`claudeHookCommand`) is unchanged.
- **Tags:**
  - Build: `[build:section]`, `[build:laptop]`, `[build:tablet]`, `[build:mobile]`, `[build:header]`, `[build:footer]`, `[build:evidence]`, `[build:reviewer]`, `[build:sweeper]`, `[build:escalation]`
  - QA Rework: `[qa:batch]`, `[qa:evidence]`, `[qa:reviewer]`, `[qa:escalation]`
- **Desk counts:**
  - Build: section 3, laptop 1, tablet 1, mobile 1, header 1, footer 1, evidence 1, reviewer 3, sweeper 1, escalation 1 (14 desks)
  - QA Rework: batch 4, evidence 1, reviewer 2, escalation 1 (8 desks)
- **Room ids and names:** `build` → "Build" and `qa-rework` → "QA Rework". The existing `lobby` room keeps its id but is displayed as **"Manager's Office"**.
- **Extras, in order:** "Lee Pay Kho", "Kram Evad", then random names from `NAMES` in `server/claude-ingest.mjs`.
- **The standby activity text is exactly "Standby".**
- **Leads go back to the Manager's Office** after `LEAD_HOME_MS = 5 * 60_000` with no activity.
- **Untagged or unknown-tag spawns** behave exactly as today.
- **Tag display:** the tag is stripped from any activity or text shown.
- **Push nothing to GitHub.** Commit locally on `main`.

## Review Focus

1. **Two sessions with the same skill at once.** The second session's agent of a busy role gets Lee Pay Kho, and nobody is double-booked. Pinned by the `parallel sessions use extras` test in Task 2.
2. **A spawn whose `SubagentStop` never arrives** (the session is killed). The employee must not stay away forever. They go home when the lead's session ends (`SessionEnd`) or after the stale window. Pinned by the `session end sends staff home` test in Task 2.
3. **Server restart or `/reset`.** Staff come back at their home desks on standby. Pinned by a test in Task 1.
4. **A tagged spawn arriving before the session has touched a site.** The employee walks to wherever the lead is, which may be the Manager's Office. Covered by the `staff follow the lead's room` test in Task 2.
5. **Old helpers without tags** still appear and leave as before. Covered by the existing `claude-ingest` tests, which stay green.

---

### Task 0: Capture real payloads (no code)

- [ ] Temporarily add `log(JSON.stringify(body).slice(0, 600))` in the `/hooks/claude` route.
- [ ] Run a throwaway floor on port 4399 with `AGENT_FLOOR_URL` pointed at it. Collect `PreToolUse`, `PostToolUse` (tool `Agent`) and `SubagentStop` payloads from one real background Agent call made in a Claude session.
- [ ] Record in the ledger which field holds:
  - the new agent's id in the `PostToolUse` result
  - `agent_id` on `SubagentStop`
- [ ] Remove the log line.
- **Ruling if a field is missing:** link the employee to the first `agent_id` whose tool calls arrive after the spawn with the same `agent_type`, in spawn order.
- Paste only field names into the ledger. No values.

### Task 1: Roster, staff events, protocol flag, Manager's Office

**Files:**
- Create: `server/staff.json`, `server/staff.mjs`
- Modify:
  - `shared/protocol.js`: `normalizeEvent` keeps `staff: true`, `ensureAgent` stores it, and `sweep` never removes `staff` agents
  - `shared/protocol.d.ts`
  - `server/index.mjs`: on start and after every reset, ingest `staffEvents()`, and add the two staff rooms to the `rooms` event, alongside the site rooms
  - `server/claude-ingest.mjs`: `LOBBY = { id: 'lobby', name: "Manager's Office" }`
- Test: `test/staff.test.mjs`

**Interfaces:**
- Produces, in `server/staff.mjs`:
  - `loadRoster(): Roster`
  - `Roster = { rooms: { id, name, roles: { tag, label, desks }[] }[] }`
  - `staffId(roomId, tag, n): string`, giving e.g. `'staff:build:reviewer:2'`
  - `staffEvents(roster): InboundEvent[]`: one `join` per desk with `staff: true`, `team: { id, name }`, `role: label`, `status: 'idle'`, `activity: 'Standby'`, and a fixed name chosen from `NAMES` by a hash of the staff id
  - `STAFF_ROOMS`: `{ id, name }[]`

- [ ] **Step 1: Write the failing tests** (`node --test test/staff.test.mjs`):
  - `roster has 14 Build and 8 QA Rework desks`
  - `staff events join every desk on standby with stable names`: names are the same across two calls, and none is "Mark Dave", "Lee Pay Kho" or "Kram Evad"
  - `sweep never removes staff`: with `ts` 3 hours old, the agent is still present
  - `server start shows staff and the two rooms; reset brings them back`: use `startServer` on port 0, check `/state`, POST `/reset`, check again
  - `the lobby room is named Manager's Office`
- [ ] **Step 2:** Run the tests. Expected: they FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: all tests PASS.
- [ ] **Step 5:** Commit with the message "Staff: Build and QA Rework rooms with standby employees; Lobby becomes Manager's Office".

### Task 2: Ingest maps tagged agents onto employees and extras

**Files:**
- Modify: `server/claude-ingest.mjs`, using the roster from Task 1
- Test: `test/claude-ingest.test.mjs`

**Interfaces:**
- Consumes: `loadRoster`, `staffId` from Task 1.
- Produces:
  - `parseTag(description): { room: 'build' | 'qa-rework', tag: string, rest: string } | null`, exported
  - `createClaudeIngest(...)` returns a function with a `.tick(now)` method that returns events (lead-home moves and stale-staff returns). `server/index.mjs` calls it every 2 s next to the sweeper.

**Behaviour:**
1. **Tagged spawn (`PreToolUse` of `Agent`/`Task`):**
   - Drop the adapter's helper `join` for that spawn.
   - Pick the first free employee of that tag. A free employee is home and not assigned.
   - If none is free, use the next extra.
   - Emit `status` for that agent with:
     - `team` = the session's current room
     - `parent` = lead
     - `status: 'working'`
     - `activity: rest`
   - Remember `tool_use_id → employee`.
2. **Spawn `PostToolUse`:** link the new agent id (from Task 0's field) to the employee. Do not mark the employee done.
3. **Payload with `agent_id` linked to an employee:** re-target the adapter's events to the employee id. If the employee is home, first emit a move to the session's room.
4. **`SubagentStop` with a linked `agent_id`:**
   - an employee goes back to the home room with `status: 'idle'` and `activity: 'Standby'`, and `parent` cleared (set `parent` to `''` and treat empty as none in the protocol)
   - an extra gets `leave`
5. **`SessionEnd`:** all employees assigned to that session go home, and its extras leave.
6. **`tick(now)`:**
   - a lead with no event for `LEAD_HOME_MS` moves to the Manager's Office
   - an employee away for more than 2 hours with no event goes home
7. **Tags are stripped** from every activity and text.

- [ ] **Step 1: Write the failing tests:**
  - `parseTag reads the room, the tag and the rest`
  - `untagged spawns stay ordinary helpers`
  - `a tagged spawn moves the first free employee to the session room, working`
  - `the employee goes home on SubagentStop and shows Standby`
  - `subagent tool calls show on the employee`
  - `parallel sessions use extras: Lee Pay Kho, then Kram Evad, then a random name`
  - `session end sends staff home and extras out`
  - `staff follow the lead's room`
  - `tick moves an idle lead to the Manager's Office after 5 minutes`
  - `a resumed agent's tool calls bring the same employee back`
- [ ] **Step 2:** Run the tests. Expected: they FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: all tests PASS, including the existing ingest tests.
- [ ] **Step 5:** Commit with the message "Staff: role-tagged agents wake their employee; extras for parallel sites".

### Task 3: Walk between rooms, and the standby look

**Files:**
- Modify:
  - `src/world/World.ts`: when an agent's team changes and both rooms exist, walk instead of `dropAgent`
  - `src/world/Character.ts`: a `transfer(path, seat)` that walks a path, then sits
  - `src/world/layout.ts`: `transferPath(from: RoomLayout, fromSeat: Seat, to: RoomLayout, toSeat: Seat): [number, number][]`, in the *destination* room's local frame
- Test: `test/idle.test.mjs`

**Interfaces:**
- Produces: `transferPath` (exported).

**Behaviour:**
- The walk goes from the desk, out of the old room's door, along the corridor (world z = 0) and in through the new room's door to the new seat.
- The character is re-parented to the new room's floor at the start of the walk, with its world position kept.
- Staff do not take idle breaks: `wander()` skips agents with `staff`.
- Standby employees show the normal idle look. The "Standby" activity text comes from the server.

- [ ] **Step 1: Write the failing test**
  - `transferPath leaves through the old door, walks the corridor and ends on the new seat`
  - Assert the first point is next to the old seat, a point lies at world z ≈ 0 near each door, and the last point equals the new seat in destination-local coordinates.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Visual check** on a throwaway floor (port 4399). Post a simulated session:
  1. the skill is invoked and the session touches a site
  2. it makes a `[build:section]` spawn and a `[build:reviewer]` spawn (`PreToolUse` and `PostToolUse`)
  3. one tool call is made inside each agent
  4. then `SubagentStop`

  Expected in the browser pane:
  - two Build-room employees walk the corridor into the site room and work
  - after `SubagentStop`, they walk back and show Standby
  - a second session's section spawn while all 3 are busy shows Lee Pay Kho walking in from the entrance
- [ ] **Step 6:** Commit with the message "Staff: employees walk between their room and the client's room".

### Task 4: Role tags in both skills

**Files:**
- Back up first, to `~/.claude/skill-updates/2026-11-12/`: `~/.claude/skills/figma-to-elementor-build/SKILL.md` and `~/.claude/skills/figma-to-elementor-qa-rework/SKILL.md`.
- Modify both "Models and helper agents" tables to add a **Tag** column with the tags from the Global Constraints.
- Add one sentence under each table: "Start every helper's `description` with its tag, e.g. `[build:reviewer] Review hero section`. The office uses it to show the right employee."
- Leave everything else as it is.

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2:** Run `python3 ~/.claude/skills/task-observer/scripts/validate-skill-bundle.py` on each skill, if it exists. Expected: no errors.
- [ ] **Step 3:** Check with `grep -c '\[build:' ...build/SKILL.md` (expect 10 or more) and `grep -c '\[qa:' ...qa-rework/SKILL.md` (expect 4 or more).
- [ ] No git commit: the skills are not in the repo. Record the backup path in the ledger.

### Task 5: README and the real office

- [ ] **README:** one paragraph on the staff rooms, the tags, the extras and the Manager's Office.
- [ ] Run `npm run build`, then restart the live floor with `node bin/agent-floor.mjs stop` then `start`, which lifts the pause.
- [ ] Check `/state`: 22 staff on standby, plus the Build, QA Rework and Manager's Office rooms.
- [ ] Commit with the message "Docs: staff rooms".
