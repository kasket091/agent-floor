# Digital Recipe Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent Floor office look like Digital Recipe's office: a logo wall at the front desk, purple and lilac rooms, and brand fonts and controls. The office still reads as a warm office.

**Architecture:**
- **Task 1:** one new module, `src/world/brand.ts`, holds the brand values and the room-colour rules. It replaces the hue-based `teamColor`/`teamAccent` everywhere.
- **Task 2:** the 3D pieces (logo wall, reception desk, lobby, shirts, accents) read from `brand.ts`.
- **Task 3:** the page chrome (fonts, CSS variables, top-left brand, title, favicon) is switched.

**Tech Stack:** TypeScript, three.js, Vite, Node 22 `node --test`, which runs `.ts` by type stripping, as `test/protocol.test.mjs` already does.

**Spec:** `docs/superpowers/specs/2026-11-12-digital-recipe-brand-design.md`. Read it first.

## Global Constraints

- **Brand colours:**
  - primary purple `#5A15A0`
  - ink `#140524`
  - amber `#FCB80D`
  - lilac `#C5A8E3`
  - pale lilac `#EBE0F6`
  - white `#FFFFFF`
- **Amber appears only** on the reception desk top and primary buttons. It is never on rooms, lamps, the "Live" dot or anything status-like.
- **`STATUS_COLORS` in `src/world/palette.ts` is unchanged.** "Needs you" stays `#f5a524`.
- **Room colours** are 8 purple and lilac shades only. The `lobby` team has a fixed pale lilac. `team.hue` stays in `shared/protocol.js`, but the client stops reading it for colour.
- **The branding is permanent.** No theme switch. Light and dark modes both stay and are both branded.
- **No runtime network fetches.** The logo, favicon and fonts live in the repo.
- **New dependencies:** only `@fontsource-variable/montserrat@^5.3.0` and `@fontsource-variable/inter@^5.3.0`.
- **The logo is the white wordmark SVG, never recoloured.** It is 247×40 and has 20 paths, all `fill="white"`. Source: `.superpowers/brainstorm/86142-1794434721/content/logo.svg`, a copy of `https://digitalrecipe.com.au/wp-content/uploads/2025/06/Logo-1.svg`.
- **Favicon:** the site's "DR" mark, from `https://digitalrecipe.com.au/wp-content/uploads/2026/10/cropped-DR_Fav_Colour-1-192x192.png` (192×192 PNG, transparent). A copy is at `/private/tmp/claude-501/drsite/fav192.png`. If that copy is missing, download it once from the URL.
- **After every task:** `npm run typecheck`, `npm test` and `npm run build` pass.
- **Push nothing.** Commit to `main` locally only.

## Review Focus

1. **Many rooms (9 or more).** Shades wrap around, rooms still render, and no shade is amber-like. Pinned by the `wraps after 8` and `never amber` tests in Task 1.
2. **Dark mode.** Carpets made from the purple shades must not go muddy-black, and the lobby must stay legible. Check in the dark-mode screenshots in Tasks 2 and 3.
3. **The logo wall before the SVG has loaded.** The canvas texture must update once the image arrives, not stay blank. Task 2 sets `texture.needsUpdate` in the image `onload`, and the screenshot check confirms it.
4. **Light-mode top bar.** The white wordmark sits on a purple chip and must be visible on white glass. Checked by screenshot in Task 3.
5. **A room created before the Lobby** (site rooms pinned at start-up). Room colour goes by `team.order`, so the first site room gets the strongest shade. Pinned by the `order 0 gets primary purple` test in Task 1.

---

### Task 1: Brand module and room colours

**Files:**
- Create: `src/world/brand.ts`
- Modify: `src/world/palette.ts`. Remove `teamColor` and `teamAccent`, and set `ROLE_SHIRT.lead` to `BRAND.purple`.
- Modify: `src/world/TeamRoom.ts`, `src/ui/hud.ts`, `src/world/World.ts`. Use the new functions everywhere `teamAccent(…hue)` and `teamColor(…hue…)` are called today: TeamRoom lines ~175, 217, 218, 232, 287; `hud.ts` ~218; `World.ts` ~442.
- Test: `test/brand.test.mjs`

**Interfaces:**
- Produces:
  - `BRAND: { purple: '#5A15A0', ink: '#140524', amber: '#FCB80D', lilac: '#C5A8E3', paleLilac: '#EBE0F6', white: '#FFFFFF' }`
  - `ROOM_SHADES: readonly string[]` (length 8)
  - `LOBBY_SHADE: string`
  - `roomAccent(team: { id: string; order: number }): Color`
  - `roomCarpet(team: { id: string; order: number }, theme: ThemeName): Color`
  - all from `src/world/brand.ts`
