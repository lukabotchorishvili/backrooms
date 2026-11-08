# TASK CONTINUATION — "THE FLOOR IS LYING" MVP

> Local hand-off file so the task can be resumed in a fresh Claude Code session without the
> original conversation. Start by reading this whole file, then continue with **§5 Remaining work**.
> Delete this file once the MVP is delivered (it is not part of the game).

Last updated: 2026-11-08 (after unit tests passed; production build was interrupted by the user).

---

## 1. The original request (condensed but complete)

Build — not describe — a polished, playable first-person psychological horror game **THE FLOOR IS
LYING** inside the existing Angular project in this folder. Preserve the existing configuration;
do not rebuild the project. Desktop browsers (Chrome/Edge/Firefox on Windows).

**Stack:** existing Angular (21.2, standalone, zoneless, SSR configured), strict TypeScript,
Babylon.js (`@babylonjs/core`, optional `@babylonjs/loaders`), Howler.js, Angular Signals, RxJS only
where appropriate, SCSS, localStorage. No NgRx. Angular = shell/UI, Babylon = world. Lazy loading.

**Concept:** player wakes in an abandoned corporate office; goal: find the elevator and leave. The
building adapts to the player's behaviour (deterministic behaviour tracking, not random), must feel
fair (every anomaly has a discoverable clue), psychological tension over jumpscares.

**MVP content (15–25 min):** one floor, **10 interconnected rooms** (Reception, Open-plan office,
Conference room, Manager's office, Break room, Storage room, Archive, Employee corridor, Security
room, Elevator lobby), **≥ 25 anomaly configurations**, behaviour tracker, adaptive anomaly director,
investigation/reporting, elevator escape, **≥ 3 endings**, persistent settings/progress, start + pause menus.

**Opening:** black screen → fluorescent light switches on + hum → wake up → messages
"EMPLOYEE STATUS: ACTIVE" / "SHIFT: 09:00–17:00" / "EXIT STATUS: UNAVAILABLE"; skippable; reception
computer says "Please complete your floor inspection before requesting elevator access."

**Loop:** find 5 genuine anomalies, report at reception terminal (room, category, description,
submit/cancel; no full list of anomalies shown). Correct → progress + confirm sound + objective update.
Incorrect → BUILDING ATTENTION up + subtle environmental response + understated warning. After 5 →
request elevator access → elevator → ending.

**Controls:** WASD, mouse look (pointer lock), E interact, Shift sprint, Esc pause, F flashlight.
Smooth accel/decel, capsule collision, no clipping, sensitivity + invert settings, resize/fullscreen,
no movement while menus are open, first-session control tutorial.

**Systems required:** BehaviorTrackingService (door inspections, room time, revisits, gazes,
flashlight, sprint, dark time, interactions, backtracking, false/correct reports; normalised 0..1;
non-exclusive tendencies CURIOUS/CAUTIOUS/RUSHER/REPETITIVE/AVOIDANT/OBSERVANT); adaptive responses
(doors → door anomalies & misleading signs; avoids dark → clues in dark areas; revisits → visited
rooms change; rushing → clues rewarding slowing down; inspects everything → decoys/changes after
leaving) without punishing playstyles; data-driven anomaly model (id, name, description, category,
difficulty, room, triggers, effect config, clue, activation conditions, cooldown, repeatability,
profile requirements, dependencies) + registry/strategy (no giant switch); 5 categories (visual,
spatial, temporal, audio, behavioral); fairness rules (no contradictory anomalies in one room, never
change the answer after inspection); AnomalyDirectorService (weighted, seeded RNG, cooldowns,
anti-repetition, contradiction avoidance, adaptive, fallback, data-driven); Investigation + HUD
(discovered, correct, incorrect, attention meter, objective, evidence indicator, interaction prompt);
BUILDING ATTENTION (LOW/MEDIUM/HIGH/CRITICAL effects, CRITICAL = escalation + restricted optional
interactions + recovery/alternate ending, never an unavoidable death); Memory rooms (baseline on
first entry, compare on return, changes after leaving/looking away/on return/after events, subtle);
Security room (multiple monitors, render targets, delayed/altered feed, feed anomalies, previous
player position); visual direction (late-90s corporate, beige, carpet, fluorescent, no default
materials/cubes/flat lighting; flickering lights, bloom, grain, vignette, grading, chromatic
aberration, toggleable; flashlight with shadows where practical; subtle animation); Audio via
AudioManagerService/Howler (ambient/interaction/horror/player categories, positional, Master/
Ambient/Effects/Music volumes, procedural placeholders OK, never silent, autoplay-safe);
Menus (Continue, New Game, Difficulty, Settings, Credits; pause: Resume, Restart, Settings, Main
menu; settings: sensitivity, 4 volumes, graphics quality, fullscreen, camera shake, post-processing,
invert mouse — all persisted); 3 difficulty presets via `DifficultyConfig` (OBSERVER/EMPLOYEE/
THE BUILDING KNOWS) consumed by the director, no scattered difficulty ifs; Endings: A NORMAL EXIT
("THANK YOU FOR COMPLETING YOUR SHIFT."), B THE BUILDING REMEMBERS (high attention; elevator interior
looks like reception), C THE WRONG EXIT (hidden clue + optional sequence; building larger than
understood) — distinct configurations, expandable; Save system (versioned SaveData {version,
settings, progress, statistics, behavior}, migration, defaults, invalid-save recovery, New Game reset,
Continue, in-memory fallback, only serialisable data).

