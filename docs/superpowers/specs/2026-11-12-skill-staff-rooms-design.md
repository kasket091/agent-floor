# Skill staff rooms: a standing team for each Figma-to-Elementor skill

## Intent

Mark Dave runs two Claude Code skills that send out helper agents:
- **figma-to-elementor-build**, which builds a page from Figma
- **figma-to-elementor-qa-rework**, which fixes items from a QA sheet

Today those helpers appear out of nowhere in the client's room and vanish when they're done. He wants the office to show them as a **standing team**.

Each skill gets its own room, staffed with one employee per agent role. Between jobs they sit at their desks **on standby, waiting for his input**. When a job runs, the real agent the skill sends out **is** the matching employee:
1. they get up, walk to the client's (site) room and work there
2. when their part is done, they walk back to their desk and go back on standby

At a glance, the team can see who is on which client and who is free.

## Decisions made with Mark Dave

- **Two new permanent rooms:** **Build** (figma-to-elementor-build) and **QA Rework** (figma-to-elementor-qa-rework). They are always shown, like pinned site rooms.
- **One employee per agent role in the skill.** Each sits at a desk in the skill's room, in standby status when idle.
- **Real agents become the matching employee.** A real agent from that skill takes over its role's standby employee, who walks to the **site room** where the job is happening, works there, and walks back home when done. They do not walk out of the building.
- **The lead (Mark Dave's session)** works in the site room, as today. Between jobs, leads sit in the room currently called "Lobby", which is **renamed "Manager's Office"**. The building's entrance with the reception desk and logo wall is unaffected.
- **Parallel sites:** if a role is already busy on another site, an **extra person** does the second job.
  - The first extra is named **Lee Pay Kho**, the second **Kram Evad**.
  - Any further extras get random first names from the existing list. Mark Dave said this may be adjusted later.
  - Extras come in from the entrance, work in the site room, and leave the building when done. They have no home desk.

## The rosters (Claude's call, from the skills as of 2026-11-12)

The rosters are written into a small config file in this repo, not parsed from the skills at runtime. The skills' agent tables are prose and keep changing, and parsing them would break silently. When the skills change, the roster file is updated by hand. Mark Dave can ask Claude to do it.

**Build** (14 desks):

| Role | Desks | Matched by |
|---|---|---|
| Section helper | 3 | brief `section-helper-brief.md` |
| Laptop breakpoint, Tablet breakpoint, Mobile breakpoint | 1 each | brief `breakpoint-brief.md`, plus "laptop", "tablet" or "mobile" in the description or prompt |
| Header agent, Footer agent | 1 each | brief `header-footer.md`, plus "header" or "footer" |
| Evidence runner | 1 | model `haiku` while the session is in the build skill |
| Reviewer | 3 | brief `final-review-brief.md` |
| Sweeper | 1 | `final-review-brief.md`, plus "sweep" |
| Escalation specialist | 1 | brief `escalation-brief.md` or model `fable`, while the session is in the build skill |

**QA Rework** (8 desks):

| Role | Desks | Matched by |
|---|---|---|
| Batch agent | 4 | brief `batch-brief.md` |
| Evidence runner | 1 | brief `shot-downloader-brief.md`, or model `haiku`, while the session is in the QA skill |
| Reviewer | 2 | brief `review-brief.md` |
| Escalation specialist | 1 | brief `escalation-brief.md` or model `fable`, while the session is in the QA skill |

## How a real agent is matched to a role

All matching happens on Mark Dave's machine in the office server, from data the Claude Code hooks already send. It uses no tokens.

- **The session's current skill:** when a session calls the `Skill` tool with `figma-to-elementor-build` or `figma-to-elementor-qa-rework`, the ingest remembers that skill for the session. It forgets it on `SessionEnd` or when another skill is invoked.
- **A spawn:** the `Agent`/`Task` tool's `PreToolUse` input carries `description`, `prompt`, `subagent_type` and `model`. The roster's "matched by" rules are checked against those fields in order:
  1. brief file name
  2. keyword
  3. model plus current skill
- **The first free employee** of that role in that skill's room takes the job.
  - If none is free, an extra is used: Lee Pay Kho, then Kram Evad, then random names.
  - A spawn that matches no role keeps today's behaviour: an ordinary helper in the site room.
- **A finished agent**, signalled by the spawn's `PostToolUse`, sends its employee back home to standby. Extras leave the building.
- **Tool calls made inside the agent**, which carry `agent_id`, show on the employee's desk while they work.
- **Text from prompts is only used for matching.** It is never stored or shown, so the existing secret masking is not weakened.

## Calls made after the builder check (Claude's, not Mark Dave's)

- **Most specific role first.** Sweeper is checked before Reviewer, the named breakpoint and header/footer roles before anything generic, and the model-based roles last.
- **Start and finish of an agent.** Helpers in Mark Dave's Claude app run in the background, so the spawn's `PostToolUse` fires at launch, not at the end. That launch result carries the new agent's id.
  - An employee is assigned at the spawn's `PreToolUse` and linked to that agent id from the `PostToolUse` result.
  - The employee walks home at that agent's `SubagentStop`.
  - Tool calls carrying that `agent_id` show on the employee's desk.
- **Resumed agents.** QA batch agents are resumed between triage and fix. A resumed agent's tool calls carry the same `agent_id`, so the same employee walks back to the site and works. Between turns they wait at home on standby.
- **The session's current skill** changes only when one of the two figma skills is invoked, and it is cleared at `SessionEnd`. Other skills (task-observer, superpowers) never change it. Once a session has invoked qa-rework, it stays QA even if it also loads the build skill, because the QA skill names build as required background.
- **The lead goes back to the Manager's Office** after 5 minutes with no activity. It walks to the site room again on its next site tool call. The time is a single constant, easy to change.
- **Prompts are cut to 2,000 characters** before the server sees them, and the skills paste brief text rather than naming the file. So matching cannot rely on the brief's file name appearing in the prompt.

## Role tags (Mark Dave, after the builder check)

Matching uses a **role tag at the start of each agent's `description`**, added to both skills. The brief-name, keyword and model "matched by" columns in the rosters above are replaced by these tags.

| Skill | Tags |
|---|---|
| Build | `[build:section]`, `[build:laptop]`, `[build:tablet]`, `[build:mobile]`, `[build:header]`, `[build:footer]`, `[build:evidence]`, `[build:reviewer]`, `[build:sweeper]`, `[build:escalation]` |
| QA Rework | `[qa:batch]`, `[qa:evidence]`, `[qa:reviewer]`, `[qa:escalation]` |

- **The tag decides both the room and the role**, so the session's "current skill" is not needed for matching. It is still worth keeping as a fallback for an untagged `haiku` or `fable` helper in a figma skill session.
- **An untagged or unknown tag** is an ordinary helper, as today.
- **The tag is stripped from the text shown in the office.** "[build:reviewer] Review hero section" shows as "Review hero section".
- **Skill edits:**
  - Each skill's "Models and helper agents" table gets a Tag column, plus one sentence: every helper's description starts with its tag.
  - `qa-rework` uses the build skill's escalation brief, but tags it `[qa:escalation]`.
  - Both skills are backed up first, as on 2026-11-11, and validated with `task-observer/scripts/validate-skill-bundle.py` if present.
  - No other skill behaviour changes.

## What the office shows

- **Build and QA Rework rooms:**
  - each room's name is on its door and in the bottom legend
  - room colours come from the existing purple and lilac brand shades
  - employees sit at their desks with status "Standby" (a calm, non-busy look, never the amber "Needs you")
  - each employee's name tag shows their name and role, e.g. "Leo · Reviewer"
  - names are fixed per desk from the existing first-name list, so the same person is always the Build room's tablet breakpoint agent
- **Walking between rooms:** an employee who changes room walks from their desk, out of their room's door, along the corridor, through the site room's door, to a desk there, and back the same way. Today an agent who changes room disappears and re-enters from the street, and that stays the behaviour only for agents who aren't staff.
- **The site room:** working employees sit at desks in the site room next to the lead, as helpers do today.
- **"Who is working" panel:** busy employees are listed as now. Standby employees are not busy.
- **Meeting room briefings:** when a lead sends out staff, the briefing gathers them as today, with each employee walking from wherever they are.

## Constraints

- **Zero tokens.** Matching uses only hook payloads already received. There are no new network calls.
- **Claude's hook speed is unchanged.** The extra work is in the office server, not in the hook command.
- **Staff never age out.** They are never swept away as stale, even after hours idle, and they survive server restarts and `reset`. They come back exactly as configured.
- **Site rooms, names, idle breaks, briefings, the "Who is working" panel and the branding all keep working.** Idle breaks are for leads only, so staff do not wander.
- **The roster file is plain JSON.** It sits next to the server code and holds per room an id, a display name, and roles. Each role has a name, a desk count and its matching rules.
- **Push nothing to GitHub** until Mark Dave approves.

## Anti-goals

- Staff who disappear or walk out between jobs. They are always home on standby.
- A wrong person lighting up: a reviewer's desk activating for a section helper. When unsure, fall back to an ordinary helper, not a guess.
- Breaking the existing behaviour for sessions that are not running these skills.
- Any token cost or network fetch.

## Left to the builder

- The exact desk layout inside the two rooms. Room width already grows with desk count.
- What the "Standby" look is: an existing idle look with a label, or a subtle variant.
- The server-side data model for staff, e.g. pinned agents with a `staff` flag and a home room.
- How the walk between rooms is routed and timed. Brisk, like briefings, so a hand-off takes under about 10 seconds.
- Where the Build and QA Rework rooms sit in the room order, as long as they are always present.

## Done means

- With no job running, the office shows the Manager's Office, Build (14 staff on standby) and QA Rework (8 staff on standby), plus any site rooms.
- In a test office, a simulated build session works like this:
  - the session invokes the build skill and touches a site
  - it spawns a section-helper agent and a reviewer
  - the Build room's Section helper and Reviewer walk to the site room and work
  - when the spawns finish, they walk back and show Standby
- A second simultaneous session spawning a section helper while all 3 are busy gets **Lee Pay Kho**.
- `npm run typecheck`, `npm test` and `npm run build` pass.
- Nothing is pushed until he says so.
