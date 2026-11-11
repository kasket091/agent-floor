# Digital Recipe branding for Agent Floor

## Intent

Mark Dave runs this fork for the Digital Recipe team, and the team will watch it together. When they look at it, they should see **Digital Recipe's office**, not a generic "Agent Floor" app. The brand should show through colour and the logo at the front desk, while the 3D world still reads as a warm, real office.

Source of truth for the brand: https://digitalrecipe.com.au/ (read 2026-11-12).

## Decisions made with Mark Dave

- **Direction B, "brand accents".** Brand colours go on the details. The building stays a light, warm office with wood floors, plants, kitchen and lounge. Rejected: logo wall only (too little), and full dark-purple building (too dark, changes the feel).
- **The logo sits on the wall behind the front desk** in the lobby, replacing the Agent Floor logo there.
- **Room colours come from the brand family only**: shades of purple and lilac, with no other hues. Amber was dropped after the builder check (see below). Mark Dave accepted that some shades get close once there are more than four or five rooms. Room names on doors and in the legend tell rooms apart.
- **Amber stays off rooms, lamps and status-like spots** (Mark Dave, after the builder check). Brand amber `#FCB80D` is nearly the "Needs you" status amber `#f5a524`, which the team must read at a glance. So:
  - room colours are purple and lilac shades only
  - lamps do not lean amber
  - the "Live" dot stays green
  - amber appears only on the reception desk top and primary buttons
  - `STATUS_COLORS` stays unchanged
- **The branding is permanent.** It replaces the current look, with no theme switch. Light and dark modes both stay, and both are branded.

## Brand values (from the website's Elementor globals)

| Name | Hex | Role on the site |
|---|---|---|
| Primary purple | `#5A15A0` | primary |
| Ink | `#140524` | text |
| Amber | `#FCB80D` | secondary (buttons) |
| Lilac | `#C5A8E3` | accent |
| Pale lilac | `#EBE0F6` | soft backgrounds |
| White | `#FFFFFF` | |

Fonts: **Montserrat** for headings, **Inter** for text.

Logo: `https://digitalrecipe.com.au/wp-content/uploads/2025/06/Logo-1.svg` is a 247×40 SVG of the "DigitalRecipe" wordmark, all white, made for dark or purple backgrounds. Copy it into the repo. Never hot-link it.

## What changes

1. **Lobby logo wall** (`Building.ts`, the "Logo wall" block): the wooden wall panel becomes a primary-purple panel, and the canvas logo (`logoMaterial` in `textures.ts`) becomes the white Digital Recipe wordmark, sharp and centred with comfortable margins. The clock beside it stays.
2. **Reception desk** (`receptionDesk` in `props.ts`): the front body becomes primary purple, the top becomes amber, and the orange trim strip becomes amber or lilac. Builder's choice: whatever reads well in both themes.
3. **Lobby walls**: pale lilac in light mode, a deep purple-ink tone in dark mode. Lobby only. The rest of the building keeps its neutral walls.
4. **Room colours**: replace hue-based team colours (`teamColor` and `teamAccent` in `palette.ts`, fed by `team.hue`) with an ordered list of 8 purple and lilac shades, chosen per team by the team's `order`, like the hue is today. Use them for:
   - carpets (lightened in light mode, darkened in dark mode, as `carpetLightness` does now)
   - rugs, lamps, door signs and whiteboards
   - legend swatches
   - the selection colour in `World.ts`

   Text drawn on a room colour (door signs, legend) must stay readable: dark ink on light shades, white on dark shades.
5. **People**: lead shirts are primary purple (today `ROLE_SHIRT.lead` is orange). Helper shirts stay varied, so roles stay distinguishable.
6. **Light accents**: lamps keep their current warm white. No amber tint and no neon glow.
7. **On-screen controls** (`styles.css`, `hud.ts`):
   - `--accent` becomes primary purple.
   - Buttons that are amber on the site (primary call-to-action style) may use amber with ink text.
   - Headings use Montserrat and body text uses Inter. Bundle both locally with `@fontsource` packages, like Geist is today.
   - Canvas text in the 3D world (`UI_FONT` in `text.ts`) uses Inter.
8. **Name**: the top-left brand reads **"Digital Recipe"** with the logo mark, instead of "Agent Floor" with its four-square mark. The page `<title>` becomes "Digital Recipe · Agent Floor". The favicon becomes a Digital Recipe mark: use the site's favicon if it is a clean square, otherwise a purple square with a white "DR". Help text that says "Agent Floor" can stay, since it describes the tool.
9. **Status colours** (`STATUS_COLORS`: thinking, working, needs-you, done, error) **stay as they are.** They are information, not branding, and the team must read them at a glance.

## Constraints

- No network fetches at runtime. The logo, fonts and favicon all live in the repo, and the office works offline.
- No new runtime dependencies beyond the two `@fontsource` font packages.
- Both themes must work, and both the light and dark versions must look intentional.
- Keep everything that works now working: site rooms, names, idle breaks and the whiteboard.
- Run `npm run typecheck`, `npm test` and `npm run build`, all passing.

## Anti-goals

- A purple building: dark purple floors and walls everywhere, which is option C and was rejected.
- Neon or glow effects for the sake of looking "techy".
- Losing readability: low-contrast door signs, status colours that blend into brand purple, or text in Montserrat at small sizes where Inter reads better.
- A settings toggle or theme switcher. The branding is permanent.

## Calls made after the builder check (Claude's, not Mark Dave's)

- **Top-left brand**: show the official white wordmark on a small primary-purple chip, with no extra "Digital Recipe" text beside it, because the wordmark already says it. The wordmark is never recoloured. On the logo wall it is white on purple too.
- **Lobby walls**: recolour only the pieces the lobby owns (logo-wall panel, reception surround, lobby rug or floor accent). If the shared north, south or west wall runs can be split at the lobby boundary cheaply, paint the lobby part lilac. Otherwise use lilac accent panels on those walls. Do not restructure the building's wall code just for this.
- **The "Lobby" team room** (the room every Claude session starts in) gets a fixed pale-lilac colour outside the order list, so site rooms start the brand list from its first, strongest shade.
- **Selection ring and courier**: the agent selection ring (fixed orange in `Character.ts`) and the message courier colour (`World.ts`) both become primary purple. `team.hue` stays in the protocol, because tests and other adapters use it. The client just stops using it for colour.
- **Favicon**: not yet checked against the site. Use the site's favicon if it is a clean square SVG or PNG, otherwise a purple square with a white "DR".

## Left to the builder

- The exact 8 purple and lilac shades and their order. Start with primary purple, then lilac, then a deep purple, then a mid lilac, and so on, so the first few rooms differ the most.
- Exact lilac and dark-mode tones for the lobby walls.
- Whether the HUD uses amber anywhere beyond primary buttons. Never on anything that looks like a status.

## Done means

- Mark Dave sees, in the browser pane, the lobby with the Digital Recipe logo wall and the purple and amber front desk, in light and dark modes.
- Rooms show brand shades with readable labels.
- The top bar and tab read "Digital Recipe".
- Typecheck, tests and build all pass.
- Nothing has been pushed until he says so.