**Architecture/expansion:** data-driven stages, floors, rooms, anomaly categories, anomalies,
difficulties, endings, behavioural responses, interactions, environmental events, sound events;
stable ids; validation at startup with clear errors; stage lifecycle (load config → validate → build
→ register anomalies → init behaviour → gameplay → completion → ending/transition → dispose);
dispose Babylon resources; no duplicate listeners; restart without reload.

**Documentation (REQUIRED, not yet written):**
- `GAME_DESIGN_AND_EXPANSION.md` at project root — permanent source of truth with these sections:
  1 Game vision and identity · 2 Core gameplay loop · 3 Game mechanics · 4 World and stage structure ·
  5 Room design principles · 6 Anomaly design principles · 7 Behavior tracking system · 8 Adaptive
  intelligence system · 9 Difficulty system · 10 Progression system · 11 Ending architecture ·
  12 Audio and visual direction · 13 Technical architecture · 14 Content registration instructions ·
  15 How to create a new anomaly · 16 How to create a new room · 17 How to create a new stage ·
  18 How to create a new difficulty · 19 How to add new endings · 20 How to add new interactions ·
  21 Save data and migration rules · 22 Performance guidelines · 23 Testing guidelines · 24 Known
  limitations · 25 Future development roadmap · 26 Implemented features · 27 Planned features ·
  28 Technical decisions and their reasoning · 29 Changelog.
  Every extension guide needs a practical TypeScript example matching the ACTUAL code (no imaginary
  APIs). Include the "continuous documentation rule" (update doc + changelog + feature lists +
  migration notes whenever architecture/mechanics/schemas/difficulty/progression change).
- `README.md` (replace the Angular CLI default): description, features, tech stack, prerequisites,
  installation, dev commands, build commands, controls, project structure, documentation links.

**Testing required:** behaviour profiles, anomaly eligibility, difficulty config, weighted selection,
anti-repetition, investigation scoring, attention transitions, save/load, save migration, stage
validation, adaptive behaviour cannot create impossible states, MVP always completable. Performance:
60 FPS target, graceful on weak hardware, no leaks, instancing, Low/Medium/High presets, dev perf monitor.

**Rules:** complete playable game over abstraction; no fake UI; every button works; no paid APIs,
no backend, no copyrighted assets; procedural geometry OK; playable without downloads; typed (avoid
`any`); handle audio restrictions, WebGL failure (error screen), loading screen, resize, restart
without reload; **never claim something works without testing it.**

**Definition of done:** app starts; Babylon initialises; main menu, New Game, Continue, difficulty
selection work; walk/look, collision, sprint, flashlight; 10 explorable rooms; visually polished;
≥25 anomalies; tracker records actions; building adapts; visited rooms change; security monitors
work; reporting with different consequences; attention affects environment; elevator unlocks;
3 endings work; settings + progress persist; pause/restart; audio controls; completable start to
end; unit tests pass; production build succeeds; README.md; GAME_DESIGN_AND_EXPANSION.md accurate.

**Final delivery (concise report to the user):** what was implemented; final project structure;
dependencies installed; start / test / production-build commands; how to play; limitations;
intentionally deferred features; how to add a new stage, a new anomaly, and change difficulty settings.

User preference stated mid-task: keep going; if token limits are hit, pause and continue afterwards.

---

## 2. Environment facts

- Angular 21.2.26 (zoneless, standalone), TS ~5.9 strict, Vitest 4 via `@angular/build:unit-test`,
  SSR scaffold kept (`outputMode: server`) but all routes switched to `RenderMode.Client`
  (`src/app/app.routes.server.ts`). Node 22.15, npm 11.21. Windows; use Git Bash or PowerShell.
- Installed: `@babylonjs/core@9.35.0`, `@babylonjs/loaders@9.35.0`, `howler@2.2.4`, `@types/howler@2.2.13`.
- Budgets in `angular.json` (production): initial 500 kB warn / 1 MB error; anyComponentStyle 4/8 kB.
  All UI styling lives in global partials (`src/styles/_*.scss`) so component budgets are untouched.