- `World.ts` courier fallback colour: `BRAND.purple`.

- [ ] **Step 1: Write the failing tests** in `test/brand.test.mjs`. Import from `../src/world/brand.ts`, and import `STATUS_COLORS` from `../src/world/palette.ts`.

```js
test('order 0 gets primary purple and shades wrap after 8', () => {
  assert.equal(roomAccent({ id: 'a', order: 0 }).getHexString(), '5a15a0');
  assert.equal(ROOM_SHADES.length, 8);
  assert.equal(roomAccent({ id: 'x', order: 9 }).getHexString(), roomAccent({ id: 'y', order: 1 }).getHexString());
});
test('the lobby has its fixed pale lilac whatever its order', () => {
  assert.equal(roomAccent({ id: 'lobby', order: 0 }).getStyle(), roomAccent({ id: 'lobby', order: 5 }).getStyle());
  assert.equal(roomAccent({ id: 'lobby', order: 0 }).getHexString(), new Color(LOBBY_SHADE).getHexString());
});
test('room shades are purple or lilac, never amber-like, and the first four differ clearly', () => {
  // hue in degrees from Color.getHSL; purple/lilac live roughly 255-300
  for (const s of ROOM_SHADES) { const h = new Color(s).getHSL({}).h * 360; assert.ok(h >= 250 && h <= 305, `${s} hue ${h}`); }
  const hsl = ROOM_SHADES.slice(0, 4).map((s) => new Color(s).getHSL({}));
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const dl = Math.abs(hsl[i].l - hsl[j].l), dh = Math.abs(hsl[i].h - hsl[j].h) * 360;
    assert.ok(dl >= 0.12 || dh >= 15, `shades ${i} and ${j} are too close`);
  }
});
test('status colours are untouched', () => {
  assert.equal(STATUS_COLORS.waiting, '#f5a524');
});
test('carpets stay light in light mode and dark but not black in dark mode', () => {
  for (let o = 0; o < 8; o++) {
    assert.ok(roomCarpet({ id: 't', order: o }, 'light').getHSL({}).l >= 0.65);
    const l = roomCarpet({ id: 't', order: o }, 'dark').getHSL({}).l;
    assert.ok(l >= 0.12 && l <= 0.3);
  }
});
```

- [ ] **Step 2:** Run `node --test test/brand.test.mjs`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `brand.ts`.**
  - `ROOM_SHADES` starts with `#5A15A0`. Pick the rest so the first four alternate deep and light: purple, lilac `#C5A8E3`, deep purple, mid lilac, and so on, all hues 250–305°.
  - `LOBBY_SHADE` is pale lilac, a little deeper than `#EBE0F6` so its rug is visible, e.g. `#D9C8EE`.
  - `roomCarpet` keeps each shade's hue. Set lightness to `PALETTES[theme].carpetLightness`, but clamp it to 0.12–0.3 in dark mode so the carpet isn't black. Set saturation to `carpetSaturation`.
  - Swap all call sites over.
- [ ] **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS, 84 plus the new brand tests.
- [ ] **Step 5:** Commit: `git add src/world/brand.ts src/world/palette.ts src/world/TeamRoom.ts src/ui/hud.ts src/world/World.ts test/brand.test.mjs`, message "Brand: purple and lilac room colours, fixed lobby lilac, purple leads".

### Task 2: Branded lobby and 3D accents

**Files:**
- Create: `public/brand/dr-wordmark.svg`, an exact copy of the logo SVG
- Modify: `src/world/textures.ts`. Change `logoMaterial`, and change the `#ff5f2e` stroke at ~207 to `BRAND.purple`.
- Modify: `src/world/Building.ts`. The logo wall at ~359–360:
  - The wall box changes from `M.wood()` to a matte material in `BRAND.purple`.
  - Lobby pendants at ~377 change from `'#ff5f2e'` to `BRAND.purple`.
  - Games-room pendants at ~502 change to `BRAND.lilac`.
  - Lobby lilac pieces go in per the spec: rug and floor accent, plus lilac accent panels next to the reception. Do not split the shared wall runs.
- Modify: `src/world/props.ts` `receptionDesk`:
  - front body (`M.white()` at ~511 and `M.offWhite()` at ~514) becomes purple
  - the top (`M.wood()` at ~513) becomes amber `BRAND.amber`
  - the trim strip at ~512 becomes `BRAND.lilac`
- Modify: `src/world/Character.ts`. The selection ring (~189) and the headset mic dot (~238) become `BRAND.purple`.
- Modify: `src/world/Screen.ts` ~171. The accent bar becomes `BRAND.purple`.

