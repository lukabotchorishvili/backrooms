# THE FLOOR IS LYING — Game Design & Expansion Guide

> **This is the source of truth for the game.** It describes what is actually implemented (every
> code reference below exists) and how to extend it. Keep it current — see
> [Continuous documentation rule](#continuous-documentation-rule).

Current version: **0.1.2** · Last updated: 2026-11-09

---

## Table of contents

1. [Game vision and identity](#1-game-vision-and-identity)
2. [Core gameplay loop](#2-core-gameplay-loop)
3. [Game mechanics](#3-game-mechanics)
4. [World and stage structure](#4-world-and-stage-structure)
5. [Room design principles](#5-room-design-principles)
6. [Anomaly design principles](#6-anomaly-design-principles)
7. [Behavior tracking system](#7-behavior-tracking-system)
8. [Adaptive intelligence system](#8-adaptive-intelligence-system)
9. [Difficulty system](#9-difficulty-system)
10. [Progression system](#10-progression-system)
11. [Ending architecture](#11-ending-architecture)
12. [Audio and visual direction](#12-audio-and-visual-direction)
13. [Technical architecture](#13-technical-architecture)
14. [Content registration instructions](#14-content-registration-instructions)
15. [How to create a new anomaly](#15-how-to-create-a-new-anomaly)
16. [How to create a new room](#16-how-to-create-a-new-room)
17. [How to create a new stage](#17-how-to-create-a-new-stage)
18. [How to create a new difficulty](#18-how-to-create-a-new-difficulty)
19. [How to add new endings](#19-how-to-add-new-endings)
20. [How to add new interactions](#20-how-to-add-new-interactions)
21. [Save data and migration rules](#21-save-data-and-migration-rules)
22. [Performance guidelines](#22-performance-guidelines)
23. [Testing guidelines](#23-testing-guidelines)
24. [Known limitations](#24-known-limitations)
25. [Future development roadmap](#25-future-development-roadmap)
26. [Implemented features](#26-implemented-features)
27. [Planned features](#27-planned-features)
28. [Technical decisions and their reasoning](#28-technical-decisions-and-their-reasoning)
29. [Changelog](#29-changelog)

---

## 1. Game vision and identity

**THE FLOOR IS LYING** is a first-person psychological horror game about inspecting an abandoned
corporate floor that changes according to how you behave.

- **Premise.** You wake at your desk on Floor 14 of the Haldane Strata Group. *EMPLOYEE STATUS:
  ACTIVE. SHIFT: 09:00–17:00. EXIT STATUS: UNAVAILABLE.* The reception terminal will not grant
  elevator access until you complete a floor inspection: find and report five genuine irregularities.
- **Antagonist.** The building itself. It observes your habits (doors, dark rooms, revisits,
  rushing, inspecting everything) and reacts with targeted, deterministic changes — no AI service.
- **Tone.** Liminal late-90s/early-2000s office: beige walls, worn carpet, fluorescent hum,
  CRT monitors, glass partitions. Familiar but wrong. Psychological tension over jumpscares.
- **Fairness pillar.** *You must never feel safe, but it must always be fair.* Every anomaly has a
  discoverable clue; an anomaly you have witnessed is never withdrawn; nothing can make the game
  impossible; there is no death state.

## 2. Core gameplay loop

```
explore ─▶ notice (look / inspect / listen / watch feeds) ─▶ note is logged in the notebook
   ▲                                                                   │
   │                                                                   ▼
the building adapts ◀── behaviour profile ◀── report at reception terminal (room · description · category)
   │                                                                   │
   └── attention rises (false reports, repetition, sprinting, overtime) ◀── rejected
                                                                       ▼ confirmed ×5
                                         request elevator access ─▶ take the elevator ─▶ ending A / B / C
```

A first playthrough on EMPLOYEE takes roughly 15–25 minutes. The completability simulation
(`systems/completability.spec.ts`) averages 5–30 simulated minutes depending on persona.

## 3. Game mechanics

| Mechanic | Implementation | Notes |
|---|---|---|
| First-person movement | `engine/camera-controller.ts` (`PlayerController`) | Walk 2.35 m/s, sprint 4.3 m/s, smoothed accel/decel, head bob, footsteps by floor type. |
| Collision | `engine/collision-manager.ts` (`CollisionWorld`) | Capsule reduced to a circle (r = 0.3 m) vs oriented boxes on the floor plane, sub-stepped (no tunnelling). |
| Interaction | `GameEngine.updateInteraction()` | Center ray, 2.4 m interact range, prompt `[E] Verb · Target`. Doors are handled in-engine; everything else goes to `GameSessionService.interact()`. |
| Gaze | same | Looking at an interactable for ≥ 1 s emits `object-gaze` (once per 8 s per object). |
| Notebook (evidence) | `InvestigationService` | Inspecting logs a factual note. Notes of the same prop are re-logged only when the description changed — comparing old and new notes *is* evidence. Decoys and mundane props produce notes too. |
| Clue modes | `AnomalyClue.mode` | `inspect`, `sight`, `presence`, `hearing`, `feed` (see §6). |
| Reporting | `investigation-terminal` UI → `GameSessionService.submitReport()` → `scoreReport()` | Room (visited rooms only) → notebook entry → category. Outcomes: confirmed / rejected / mismatch / duplicate / invalid. |
| BUILDING ATTENTION | `AttentionSystemService` | 0–100, LOW/MEDIUM/HIGH/CRITICAL; CRITICAL = 40 s escalation then recovery to 62 with a 75 s grace period. Not health. |
| Calming / risky interactions | `interaction.kind: 'relief' / 'hazard'` | Coffee machine (−10), badge reader (−6); fire alarm (+8), restricted cabinet (+6). Disabled during escalation. |
| Memory rooms | `MemoryRoomService` | Baseline snapshot on first entry, diff on return; visit counts drive `room-exit` / `room-return` triggers. |
| Security room | `engine/security-camera-system.ts` | 4 live feeds (render targets), delayed/replayed player ghost, camera-only reality layer, monitor view with A/D. |
| Flashlight | `LightingManager.flashlight` | Spot light with projected cookie; shadows on High; F toggles. |
| Shift clock | `shiftClock()` in `systems/text-tokens.ts` | 09:00→17:00 over `difficulty.shiftDurationMin`; after 17:00 *overtime* slowly raises attention. Wall clocks show shift time. |
| Pickups / hidden route | `interaction.kind: 'pickup'` + flags | Maintenance memo (dark archive corner, `memo-found`) + service key (storage hook 3, `service-key`) → Ending C. |
| Elevator | `engine/world/elevator.ts` | Locked until access is granted; call → floors count up → doors open → step in → ending. |
| Restart without reload | `GameSessionService.restart()` | Disposes the engine and boots a fresh run on the same canvas. |

## 4. World and stage structure

A **stage** is one floor (`StageDefinition`, `models/stage.model.ts`). The MVP ships one stage:
`floor-14` (`content/stages/floor-14/`). Coordinates are metres: **+X east, +Y up, +Z north**.

```
 z=31  +---------+---------+--------+--------+
       | MANAGER | BREAK   | ARCHIVE| STORAGE|        +--------+
 z=23  +----d----+----d----+---d----+---d----+--------|SECURITY|
       |            EMPLOYEE CORRIDOR          d       |        |
 z=20  +-------d-----------------+------d------+       | x14-20 |
       |      OPEN-PLAN OFFICE    d CONFERENCE  |       | z14-26 |
 z=10  +-------------+----d------+------d------+       +--------+
                     |RECEPTION  d ELEV. LOBBY |[car]
 z=0                 +-----------+-------------+
       x=-18        -6    0      6            14
```

| Room id | Name | Identity / landmark |
|---|---|---|
| `reception` | Reception | Terrazzo, reception desk with the **inspection terminal**, locked fogged front doors, company logo, floor directory. Hub. |
| `elevator-lobby` | Elevator lobby | Two elevators ("14" sign), call panel; working car behind the east wall (`extraBounds`). Visible from reception through glass doors. |
| `open-plan` | Open-plan office | 12 cubicles, your desk (warm coffee, nameplate 4471), copier, water cooler, windows with blinds. Spawn point. |
| `conference` | Conference room | Long table, 8 chairs, speakerphone, whiteboard ("REDUCE EXITS"), wall clock. |
| `employee-corridor` | Employee corridor | 32 m spine, doors to 5 rooms, posters, evacuation map, PA speaker, emergency exit at the west end (movable end wall + hidden extension). |
| `manager-office` | Manager's office | Wood panelling, curtains, portrait with closed eyes, nameplate, ficus. |
| `break-room` | Break room | Checker linoleum, coffee machine (relief), microwave display, fridge note, vending machine. |
| `archive` | Archive | **Dark** (darkness 0.8). Shelving rows, restricted cabinet (hazard), memo in the dark corner. |
| `storage` | Storage room | Dim bulb, steel shelving, janitor's closet (locked… usually), service key on hook 3. |
| `security` | Security room | Monitor bank (4 feeds), server rack, night-shift logbook. |

Stage-level data: 11 doors (`floor-14.stage.ts`), 4 security cameras, the elevator definition,
spawn, objectives text, intro/terminal text, music ids, anomaly/decoy/response/ending id lists.

**Conventions** (`content/stages/stage-helpers.ts`):

- A prop's **front is local −Z**. `rotationY`: 0 = faces south, 90 = west, 180 = north, 270 = east.
- `wallProp(id, type, roomRect, side, along, y)` mounts a prop on the inside of a wall.
- Floor props: origin = footprint centre. Wall-hugging furniture (filing cabinet, counter, fridge,
  shelves…) is **back-anchored**: origin on its back face. Surface props (computer, mug, memo…):
  origin = bottom centre at the surface height (desk 0.75, counter 0.91, reception counter 1.08).
- Stable ids everywhere. Doors also create prop ids `sign-<doorId>` (nameplate) and gaze ids
  `door-<doorId>`.

## 5. Room design principles

1. **One identity per room** — material set (`surfaces`), light tone, ambience loop and one
   landmark prop. Players must recognise a room from a single screenshot.
2. **≤ 4 lights per room.** Room lights only light that room's meshes (`includedOnlyMeshes`);
   with the flashlight and ambient fill this fits `MAX_LIGHTS = 6` per material.
3. **Navigation over confusion.** Rooms hang off the corridor or reception; signs over doors,
   an evacuation map (`wall-map` draws the real floor plan with "YOU ARE HERE"), exit signs.
4. **Darkness is a parameter** (`ambience.darkness`). ≥ 0.5 counts as a "dark area" for behaviour
   tracking and uses the dim ambient fill. Never make a room unnavigable without the flashlight
   *except* hidden-content corners.
5. **Dense, factual inspectables** — 3–8 per room, notes written as observations. Include
   "pre-existing conditions" that sound odd but are baseline (e.g. the slow reception clock) so
   reporting needs judgement.
6. **Leave room for anomalies** — hidden props (`hidden: true`), movable end walls (`openSides`),
   wall openings filled by props (`openings`), camera-only props (`cameraOnly: true`).

## 6. Anomaly design principles

An anomaly (`AnomalyDefinition`, `models/anomaly.model.ts`) is **data**; its world effects are
implemented by registered **effect handlers** (`engine/anomalies/effect-handlers.ts`).

**Fairness rules (enforced by code + validation):**

- Every anomaly has a clue with a non-empty factual `observation` (validator error otherwise).
- `inspect`/`sight` clues must target an existing (interactable for `inspect`) prop.
- `hearing` clues require a sound-producing effect; `feed` clues require a camera.
- Changes only happen when unobserved (`MIN_UNSEEN_FOR_CHANGE`, room-occupancy checks, line-of-sight raycasts).
- Two anomalies never touch the same prop, light set, ceiling, feed, door or `exclusiveGroup` at once.
- At most `maxPerRoom` anomalies in play per room.
- **Witnessed anomalies are never withdrawn.** Reported ones are "corrected by Facilities" once unobserved.
- A confirmed anomaly never returns in the same run (counts once).

**Clue modes:** `inspect` (press E on the target), `sight` (look at the target ≥ dwell),
`presence` (be in the room ≥ dwell × difficulty multiplier), `hearing` (be within radius when it
sounds), `feed` (watch the camera in the security view ≥ 1.5 s). Inspecting an anomaly's
`targetPropId` also witnesses non-feed anomalies (e.g. inspect the ringing speakerphone).

**Triggers:** `immediate` (not while you are in the room unless `allowObserved`), `room-exit`,
`room-return` (when you approach again from an adjacent room), `unobserved` (target unseen ≥ N s),
`event` (after N occurrences of a game event).

**Ratings:** 1 = obvious … 5 = extremely subtle. Difficulties allow/weight ratings.

**Tags** feed adaptive responses: `door`, `dark`, `revisit`, `slow-down`, `unobserved`,
`misleading`, `subtle`, `audio`, `camera`.

**Writing clue text:** state what is observed, never "this is an anomaly". Good:
*"Wall clock. The second hand sweeps counter-clockwise."* Bad: *"The clock is haunted."*

**Catalogue:** 36 anomalies on Floor 14 (`content/anomalies/floor-14.anomalies.ts`):
12 visual, 6 spatial, 6 temporal, 6 audio, 6 behavioural; 8 always-eligible fallbacks.
11 decoys (`floor-14.decoys.ts`): ventilation, pipes, monitor standby, copier, routine PA, drips…

**Effect types (17):** `transform-prop`, `hide-prop`, `show-prop`, `swap-variant`, `set-text`,
`clock`, `light-color`, `light-pattern`, `door-state`, `room-revert`, `ceiling-height`, `sound`,
`footstep-echo`, `announcement`, `room-silence`, `security-feed`. Texts support tokens:
`{employee} {doorCount} {inspections} {mostVisitedRoom} {mostVisitedCount} {lastRoom} {time}
{firstVisit:<roomId>} {behaviorMessage}` (`systems/text-tokens.ts`).

## 7. Behavior tracking system

`BehaviorTrackingService` (`systems/behavior-tracking.service.ts`) records **meaningful events
only** (room enter/exit, door use, inspections, gazes, interactions, flashlight, sprint starts,
reports, witnessed anomalies) plus per-frame *aggregated* movement samples (time moving/sprinting/
still, yaw turned while slow, time in dark areas, flashlight time). No raw input is stored.

Normalisation (`systems/behavior/behavior-profile.ts`, `saturate(x, k) = x / (x + k)`):

| Normalised | Formula |
|---|---|
| doorFrequency | saturate((doorInteractions + 1.5·lockedAttempts) / minutes, 1.6) |
| inspectionRate | saturate(inspections / minutes, 2) |
| objectCoverage | uniqueInspections / inspectable props |
| revisitRatio | saturate(roomRevisits / uniqueRooms, 2) |
| backtrackRate | saturate(A→B→A returns / minutes, 0.6) |
| sprintRatio / slowMoveRatio / stillRatio | time ratios |
| lookAroundRate | saturate(degrees turned while slow / 360 / minutes, 3) |
| darkAvoidance | (1 − clamp(darkRatio / 0.12)) × confidence(after 2 min) |
| reportAccuracy | (correct + 1) / (reports + 2) |
| witnessRate | saturate(witnessed / minutes, 0.4) |

Tendencies (independent 0..1 scores × confidence = clamp(totalTime / 90 s); dominant ≥ 0.55):

```
curious      = 0.45·inspectionRate + 0.35·objectCoverage + 0.20·interactionRate
cautious     = 0.30·slowMove·(1−sprint) + 0.45·lookAround + 0.25·clamp(still·2.5)
rusher       = 0.62·sprintRatio + 0.38·(1 − inspectionRate)
repetitive   = 0.65·revisitRatio + 0.35·backtrackRate
avoidant     = 0.8·darkAvoidance + 0.2·darkAvoidance·(1 − clamp(flashlight·4))
observant    = 0.55·accuracy(evidence-weighted) + 0.45·witnessRate
door-checker = 0.78·doorFrequency + 0.22·saturate(lockedAttempts, 3)
```

Lifetime metrics and the last 10 dominant-tendency sets are persisted (`SaveData.behavior`).

## 8. Adaptive intelligence system

`AnomalyDirectorService` (`systems/anomaly-director.service.ts`) is deterministic for a seed
(`SeededRandom`, mulberry32; `?seed=1234` in the URL reproduces a run).

**Scheduling (ticked at 4 Hz by the session):**
- `initialSelections` picks at run start; then one selection every
  `evaluationIntervalSec × attentionLevel.anomalyIntervalMultiplier` while slots are open
  (`maxSimultaneous` pending+fresh; also capped when ≥ remaining+2 witnessed are unreported).
- Starvation guard: nothing to find for 12 s ⇒ select now.
- Pending anomalies activate when their trigger holds; after 150 s they return to the pool.
- Unwitnessed active anomalies may expire after `unwitnessedLifetimeSec` (only when unobserved).
- Decoys play at `decoys.perMinute × responses × (1 + 0.15·attentionLevel)` in or next to your room.

**Selection weight** (`weightOf`):

```
w = weight × ratingWeights[rating]
  × Π (1 + adaptationStrength · score[t] · tendencyWeights[t])      // per-anomaly adaptivity
  × Π (1 + (tagMultiplier − 1) · adaptationStrength)                 // active behaviour responses
  × spatialWeight(attention level)        (spatial only)
  × 0.5 if same category as the last activation
  × 0.55 if same room as one of the last two
  × 0.4 if it already happened this run (repeatable)
```

If the weighted pool is empty the director falls back to `stage.fallbackAnomalyIds` (validated to
be immediate with no visit/door requirement). The completability simulation proves every
difficulty × persona × seed reaches 5 confirmations.

**Behaviour responses** (`content/behavior/behavior-responses.ts`) are data:

| Response | Tendency (threshold) | Effect |
|---|---|---|
| doors-noticed | door-checker (0.5) | `door` anomalies ×2.6 (misleading door signs, opened doors, extra doorways) |
| dark-invitation | avoidant (0.55) | `dark` anomalies ×2.4, dark-room decoy sounds ×2.5 |
| familiar-rooms | repetitive (0.5) | `revisit` anomalies ×2.4 |
| slow-down | rusher (0.5) | `slow-down` ×2.8, `misleading` ×1.8 |
| decoys-for-the-curious | curious (0.55) | `unobserved` ×1.9, decoy rate ×1.7 |
| behind-you | cautious (0.55) | `audio` ×1.6, `slow-down` ×1.4 |
| subtle-for-observant | observant (0.6) | `subtle` ×1.8 |

Responses also provide `{behaviorMessage}` lines shown on monitors and the terminal's SYSTEM NOTE.

## 9. Difficulty system

All difficulty numbers live in `DifficultyConfig` objects (`content/difficulties/difficulties.ts`);
no code branches on a difficulty id.

| Field | OBSERVER (easy) | EMPLOYEE (normal) | THE BUILDING KNOWS (hard) |
|---|---|---|---|
| maxSimultaneous / initial | 2 / 2 | 3 / 2 | 4 / 2 |
| evaluationIntervalSec | 40 | 32 | 26 |
| allowed ratings | 1–3 | 1–4 | 2–5 |
| subtlety | 0.1 | 0.45 | 0.85 |
| adaptationStrength | 0.6 | 1.0 | 1.6 |
| unwitnessedLifetimeSec / maxPerRoom | 420 / 1 | 300 / 2 | 220 / 2 |
| decoys per minute | 0.5 | 0.9 | 1.6 |
| audio clue volume / hearing radius | 1.25 / 1.3 | 1 / 1 | 0.8 / 0.8 |
| witness hint (HUD) / dwell multiplier | yes / 0.7 | no / 1 | no / 1.4 |
| attention gain / false-report penalty | 0.6 / 12 | 1.0 / 16 | 1.4 / 20 |
| category mismatch penalty / correct relief | 0 / 10 | 6 / 8 | 10 / 6 |
| category tolerance | any | accepted | primary |
| shift duration (real minutes) | 35 | 25 | 18 |

## 10. Progression system

`ProgressionService` (`systems/progression.service.ts`):

`find-terminal` → (terminal opened) `investigate` → (confirmed ≥ `requiredReports`)
`request-access` → (terminal button) `take-elevator` → (ending starts) `complete`.

Flags: `terminal-used`, `investigation-complete`, `access-granted`, `memo-found`,
`service-key` (+ any `pickup`/`hazard` flag in content). The **ending is locked in when the
elevator is called** (`pendingEndingId`), so the car interior matches it.

Attention summary: false report +penalty; category mismatch +penalty; correct report −relief;
4 toggles of one door in 8 s +3; 7 flashlight toggles in 6 s +2; pressing the locked call button
repeatedly +2; re-inspecting a witnessed anomaly > 4 times +1.5; sprinting and overtime per
second; passive decay below HIGH.

## 11. Ending architecture

Endings are `EndingDefinition` data (`content/endings/endings.ts`); `resolveEnding()` picks the
highest-priority ending for the trigger (`elevator-standard` or `elevator-service`) whose
conditions all hold. The engine plays the configured sequence (`GameEngine.updateEnding()`):
wait → close doors → ride (indicator sequence, shake, flicker, ride sound) → optional destination
reveal → fade → epilogue screen.

| Ending | Trigger / conditions | Sequence |
|---|---|---|
| **A — NORMAL EXIT** | standard; investigation complete | Standard car, 14→G, "THANK YOU FOR COMPLETING YOUR SHIFT." |
| **B — THE BUILDING REMEMBERS** | standard; attention ≥ 55 **or** ≥ 1 escalation (priority 10) | Car interior dressed as a reception replica, indicator stuck on 14, flicker, PA chime. |
| **C — THE WRONG EXIT** | service; memo-found + service-key (priority 20) | Descends 14→−∞, doors open on an endless office (thin-instanced desks/lights in fog), 14 s walkable reveal. |

Extension points: interiors (`Elevator.setInterior` + `buildInteriors`, id union
`ElevatorInteriorId`) and destinations (`DESTINATIONS` registry in `engine/endings/destinations.ts`,
id union `EndingDestinationId`).

## 12. Audio and visual direction

**Visual.** Procedural everything — no external assets:
- Surface textures are rendered pixel by pixel (tileable value noise, fbm) with matching normal
  maps: carpets, terrazzo, linoleum, concrete, paints with floor grime and ceiling yellowing,
  wood panelling, cinder block, ceiling tiles with water stains (`engine/materials/surface-pixels.ts`).
- Canvas-drawn art: paintings (incl. anomaly variants), posters, monitors (CRT phosphor + scanlines),
  signs, nameplates, calendars, evacuation map, clock faces (`procedural-textures.ts`, `world/text-surface.ts`).
- Lighting: per-room fluorescent point lights (cool/neutral/warm/sickly tones, calibrated by
  `LIGHT_GAIN = 1.45`), constant-flicker tubes, hemispheric fill with a floor-bounce ground colour,
  ceiling self-illumination, flashlight with a projected cookie.
- Post-processing (`render-manager.ts`): ACES tone mapping, exposure 1.3, bloom (Medium+), FXAA,
  animated grain, vignette, desaturating colour curves (teal shadows, warm highlights), chromatic
  aberration; SSAO2 + MSAA ×4 + flashlight shadows on High. Attention raises grain/CA/vignette and fog.
- UI: dark, typographic, never "dashboard"; Bahnschrift (Windows) / Consolas; CRT terminal; paper
  notebook; corridor menu backdrop drawn on a 2D canvas; logo with a floor reflection that sometimes
  reads "IS LISTENING".

**Audio.** 100% procedural (`systems/audio/audio-synth.ts`, 57 recipes) → WAV blob URLs → Howler.js
(`AudioManagerService`). Categories: ambient (room tone loops per room), effects (footsteps,
doors, terminal, elevator, horror one-shots, decoys), music (menu theme, ambient/tension beds,
ending). Volumes: master/ambient/effects/music. Positional sounds use HRTF panning (Z mirrored:
Babylon is left-handed, Web Audio right-handed). PA announcements use the Web Speech API with
subtitles (optional; falls back to subtitles + chime). Autoplay is handled by Howler's unlock on
the first gesture. Silence is a tool: the `room-silence` anomaly removes the hum entirely.

## 13. Technical architecture

```
Angular shell (zoneless, standalone, client-rendered routes)
  app.routes.ts ── '' MainMenu (lazy) ── 'play' GamePage (lazy)
  features/*  (menus, HUD, terminal, notebook, settings, endings)  ── read signals only
        │
        ▼
GameSessionService  (systems/game-session.service.ts)   implements EngineHost
  ├─ systems: BehaviorTracking · AnomalyDirector · Attention · Investigation · MemoryRoom ·
  │           Progression · SaveManager · Settings · AudioManager      (pure TS, unit-tested)
  ├─ content: CONTENT registry + validator
  ├─ workers: ProceduralPool ──▶ procedural.worker.ts (textures + audio off the main thread)
  └─ import('../engine/game-engine') ─▶ GameEngine implements GameEngineApi   (lazy chunk)
           RenderManager · PlayerController · InputManager · CollisionWorld · LightingManager ·
           WorldBuilder · ObjectFactory/PropKit · PropRegistry · DoorSystem · Elevator ·
           RoomCuller · SecurityCameraSystem · effect handlers · destinations
```

- **Contract**: `engine/engine-api.ts` has no Babylon/Angular imports. The engine emits
  `GameEvent`s and per-frame `FrameSample`s; the session drives systems and calls back
  `applyAnomaly`, `revertAnomaly`, `playDecoy`, `setAttention`, `callElevator`, `beginEnding`…
- **Stage lifecycle** (`GameSessionService.boot()`): load config → validate (`validateStage` with
  the engine's registered effect types) → init systems (new or restored) → generate audio +
  textures in workers while the engine builds geometry → register/restore anomalies → render →
  "click to wake up" → intro → gameplay → completion → ending → dispose (`teardown()`).
- **Frame order** (`GameEngine.frame()`): intro → player/security view → room tracking → keys →
  interaction ray → doors/elevator/ending → prop animation, clocks, fake doors → effect updates →
  visibility timers → ambient events → culler → lighting → security feeds → listener →
  `host.simulate()`.
- **Rendering cost control**: per-room lights, per-room instancing templates, merged static
  geometry, frozen static matrices, portal culling, one security feed per frame.
- **SSR**: the project's SSR setup is kept, but every route is `RenderMode.Client`
  (`app.routes.server.ts`) — a WebGL/WebAudio game has nothing to prerender.
- **Disposal**: `GameEngine.dispose()` releases input listeners, render targets, lights, props,
  materials/textures, the scene and the engine; the session stops all audio; the worker pool is
  terminated after loading.
- **Dev hook** (development builds only): `window.__tfil` → `lock()`, `teleport(x, z, yaw, pitch)`,
  `look()`, `press(code)`, `hold(code, ms)`, `step(n)` (render frames synchronously), `state()`,
  `stats()`, plus `session`, `scene`, `props`, `doors`, `lighting`.

## 14. Content registration instructions

All content goes through `ContentRegistry` (`content/content-registry.ts`). Ids are unique per
collection (duplicate registration throws). `createDefaultContentRegistry()` registers the built-in
content; `CONTENT` is the app-wide instance.

```ts
export function createDefaultContentRegistry(): ContentRegistry {
  const registry = new ContentRegistry();
  registry.difficulties.registerAll(DIFFICULTIES);
  registry.endings.registerAll(ENDINGS);
  registry.behaviorResponses.registerAll(BEHAVIOR_RESPONSES);
  registry.anomalies.registerAll(FLOOR_14_ANOMALIES);
  registry.decoys.registerAll(FLOOR_14_DECOYS);
  registry.sounds.registerAll(SOUND_LIBRARY);
  registry.stages.register(FLOOR_14);
  return registry;
}
```

Validation (`content/content-validator.ts`) runs at every game start (errors stop the boot with a
readable message on the error screen; warnings are logged) and in unit tests
(`content-validator.spec.ts`). It checks: unique ids, room/prop/door geometry, doors on walls,
reachability from the hub, spawn, terminal, elevator, cameras, anomaly references (rooms, props,
lights, doors, cameras, sounds), clue rules, fallback rules, pool size per difficulty, endings.

## 15. How to create a new anomaly

**1. Add the definition** to `content/anomalies/floor-14.anomalies.ts` (any of the category
arrays — the exported `FLOOR_14_ANOMALIES`/`FLOOR_14_ANOMALY_IDS` pick it up, so the stage pool
includes it automatically):

```ts
{
  id: 'cnf-whiteboard-erased',
  name: 'Erased objectives',
  description: 'The conference whiteboard now lists only one objective.',
  category: 'visual',
  acceptedCategories: ['behavioral'],
  difficulty: 2,
  roomId: 'conference',
  targetPropId: 'cnf-whiteboard',
  trigger: { type: 'room-exit', minVisits: 1 },
  conditions: { requiresVisited: true },
  effects: [{ type: 'set-text', propId: 'cnf-whiteboard', text: 'Q3 OBJECTIVES|- RETAIN {employee}' }],
  clue: {
    mode: 'inspect',
    targetPropId: 'cnf-whiteboard',
    subject: 'Whiteboard',
    observation: 'Whiteboard. Everything else is wiped. One line remains: "RETAIN {employee}".',
  },
  cooldownSec: 300,
  repeatable: false,
  tags: ['revisit'],
},
```

**2. Run the tests** — `content-validator.spec.ts` validates it, `completability.spec.ts` keeps the
floor completable.

**3. New effect type?** Extend the union and register a handler:

```ts
// models/anomaly.model.ts — add to AnomalyEffect
| { readonly type: 'prop-tint'; readonly propId: string; readonly color: Rgb }

// engine/anomalies/effect-handlers.ts
registerEffectHandler<'prop-tint'>({
  type: 'prop-tint',
  apply: (ctx, e) => {
    for (const m of ctx.props.get(e.propId)?.built.meshes ?? []) {
      m.overlayColor = new Color3(...e.color); // import { Color3 } from '@babylonjs/core'
      m.renderOverlay = true;
    }
  },
  revert: (ctx, e) => {
    for (const m of ctx.props.get(e.propId)?.built.meshes ?? []) m.renderOverlay = false;
  },
});
```

Optionally add a `case 'prop-tint':` to `validateEffect()` so prop ids are checked. The validator
already fails if a definition uses a type with no registered handler. If the anomaly changes a prop
in a new way, make sure the director's conflict detection sees it (`effectPropIds` reads any
`propId` field automatically).

## 16. How to create a new room

**1. Define the room** in the stage's rooms file (`content/stages/floor-14/floor-14.rooms.ts`):

```ts
export const R_SERVER: Rect = { x0: 20, z0: 14, x1: 26, z1: 20 };

export const ROOM_SERVER: RoomDefinition = {
  id: 'server-room',
  name: 'Server room',
  description: 'Cold air, blinking racks.',
  bounds: R_SERVER,
  height: 3.0,
  surfaces: { floor: 'concrete', walls: 'wall-gray', ceiling: 'ceiling-concrete' },
  lights: [
    { id: 'srv-light-1', position: [23, 3, 17], tone: 'cool', intensity: 0.5, range: 7, fixture: 'strip', flicker: 0.1 },
  ],
  props: [
    { id: 'srv-rack-1', type: 'server-rack', position: [25.4, 0, 16], rotationY: 90,
      interaction: inspect('Server rack', 'Server rack. The fans are louder than they should be.') },
    wallProp('srv-alarm', 'fire-alarm', R_SERVER, 'south', 21, 1.35),
  ],
  ambience: { darkness: 0.45, soundscape: ['amb-electronics'], floorSound: 'hard' },
};
```

Add it to `FLOOR_14_ROOMS`. Rooms must not overlap other rooms' `bounds`.

**2. Connect it** with a door in `floor-14.stage.ts` (`axis: 'x'` = wall at constant X):

```ts
{ id: 'd-sec-server', rooms: ['security', 'server-room'], axis: 'x', at: 20, center: 17,
  width: 1.0, height: 2.2, style: 'metal', initialState: 'closed', sign: 'SERVERS', signRoom: 'security' },
```

The world builder cuts the opening in both rooms' walls, builds frame/leaf/colliders/nameplate,
and the culler treats it as a portal. Add a security camera or anomalies referencing the room if
desired.

**3. New prop type?** Add the id to `PROP_TYPES` (`models/room.model.ts`), write a builder (for
example in `engine/world/props/fixtures.ts`) and register it in `BUILDERS`
(`engine/world/object-factory.ts`) — the table is typed `Record<PropType, PropBuilder>`, so the
compiler refuses a type without a builder:

```ts
export const buildWaterHeater: PropBuilder = (_ctx, k) => {
  k.cyl(0.5, 0.5, 1.4, 'plastic-white', 0, 0, -0.26);      // body (back-anchored)
  k.cyl(0.04, 0.04, 0.6, 'chrome', 0.15, 1.4, -0.26);       // pipe
  k.collider(0, -0.26, 0.52, 0.52);
};
// object-factory.ts BUILDERS: 'water-heater': F.buildWaterHeater,
```

## 17. How to create a new stage

A stage is a `StageDefinition` plus its rooms, anomalies and decoys:

```ts
// content/stages/floor-13/floor-13.stage.ts
export const FLOOR_13: StageDefinition = {
  id: 'floor-13',
  name: 'Floor 13',
  floorLabel: 'FLOOR 13',
  description: 'Accounts. Everything is in triplicate.',
  employeeNumber: '4471',
  companyName: 'HALDANE STRATA GROUP',
  rooms: FLOOR_13_ROOMS,
  doors: FLOOR_13_DOORS,
  securityCameras: [],
  elevator: { lobbyRoomId: 'lobby-13', axis: 'x', at: 14, center: 3, width: 1.3, height: 2.3,
    car: { x0: 14, z0: 1.8, x1: 16.6, z1: 4.2 }, floorLabel: '13',
    callPanelPropId: 'l13-call', carPanelPropId: 'l13-car-panel', indicatorPropId: 'l13-indicator' },
  spawn: { position: [0, 0, 5], yawDeg: 0, pitchDeg: 0 },
  hubRoomId: 'lobby-13',
  terminalPropId: 'l13-terminal',
  requiredReports: 5,
  anomalyIds: FLOOR_13_ANOMALIES.map((a) => a.id),
  fallbackAnomalyIds: ['f13-phone-ring', 'f13-clock-backward'],
  decoyIds: FLOOR_13_DECOYS.map((d) => d.id),
  behaviorResponseIds: BEHAVIOR_RESPONSES.map((r) => r.id),
  endingIds: ['normal-exit', 'building-remembers'],
  objectives: FLOOR_14.objectives,
  intro: FLOOR_14.intro,
  terminal: { ...FLOOR_14.terminal, header: 'HSG FACILITIES — FLOOR 13' },
  music: FLOOR_14.music,
};
```

Register it (and its anomalies/decoys) in `createDefaultContentRegistry()`. Requirements enforced
by validation: the hub contains a `terminal` prop, the elevator car lies inside the lobby's
`extraBounds`, every room is reachable, the pool has ≥ requiredReports + 3 anomalies and enough
per difficulty, fallbacks are immediate.

**Starting a stage:** the session boots `restore?.stageId ?? CONTENT.defaultStageId`
(`GameSessionService.boot()`). Set `registry.defaultStageId = 'floor-13'` to make it the default.
`StageDefinition.nextStageId` is reserved for floor-to-floor transitions (planned, see §27).

## 18. How to create a new difficulty

```ts
// content/difficulties/difficulties.ts
export const DIFFICULTY_NIGHT_SHIFT: DifficultyConfig = {
  ...DIFFICULTY_BUILDING_KNOWS,
  id: 'night-shift',
  name: 'NIGHT SHIFT',
  tier: 'EXTREME',
  description: 'Fewer lights. More lies.',
  order: 3,
  anomalies: { ...DIFFICULTY_BUILDING_KNOWS.anomalies, maxSimultaneous: 5, evaluationIntervalSec: 20 },
  attention: { ...DIFFICULTY_BUILDING_KNOWS.attention, gainMultiplier: 1.8 },
  shiftDurationMin: 14,
};

export const DIFFICULTIES: readonly DifficultyConfig[] = [
  DIFFICULTY_OBSERVER, DIFFICULTY_EMPLOYEE, DIFFICULTY_BUILDING_KNOWS, DIFFICULTY_NIGHT_SHIFT,
];
```

Menus list `CONTENT.sortedDifficulties()` (by `order`) automatically. `validateDifficulty()` and the
stage validator (pool size per difficulty) cover it; add the id to the persona loop in
`completability.spec.ts` to prove it is completable. Saves store the id; unknown ids fall back to
the default on load.

## 19. How to add new endings

```ts
// content/endings/endings.ts
export const ENDING_OVERTIME: EndingDefinition = {
  id: 'overtime',
  code: 'D',
  title: 'OVERTIME',
  trigger: 'elevator-standard',
  priority: 15,
  conditions: [{ type: 'investigation-complete' }, { type: 'flag', flag: 'overtime-worked' }],
  sequence: { ...ENDING_NORMAL_EXIT.sequence, indicatorSequence: ['14', '15', '16', '17'], lightsFlicker: true },
  epilogue: { lines: ['YOUR SHIFT HAS BEEN EXTENDED.'], caption: 'The numbers went up.' },
};
export const ENDINGS = [ENDING_NORMAL_EXIT, ENDING_BUILDING_REMEMBERS, ENDING_WRONG_EXIT, ENDING_OVERTIME];
```

Add its id to the stage's `endingIds`. Conditions available: `investigation-complete`,
`attention-at-least`, `attention-below`, `peak-attention-at-least`, `escalations-at-least`, `flag`,
`any`. New car interiors: extend `ElevatorInteriorId` and build a dressing node in
`Elevator.buildInteriors()`. New destination scenes: extend `EndingDestinationId` and add a
`DestinationBuilder` to `DESTINATIONS` (`engine/endings/destinations.ts`) — it returns
`{ root, carOrigin, meshes, setDoors, clamp, dispose }`. The main menu's ENDINGS record and the
ending screen read the registry, so no UI change is needed.

## 20. How to add new interactions

Most interactions need **no code**: give a prop an `interaction` with an existing kind —
`inspect`, `pickup` (+`flag`, `consumed`), `relief` (−attention, `cooldownSec`), `hazard`
(+attention, optional `flag`), `terminal`, `security-console`, `elevator-call`, `elevator-panel`.
`requiresFlag`/`lockedNote` gate pickups; `verb` overrides the prompt.

```ts
{ id: 'brk-radio', type: 'phone', position: [-1.2, 0.92, 30.5],
  interaction: { kind: 'relief', name: 'Radio', verb: 'Tune', attentionDelta: -4, cooldownSec: 120,
    note: 'Radio. Soft static, then a song you almost remember. The building listens too.' } },
```

A **new kind**: add it to `InteractionKind` (`models/room.model.ts`), handle it in the switch of
`GameSessionService.interact()`, give it a default verb in `DEFAULT_VERBS`
(`engine/game-engine.ts`) and, for context-sensitive prompts, return a verb from
`GameSessionService.promptVerb()` (used for "Turn service key").

**New sound events**: add a `SoundDefinition` to `content/audio/sound-library.ts` and either a URL
source (`{ kind: 'url', urls: ['assets/audio/x.ogg'] }`, file in `public/assets/audio/`) or a
recipe registered in `RECIPES` of `systems/audio/audio-synth.ts`:

```ts
function radioStatic(sr: number): Float32Array {
  const out = buffer(sr, 2.5);
  // …fill `out` with samples in [-1, 1]…
  return finish(out, sr, { peak: 0.6, fadeOut: 0.2 });
}
// RECIPES: 'radio-static': radioStatic,
```

**New behaviour responses / environmental events**: add a `BehaviorResponseDefinition` (tag
multipliers, decoy multipliers, messages) and list its id in the stage; add a `DecoyDefinition`
for a new mundane event (logged when heard, false if reported).

## 21. Save data and migration rules

Storage key `the-floor-is-lying.save` (`SaveManagerService`); corrupt saves are backed up to
`the-floor-is-lying.save.corrupt-backup`. If `localStorage` is unavailable the game uses an
in-memory adapter and the menu says progress will not persist.

```ts
interface SaveData {            // CURRENT_SAVE_VERSION = 2
  version: number; savedAt: string;
  settings: GameSettings; selectedDifficulty: string;
  progress: { activeRun: RunSnapshot | null; completedStages: string[]; unlockedEndings: string[]; tutorialSeen: boolean };
  statistics: PlayerStatistics; behavior: { lifetime: BehaviorMetrics | null; recentDominant: BehaviorTendency[][] };
}
```

`RunSnapshot` (Continue) stores only serialisable state: stage/difficulty/seed, elapsed time,
player transform + flashlight, attention, notebook/reports/confirmed ids, director state (incl.
RNG state), memory baselines, progression, door states, behaviour metrics. On load, applied
anomalies are re-applied instantly; pending selections are dropped (re-selected).

**Rules:**
1. Any change to the persisted shape bumps `CURRENT_SAVE_VERSION` and adds a step to
   `SAVE_MIGRATIONS` (key = version migrated **from**) in `systems/save/save-migrations.ts`.
2. Migrations never throw; `migrateSave()` repairs field by field (`sanitizeSettings`,
   `sanitizeMetrics`, run validation) and reports `recovered`/`issues`.
3. Saves from a newer version keep only sanitised settings.
4. Never store engine objects, functions or Babylon types.
5. Add a test to `save-migrations.spec.ts` for every migration.

Autosave: every 30 s of play, after reports/pickups/elevator events, on pause, on tab hide and
before unload. New Game discards the active run but keeps settings, endings and statistics.

## 22. Performance guidelines

Measured on an Intel Iris Xe laptop (Chrome, 1536×674, Medium): **60 FPS**, 7–10 ms CPU frame,
27–190 draw calls depending on room (≈ 360–420 before culling); security room with feeds active
≈ 1 extra room render per frame. Load ≈ 7 s (was 14 s before the worker pool).

Rules:
- Keep ≤ 4 lights per room; never toggle `setEnabled` on lights during play (changes shader
  defines → recompiles → black frames). Use intensity (the flashlight does).
- Never parent a spot light that uses a `projectionTexture` to a moving node: its projection
  matrix only updates through the light's own `position`/`direction` setters. Move it in world
  space each frame instead (see `LightingManager.syncFlashlight()`).
- Any camera whose `rotation.z` (roll) is non-zero at some point must set
  `updateUpVectorFromRotation = true`. Babylon's `TargetCamera` otherwise re-derives its up vector
  only when roll *changes*, baking in that moment's yaw/pitch — when roll then sits still the
  stale up vector tilts the view as the camera turns (see `PlayerController` constructor).
- Repeated props: use `PropKit.instance()` (per-room templates, GPU instancing).
- Static geometry: merge (`Mesh.MergeMeshes(..., multiMaterial)`); structural meshes get frozen
  world matrices.
- Per-instance canvas textures cost a draw call each — reuse materials where text is identical.
- Security feeds: one render target per frame, room-scoped and frustum-culled lists; only active
  near the security room.
- Procedural generation belongs in the worker pool (`workers/`), not on the main thread.
- Graphics presets: Low (80 % resolution, 256 px textures, no bloom/CA), Medium (native, bloom,
  FXAA, CA), High (SSAO2, MSAA ×4, flashlight shadows, DPR up to 1.5). Post-processing toggle.
- Use Settings → *Performance stats* (FPS, draw calls, meshes, frame ms) while developing.

## 23. Testing guidelines

`npx ng test --watch=false` (Vitest via the Angular unit-test builder) — 16 spec files / 117 tests:

| Spec | Covers |
|---|---|
| `systems/behavior/behavior-profile.spec.ts` | normalisation bounds, each tendency, non-exclusive profiles, tracking events, backtracking |
| `systems/anomaly-director.spec.ts` | eligibility (baseline, ratings, conditions, conflicts, per-room cap), seeded reproducibility, adaptive weighting, anti-repetition, triggers, expiry vs witnessed, correction, fallback, save/restore |
| `systems/completability.spec.ts` | 3 difficulties × 5 personas × 4 seeds always reach 5 confirmations; an ending always resolves; average length |
| `systems/investigation.spec.ts` | scoring outcomes, tolerance per difficulty, alternate rooms, duplicates, notebook dedupe |
| `systems/attention-system.spec.ts` | level mapping, transitions, difficulty scaling, decay/overtime, escalation + recovery + grace |
| `systems/progression.spec.ts` | endings A/B/C, always-resolvable, objective flow |
| `systems/memory-room.spec.ts` | baselines, diffs, noise tolerance, persistence |
| `systems/save/save-migrations.spec.ts` | defaults, v1→v2 migration, corrupt/newer recovery, memory fallback, completion stats |
| `content/content-validator.spec.ts` | built-in content valid + all effect handlers registered; broken definitions reported; difficulty ordering |
| `engine/collision-manager.spec.ts`, `engine/materials/surface-pixels.spec.ts`, `systems/audio/audio-synth.spec.ts`, `systems/text-tokens.spec.ts`, `systems/seeded-random.spec.ts`, `shared/format.spec.ts`, `app.spec.ts` | engine & utility units |

Guidelines: keep game logic in pure services so it is testable without WebGL; use
`testing/fake-world.ts` (a scripted `DirectorWorld`) for director scenarios; any new content must
keep `content-validator.spec.ts` and `completability.spec.ts` green. For in-browser checks use the
dev hook (`window.__tfil.step(n)` avoids background-tab rAF throttling).

## 24. Known limitations

- One stage; no stage-select UI and `nextStageId` transitions are not wired yet.
- Geometry is procedural primitives (boxes/cylinders/planes with procedural textures) — no
  sculpted models, no character animation.
- Security feeds render without the main pipeline's tone mapping (compensated by a dimmer monitor
  emissive) and at reduced resolution.
- Portal culling is a heuristic (open/glass doors, depth 3); windows are not portals.
- PA voice uses the OS speech voices (quality varies; subtitles always shown). Non-PA sounds have no captions.
- Desktop keyboard + mouse only (no gamepad, touch or mobile layout); English only.
- Audio and textures are regenerated every session (~7 s load); no persistent cache.
- Pointer lock re-acquisition needs a click after leaving with Escape (browser rule) — the
  "click to continue" veil handles it.
- Background/occluded browser windows throttle the game loop (browser behaviour).
- The procedural worker requires module-worker support; otherwise generation falls back to the
  main thread (slower load).

## 25. Future development roadmap

1. **Floors** — stage select + `nextStageId` transitions (Ending A continues to Floor 13), per-floor
   anomaly packs, a floor-agnostic terminal.
2. **Content** — more anomalies per room (target 60+), new effect types (prop tint, mirrored room,
   looping corridor segment, NPC silhouettes), more decoys.
3. **Building intelligence** — cross-run memory (use `SaveData.behavior.recentDominant` to open
   runs with counter-strategies), terminal messages that quote your history.
4. **Presentation** — glTF props via `@babylonjs/loaders` (installed), baked lightmaps, captions for
   all sounds, localisation.
5. **Tech** — IndexedDB cache for generated textures/audio, gamepad input, accessibility options.

## 26. Implemented features

- Angular 21 shell (zoneless, standalone, lazy routes), Babylon.js 9 engine in a lazy chunk, Howler.js audio.
- Main menu (Continue, New Game with difficulty picker, Difficulty, Settings, Credits, endings record),
  animated corridor backdrop and logo; pause menu (Resume, Restart, Settings, Main menu); settings
  (sensitivity, invert, FOV, 4 volumes, quality, fullscreen, camera shake, post-processing, perf stats) — persisted.
- Loading screen, error screen (WebGL failure explained), "click to wake up", skippable intro,
  first-session controls tutorial, HUD (objective, shift clock, room, confirmed/false/notes,
  attention meter, prompt, inspection cards, toasts, subtitles, security-view hint, easy-mode witness hint).
- 10 interconnected rooms, 11 doors, ~150 props, 4 security cameras, working elevator, windows, signage.
- First-person controller with collisions, sprint, head bob, footsteps; flashlight with cookie (+shadows on High).
- 36 anomalies (5 categories, 17 effect types), 11 decoys, 8 fallbacks; notebook evidence; CRT reporting terminal.
- Behaviour tracking (7 tendencies), adaptive anomaly director (seeded, weighted, anti-repetition,
  conflict-free, fallback), 7 behaviour responses, memory rooms.
- BUILDING ATTENTION with 4 levels affecting lights, fog, post-FX, drone, ambient events, feeds; CRITICAL escalation with recovery.
- Security monitors: live feeds, delayed/replayed player ghost, camera-only figure, interference.
- 3 endings with distinct sequences (standard car, reception-replica car, descent to an endless floor).
- Versioned save with migrations, Continue, autosave, statistics, behaviour history, memory fallback.
- Procedural audio (57 recipes) and textures, generated in a worker pool.
- 117 unit tests incl. completability simulation; content validation at boot; dev automation hook.

## 27. Planned features

- Floor transitions and additional floors; stage select.
- More anomalies/decoys and new effect types (see §25).
- Captions for all audio events; localisation; gamepad.
- IndexedDB cache for procedural assets; optional glTF props.
- Statistics screen (runs, fastest completion, tendency history).

## 28. Technical decisions and their reasoning

| Decision | Reasoning |
|---|---|
| Engine behind `EngineHost`/`GameEngineApi` with no Babylon types in the contract | Keeps Babylon out of the initial bundle (lazy `import()`), lets all game logic be unit-tested without WebGL. |
| Game logic as plain `@Injectable` services with signals | Fits the zoneless Angular app; UI reads signals; services are constructible with `new` in tests. |
| Notebook-based reporting (pick an observation) | Avoids unreliable free-text matching while still requiring judgement: decoys, mundane notes and genuine anomalies look alike. |
| Deterministic director + seed | Reproducible bugs (`?seed=`), testable fairness, simulation-based completability proof. |
| Custom 2D circle-vs-OBB collision | A single flat floor; simpler, faster and more predictable than mesh collisions; easy to move colliders with anomalies. |
| Per-room lights with `includedOnlyMeshes` | Babylon materials have a light limit; global lights would light every room with the wrong lamps. |
| Portal culling by door state | No occlusion queries needed; doors are natural portals; cut CPU frame time ~2×. |
| Procedural textures/audio (no assets) | Requirement: playable without downloads, no copyright risk; workers keep loading fast. |
| Flashlight toggled by intensity | Enabling/disabling lights recompiles shaders (black flash). |
| Client-only rendering while keeping the SSR setup | Preserve project configuration; a WebGL game has nothing to prerender. |
| Howler with procedural WAV blobs | Required audio library; categories/volumes/spatial panning handled in one manager. |
| Global SCSS partials instead of component styles | Keeps every component under the 4 kB style budget without changing `angular.json` budgets. |
| `allowedCommonJsDependencies: ['howler']` | Howler ships CommonJS only; acknowledged to keep the production build warning-free. |

## 29. Changelog

### 0.1.2 — 2026-11-09
- **Fix: view slowly tilted when looking around while standing still.** Head-bob adds a tiny
  camera roll while walking that drops to exactly 0 when standing. Babylon's `TargetCamera` only
  recomputes its up vector when `rotation.z` changes, using the yaw/pitch of that moment, so after
  stopping the up vector froze and mouse-look rotated the horizon (up to ~17° measured); pressing a
  movement key changed the roll and re-levelled it. `PlayerController` now sets
  `camera.updateUpVectorFromRotation = true` so the up vector is derived from the full rotation
  every frame. Verified: roll stays at 0° while looking around standing still; head-bob unchanged.
- Migration requirements: none.

### 0.1.1 — 2026-11-09
- **Fix: flashlight only lit a fixed region.** The spot light was parented to the camera, and
  Babylon only recomputes a spot light's projection-texture (cookie) matrix when the light's own
  position/direction setters run — so the beam mask stayed frozen where it was first computed and
  most aimed-at surfaces stayed dark (most visible in dark rooms). The flashlight is now unparented
  and placed in world space every frame by `LightingManager.syncFlashlight()`.
- Migration requirements: none.

### 0.1.0 — 2026-11-09 (MVP)
- Initial playable MVP: Floor 14 (10 rooms), 36 anomalies, adaptive director, behaviour tracking,
  attention system, memory rooms, security monitors, notebook + reporting terminal, elevator,
  endings A/B/C, menus/HUD/settings, versioned saves (schema v2, migration from v1 prototype),
  procedural textures & audio, 117 unit tests.
- Playtest fixes: portal culling, merged fixtures/elevator geometry, frozen static matrices
  (≈2× faster CPU frame); worker pool for procedural generation (load 14 s → 7 s); alpha-tested
  materials fixed; lighting recalibrated (brighter fixtures, ceiling bounce); security feed exposure
  and per-frame cost; flashlight no longer causes shader recompiles; archive memo placement; closet
  vignette lighting; decoy note de-duplication; short-viewport main menu; "Turn service key" prompt;
  error-screen Retry keeps the saved shift.
- Migration requirements: none (first release; v1 → v2 migration exists for prototype saves).

---

## Continuous documentation rule

Whenever a change affects architecture, mechanics, content schemas, difficulty settings or
progression:

1. Update the relevant sections of this file (and keep every code example compiling against the real API).
2. Add a changelog entry (§29) with migration requirements, if any.
3. Update the implemented (§26) / planned (§27) feature lists.
4. Bump `CURRENT_SAVE_VERSION` + add a migration and test when the save shape changes (§21).
5. Keep `README.md` in sync (commands, controls, structure).
