# THE FLOOR IS LYING

A first-person psychological horror game that runs in the browser. You wake up at your desk on
Floor 14 of an abandoned corporate building. The exit is locked until you complete a **floor
inspection**: find five genuine irregularities and report them at the reception terminal. The
building watches how you play — the doors you check, the rooms you avoid, how often you come
back — and changes itself to match.

No jumpscares. Every anomaly is fair: it has a clue you can find, and once you have seen it, it
stays. There is no death and no way to make the game impossible.

## Features

- Ten interconnected rooms (reception, open-plan office, conference room, manager's office,
  break room, storage, archive, employee corridor, security room, elevator lobby)
- 36 anomalies in five categories (visual, spatial, temporal, audio, behavioural) plus 11
  "decoy" events that only sound suspicious
- An adaptive, deterministic **anomaly director** driven by a behaviour profile (curious,
  cautious, rusher, repetitive, avoidant, observant, door-checker)
- A notebook of observations and an old CRT inspection terminal for filing reports
- **BUILDING ATTENTION**: false reports and reckless play make the building react (lights,
  fog, sound, camera interference) up to a CRITICAL escalation — and it always recovers
- Memory rooms that change while you are away, security monitors that do not always agree with
  you, a flashlight, a working elevator, and three endings
- Three difficulties: OBSERVER, EMPLOYEE, THE BUILDING KNOWS
- Persistent settings, Continue, statistics and unlocked endings (versioned save data)
- Everything is procedural: geometry, textures and audio are generated at runtime — no asset
  downloads

## Technology stack

| | |
|---|---|
| App shell | Angular 21 (standalone components, signals, zoneless, lazy routes) |
| 3D engine | Babylon.js 9 (`@babylonjs/core`; `@babylonjs/loaders` installed for future models) |
| Audio | Howler.js 2.2 with procedurally synthesised WAV sources |
| Language | TypeScript 5.9 (strict) |
| Styles | SCSS (global partials in `src/styles/`) |
| Tests | Vitest via `@angular/build:unit-test` |
| Persistence | `localStorage` (in-memory fallback) |

## Prerequisites

- Node.js 20.19+ or 22.12+ (developed with Node 22.15) and npm 10+
- A desktop browser with WebGL 2: Chrome, Edge or Firefox (Windows is the primary target)
- Keyboard and mouse; headphones recommended

## Installation

```bash
npm install
```

## Development

```bash
npm start            # ng serve → http://localhost:4200
```

The dev server reloads on change. In development builds the browser console shows boot timings
and director decisions, and `window.__tfil` exposes a small automation/debug handle (teleport,
simulated input, frame stepping, stats). Append `?seed=1234` to `/play` to reproduce a run.

## Build

```bash
npx ng build                               # production build → dist/backrooms
npx ng build --configuration development   # unminified build with source maps
```

The production build is client-rendered (the SSR setup is kept, every route uses
`RenderMode.Client`). Serve it with the generated server (`npm run serve:ssr:backrooms`, port 4000)
or any static host serving `dist/backrooms/browser`.

## Tests

```bash
npx ng test --watch=false    # 16 spec files, 117 tests
npx ng test                  # watch mode
```

The suite covers behaviour profiling, director eligibility/selection/anti-repetition, report
scoring, attention, save migration, content validation and a completability simulation that plays
every difficulty with several behaviour profiles.

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (click the game to capture the mouse) |
| Shift | Sprint |
| E | Interact / inspect / open doors |
| F | Flashlight |
| Tab | Notebook |
| Esc | Pause |
| A / D (at the security monitors) | Switch camera |

## How to play

1. Click **New Game**, pick a difficulty, then click to wake up.
2. Find the reception terminal. It explains the inspection.
3. Explore. Inspect objects (E), listen, watch the security feeds. Everything you notice is noted
   in your notebook (Tab) — including perfectly ordinary things.
4. Report irregularities at the terminal: choose the room, the notebook entry and a category.
   An irregularity is something that has **changed**, or something that **cannot be**.
   False reports raise BUILDING ATTENTION.
5. After five confirmed reports, request elevator access and take the elevator. How you played
   decides where it goes.

## Project structure

```
src/
  app/
    app.ts / app.routes.ts / app.routes.server.ts     shell, lazy routes, client rendering
    core/game/
      models/        typed, serialisable data models (rooms, anomalies, difficulty, endings, saves…)
      content/       data: stages (floor-14), anomalies, decoys, difficulties, endings, behaviour
                     responses, attention levels, sound library, registry + validator
      systems/       Angular services with pure game logic: session orchestrator, behaviour
                     tracking, anomaly director, attention, investigation, memory rooms,
                     progression, saves/migrations, settings, audio manager + synthesiser
      engine/        Babylon.js engine (lazy chunk): render, player, input, collision, lighting,
                     world/props/doors/elevator builders, room culling, security cameras,
                     anomaly effect handlers, ending destinations
      workers/       procedural worker pool (textures + audio off the main thread)
      testing/       test-only fakes
    features/        UI: main menu, game page, HUD, pause, settings, terminal, notebook, endings
    shared/          directives and helpers
  styles/            global SCSS partials (tokens, menu, HUD, terminal…)
GAME_DESIGN_AND_EXPANSION.md   design + extension guide (source of truth)
```

## Documentation

- **[GAME_DESIGN_AND_EXPANSION.md](GAME_DESIGN_AND_EXPANSION.md)** — game design, systems,
  architecture, performance, testing, and step-by-step guides for adding anomalies, rooms,
  stages, difficulties, endings, interactions and sounds.
- In-code documentation on every model (`src/app/core/game/models`) and system.