**Interfaces:**
- Consumes: `BRAND` from Task 1.
- Produces: `logoMaterial()` keeps its name and signature, and returns a material whose canvas holds the white wordmark.

- [ ] **Step 1: Implement `logoMaterial()`.**
  - Keep a 1024×256 transparent canvas.
  - Load `/brand/dr-wordmark.svg` into an `Image`.
  - On `onload`, draw it centred at about 84% of the canvas width with the aspect ratio kept, then set `texture.needsUpdate = true`.
  - Until it loads, the canvas stays transparent, so the purple panel shows.
- [ ] **Step 2: Apply the colour changes listed under Files.** There are no unit tests for 3D meshes. Verification is visual.
- [ ] **Step 3:** Run `npm run typecheck && npm test && npm run build`. Expected: all pass.
- [ ] **Step 4: Visual check.**
  - Start a throwaway floor: `AGENT_FLOOR_HOME=<tmp> AGENT_FLOOR_CLAUDE_CONFIG=<tmp>/none.json AGENT_FLOOR_AUTOLAUNCH=0 node bin/agent-floor.mjs start --port 4399`.
  - Post 3 teams, one of them `lobby`, with a lead each.
  - Screenshot the lobby in the browser pane in light and dark modes.
  - Expected:
    - the white wordmark is sharp on the purple wall
    - the purple front desk has an amber top
    - the lobby rug is lilac
    - no orange is left in the lobby
  - Stop the floor with `POST /shutdown`.
- [ ] **Step 5:** Commit: `git add public/brand src/world` and the message "Brand: Digital Recipe logo wall, purple and amber reception, purple accents".

### Task 3: Fonts, controls, top-left brand, title and favicon

**Files:**
- Modify: `package.json` and `package-lock.json`. Run `npm install @fontsource-variable/montserrat@^5.3.0 @fontsource-variable/inter@^5.3.0`.
- Modify: `src/main.ts`:
  - import both fonts the way Geist is imported, and drop the Geist sans import (keep Geist Mono)
  - the `document.fonts.load` line loads `Inter Variable` and `Montserrat Variable` instead of `Geist Variable`
- Modify: `src/world/text.ts`. `UI_FONT = '"Inter Variable", system-ui, sans-serif'`.
- Modify: `src/styles.css`:
  - `--accent: #5A15A0`
  - `--accent-ink: #ffffff`
  - the body font is `'Inter Variable'`
  - headings, `.brand-name`, sheet titles and the legend's team names use `'Montserrat Variable'`
  - primary call-to-action buttons may use amber `#FCB80D` with ink `#140524` text
  - the "Live" dot stays green
  - add `.brand-logo`: a purple chip (`#5A15A0`, about 6px × 10px padding, radius matching `.brand`) holding the wordmark `img` at about 18px tall
- Modify: `src/ui/hud.ts` ~116. The brand markup becomes `<span class="brand-logo"><img src="/brand/dr-wordmark.svg" alt="Digital Recipe" height="18"></span>`, with no `.mark` and no "Agent Floor" text. Remove the now-unused `.mark` CSS.
- Modify: `index.html`. `<title>Digital Recipe · Agent Floor</title>`, and the icon links to `/brand/dr-favicon.png` (192×192 PNG copied from the site's favicon).
- Create: `public/brand/dr-favicon.png`

**Interfaces:**
- Consumes: `public/brand/dr-wordmark.svg` from Task 2.

- [ ] **Step 1: Make the changes listed under Files.**
- [ ] **Step 2:** Run `npm run typecheck && npm test && npm run build`. Expected: all pass. `dist/` contains the Inter and Montserrat woff2 files and `brand/dr-favicon.png`.
- [ ] **Step 3: Visual check** with the same throwaway floor as Task 2, in light and dark modes. Expected:
  - the top-left shows the white wordmark on a purple chip, readable in both themes
  - the HUD's accents are purple
  - text is in Inter, and headings and room names are in Montserrat
  - the tab title reads "Digital Recipe · Agent Floor" with the DR icon
  - the needs-you tag is still `#f5a524`
  - nothing is fetched from outside localhost (check `read_network_requests`)
- [ ] **Step 4: README.** Add one paragraph under the "Claude Code names" note saying the fork is branded for Digital Recipe, with the brand values in `src/world/brand.ts`.
- [ ] **Step 5:** Commit: `git add package.json package-lock.json src index.html public/brand README.md` and the message "Brand: Inter and Montserrat, purple controls, Digital Recipe top bar, title and favicon".