- Commands: `npm start` (ng serve, http://localhost:4200), `npx ng test --watch=false`,
  `npx ng build` (production), `npx ng build --configuration development`,
  `npx tsc -p tsconfig.app.json --noEmit` (fast type check).
- Babylon 9 note: `RenderTargetTexture` does NOT frustum-cull and skips layerMask checks when a
  `renderList` is set (`forceLayerMaskCheck` default false) — security feeds rely on this.
- `npm install` warns about unapproved install scripts (esbuild etc.); the build still works.
- Python text-mode writes on Windows produce CRLF; use Node or the editor tools for file edits.

---

## 3. What exists (architecture map)

```
src/app/
  app.ts / app.html (<router-outlet/>) / app.routes.ts ('' MainMenu, 'play' GamePage, lazy) / app.routes.server.ts (Client)
  core/game/
    models/            common, room (SURFACE_MATERIAL_IDS, PROP_TYPES, Room/Door/Light/Window/Opening/Camera/Elevator defs),
                       player-profile (tendencies, metrics, BehaviorResponseDefinition), attention, anomaly
                       (AnomalyDefinition, AnomalyTrigger, AnomalyEffect union, AnomalyClue, DecoyDefinition),
                       difficulty (DifficultyConfig), ending, stage (StageDefinition, ObjectiveId), game-state
                       (Observation, RunSnapshot, ...), settings (+sanitizeSettings), save (CURRENT_SAVE_VERSION=2),
                       events (GameEvent + GameEventBus), audio (SoundDefinition), index.ts barrel
    content/
      content-registry.ts      ContentRegistry + createDefaultContentRegistry() + CONTENT singleton
      content-validator.ts     validateStage/validateAnomaly/validateDifficulty/validateEnding/validateRegistry
      difficulties/difficulties.ts   observer / employee (default) / the-building-knows
      attention/attention-levels.ts  LOW/MEDIUM/HIGH/CRITICAL configs, escalation constants
      endings/endings.ts             normal-exit (A), building-remembers (B), wrong-exit (C)
      behavior/behavior-responses.ts 7 data-driven adaptive responses
      anomalies/floor-14.anomalies.ts 36 anomalies (≥5 per category) + fallback list
      anomalies/floor-14.decoys.ts    11 decoy events
      audio/sound-library.ts          ~60 sound defs (all procedural recipes)
      stages/stage-helpers.ts         onWall/wallProp/inspect/workstation helpers
      stages/floor-14/floor-14.rooms.ts  10 rooms (layout ASCII map at top), props, lights, windows
      stages/floor-14/floor-14.stage.ts  doors (11), cameras (4), elevator, spawn, objectives, intro, terminal text
    systems/ (Angular @Injectable, pure logic, unit-tested)
      seeded-random.ts, text-tokens.ts ({employee} {doorCount} {firstVisit:room} {behaviorMessage}...), 
      behavior/behavior-profile.ts + behavior-tracking.service.ts
      anomaly-director.service.ts (DirectorWorld interface, weighted/adaptive/anti-repetition/fallback)
      attention-system.service.ts, investigation.service.ts (scoreReport), memory-room.service.ts,
      progression.service.ts (objectives, flags, resolveEnding), save/ (storage-adapter, save-migrations),
      save-manager.service.ts, settings.service.ts, audio/audio-synth.ts (57 procedural recipes, WAV encoder),
      audio-manager.service.ts (Howler; spatial with Z mirrored for handedness; Web Speech PA voice),
      game-session.service.ts  ← ORCHESTRATOR: run lifecycle, implements EngineHost, all UI signals,
                                 terminal/report API, autosave, endings, retry()/restart()/quitToMenu()
    engine/ (Babylon, lazy chunk via dynamic import in GameSessionService.boot())
      engine-api.ts (EngineHost/GameEngineApi contract, no Babylon imports), game-engine.ts (main loop,
      interaction raycast, gaze dwell, intro, security view, elevator call + ending sequences, atmosphere),
      render-manager.ts (Engine/Scene, DefaultRenderingPipeline, SSAO2 on high, presets, fade via exposure),
      camera-controller.ts (PlayerController), input-manager.ts, collision-manager.ts (2D circle vs OBB),
      lighting-manager.ts (per-room includedOnlyMeshes, flicker/pattern/colour, attention tint, flashlight spot),
      security-camera-system.ts (RTT feeds, overlays, delayed/replay ghost proxy, camera-only layer),
      anomalies/effect-handlers.ts (registry: registerEffectHandler/registeredEffectTypes; 17 effect types),
      endings/destinations.ts (infinite-floor scene, thin instances),
      materials/procedural-textures.ts (pixel surfaces + canvas art; WALL_V_FROM_FLOOR flag),
      materials/material-library.ts (MAX_LIGHTS=6, surface recipes, prop materials, canvasMaterial),
      world/world-builder.ts (floors, ceilings, wall planes with cut-outs, windows, fixtures, RoomMeshRegistry),
      world/prop-kit.ts (PropKit, BuiltProp, CAMERA_ONLY_LAYER), world/text-surface.ts (canvas text styles),
      world/props/{furniture,fixtures,special}.ts (builders for all 68 PROP_TYPES),
      world/object-factory.ts (Record<PropType, PropBuilder>, per-room instancing templates),
      world/prop-registry.ts (transforms, visibility/unseen timers, colliders, memory snapshots),
      world/door-system.ts (hinged leaves, swing maths, colliders, nameplates `sign-<id>`, gaze ids `door-<id>`),
      world/elevator.ts (sliding doors, car, reception-replica interior, car light)
    testing/fake-world.ts (DirectorWorld stand-in for specs)
  features/ (UI agent): main-menu (corridor canvas backdrop, logo w/ reflection, difficulty picker, credits,
      endings record), game (game-page + loading, intro, pause, perf readout, click-to-continue), hud
      (+attention-meter), notebook, investigation-terminal (CRT), settings (shared panel), endings (ending screen)
  shared/: menu-nav & autofocus directives, typewriter, confirm-prompt, ui-sound, window-listener, format(+spec), motion
src/styles.scss → @use partials in src/styles/ (_tokens, _base, _fx, _controls, _menu, _settings, _game, _hud,
      _notebook, _terminal, _endings)
```

Key design decisions (for doc §28): reports are made from **notebook observations** (inspect /
sight / presence / hearing / feed clue modes log factual notes; decoys and mundane props also log
notes, so reporting requires judgement); an anomaly counts once (confirmed ids are never reselected);
witnessed anomalies never expire (fairness); reported anomalies revert when unobserved ("Facilities
will correct it"); room lights only light their own room (per-material light budget); props are
instanced per room; feeds render only near the security room; audio is fully procedural; Ending B
is locked in when the elevator is called; Ending C = memo in dark archive corner (flag memo-found) +
service key in storage hook 3 (flag service-key) + use car panel; attention CRITICAL → 40 s
escalation then recovery to 62 with 75 s grace (no death state).

---

## 4. Verified status (updated 2026-11-09)

- tsc clean; `npx ng test --watch=false` → 16 files / 117 tests passing; `npx ng build` (production) passes with
  no warnings: initial 312 kB (83 kB transfer), lazy game-engine chunk 4.5 MB (777 kB transfer), procedural worker 46 kB.
- Browser playtest DONE (Chrome, Intel Iris Xe, dev hook `window.__tfil` – dev builds only): main menu, new game,
  difficulty picker, loading, intro, HUD, continue/resume, terminal report (correct + false), doors, inspection,
  notebook, pause menu, settings panel, security monitors (feeds + CAM 04 figure perception), anomalies (closet desk,
  extra archive door, corridor stretch, painting, red light), elevator call/arrival, endings A, B, C (incl. walking in
  the infinite floor), NEW SHIFT restart without reload, main menu ENDINGS 3/3, CRITICAL escalation.
- Fixes made during playtest: portal room culler (engine/room-culler.ts) + merged fixtures/elevator + frozen static
  matrices (17-37 ms → 7-10 ms CPU frame, 60 FPS); worker pool for textures+audio (load 14 s → 7 s); alpha-test fix
  (useAlphaFromDiffuseTexture); brighter calibrated lighting (LIGHT_GAIN) + ceiling bounce; logo text fit; feed exposure;
  one-feed-per-frame security rendering with frustum-culled lists; flashlight toggled by intensity (no shader recompiles);
  closet vignette light + screen orientation; memo placement; decoy dedupe; short-viewport menu; service-key prompt verb;
  NG0956 warnings (RekeyDirective); retry() keeps the saved shift.
- Testing tip: Chrome throttles rAF in the automated window – use `__tfil.step(n)` to render frames synchronously,
  `__tfil.lock(true)` to simulate pointer lock, `__tfil.teleport(x, z, yaw, pitch)`, `__tfil.press('KeyE')`.

---

## 5. Remaining work

None - MVP delivered on 2026-11-09 (GAME_DESIGN_AND_EXPANSION.md and README.md written, tests + production build green).
This file can be deleted; future work should follow GAME_DESIGN_AND_EXPANSION.md (roadmap in section 25).

Notes from the UI agent: overlays own Escape/Tab via capture-phase window listeners; engine only acts
on keys while pointer-locked and playing (keep it that way; don't bind Enter). Credits author constant
`CREDIT_AUTHOR = 'Luka'` in `features/main-menu/main-menu.ts`. HUD shows `CAM {index+1}/{count}`.
