import { AnomalyDefinition } from '../models';
import { FakeWorld, directorSetup, profile, registry, startDirector, stage } from '../testing/fake-world';
import { AnomalyDirectorService, effectPropIds } from './anomaly-director.service';

const def = (id: string): AnomalyDefinition => registry.anomalies.require(id);

describe('AnomalyDirectorService', () => {
  describe('eligibility', () => {
    it('excludes anomalies that need a baseline until the room was visited', () => {
      const director = startDirector();
      const world = new FakeWorld();
      expect(director.isEligible(def('rec-painting-figure'), world, false)).toBe(false);
      world.enter('reception');
      expect(director.isEligible(def('rec-painting-figure'), world, false)).toBe(true);
    });

    it('filters by the difficulty rating table', () => {
      const easy = startDirector('observer');
      const hard = startDirector('the-building-knows');
      const world = new FakeWorld();
      world.visitAll();
      // rating 1 is never allowed on HARD, rating 4+ never on EASY
      expect(hard.isEligible(def('cnf-phone-ring'), world, false)).toBe(false);
      expect(easy.isEligible(def('cnf-phone-ring'), world, false)).toBe(true);
      expect(easy.isEligible(def('cnf-chair-missing'), world, false)).toBe(false);
      expect(hard.isEligible(def('cnf-chair-missing'), world, false)).toBe(true);
    });

    it('honours time, door-state and attention conditions', () => {
      const director = startDirector();
      const world = new FakeWorld();
      world.visitAll();
      expect(director.isEligible(def('cor-pa-announcement'), world, false)).toBe(false); // minElapsedSec 150
      director['state'].elapsed = 200;
      expect(director.isEligible(def('cor-pa-announcement'), world, false)).toBe(true);
      expect(director.isEligible(def('brk-door-slam'), world, false)).toBe(false); // door is closed
      world.doorStates['d-cor-break'] = 'open';
      expect(director.isEligible(def('brk-door-slam'), world, false)).toBe(true);
    });

    it('never puts two anomalies on the same prop or exclusive group in play', () => {
      const director = startDirector();
      const world = new FakeWorld();
      world.visitAll();
      // stg-knocking and stg-closet-desk both use the closet door
      expect(effectPropIds(def('stg-knocking'))).toContain('stg-closet-door');
      director['state'].anomalies['stg-knocking'].status = 'active';
      expect(director.isEligible(def('stg-closet-desk'), world, false)).toBe(false);
      // computer history and the player monitor
      director['state'].anomalies['opn-computer-history'].status = 'witnessed';
      expect(director.isEligible(def('opn-screen-message'), world, false)).toBe(true);
    });

    it('limits simultaneous anomalies per room', () => {
      const director = startDirector('observer'); // maxPerRoom 1
      const world = new FakeWorld();
      world.visitAll();
      director['state'].anomalies['cnf-clock-backward'].status = 'active';
      expect(director.isEligible(def('cnf-phone-ring'), world, false)).toBe(false);
    });

    it('does not reselect confirmed anomalies', () => {
      const director = startDirector();
      const world = new FakeWorld();
      world.visitAll();
      director['state'].anomalies['cnf-clock-backward'].status = 'retired';
      director['state'].anomalies['cnf-clock-backward'].timesActivated = 1;
      expect(director.isEligible(def('cnf-clock-backward'), world, false)).toBe(false);
    });
  });

  describe('weighted, adaptive selection', () => {
    it('is reproducible for a seed', () => {
      const run = (seed: number) => {
        const d = startDirector('employee', seed);
        const w = new FakeWorld();
        w.visitAll();
        w.playerRoomId = 'reception';
        const picks: string[] = [];
        for (let i = 0; i < 6; i++) {
          const p = d.selectNext(w);
          if (p) picks.push(p.id);
        }
        return picks;
      };
      expect(run(77)).toEqual(run(77));
      expect(run(77)).not.toEqual(run(78));
    });

    it('door-checkers see door anomalies far more often', () => {
      const countDoor = (scores: Parameters<typeof profile>[0]) => {
        let doors = 0;
        for (let seed = 0; seed < 200; seed++) {
          const d = startDirector('employee', seed);
          const w = new FakeWorld();
          w.visitAll();
          w.playerRoomId = 'reception';
          w.profile = profile(scores);
          d.update(61, w); // pass minElapsed gates
          const pick = d.eligible(w, false);
          const chosen = d['rng'].weighted(pick, (x: AnomalyDefinition) => d.weightOf(x, w));
          if (chosen?.tags?.includes('door')) doors++;
        }
        return doors;
      };
      const neutral = countDoor({});
      const checker = countDoor({ 'door-checker': 1 });
      expect(checker).toBeGreaterThan(neutral * 1.6);
    }, 30_000); // statistical: 400 director runs, CPU-bound on slow machines

    it('avoidant players get more clues in dark rooms', () => {
      const d = startDirector();
      const w = new FakeWorld();
      w.visitAll();
      const dark = def('arc-box-labels');
      const neutral = d.weightOf(dark, w);
      w.profile = profile({ avoidant: 1 });
      expect(d.weightOf(dark, w)).toBeGreaterThan(neutral * 2);
    });

    it('anti-repetition penalises the same category and room as the last activation', () => {
      const d = startDirector();
      const w = new FakeWorld();
      w.visitAll();
      const a = def('cnf-clock-backward');
      const sameRoomCategory = def('cnf-phone-ring');
      const before = d.weightOf(sameRoomCategory, w);
      d['state'].history.push(a.id);
      const after = d.weightOf(sameRoomCategory, w);
      expect(after).toBeLessThan(before * 0.6);
    });
  });

  describe('scheduling and triggers', () => {
    it('makes initial selections and activates immediate anomalies away from the player', () => {
      const d = startDirector('employee', 5);
      const w = new FakeWorld();
      w.enter('open-plan');
      d.update(0.1, w);
      const pending = Object.values(d['state'].anomalies).filter((s) => s.status === 'pending' || s.status === 'active');
      expect(pending.length).toBe(2);
      for (let i = 0; i < 20; i++) d.update(0.25, w);
      for (const a of d.appliedAnomalies()) expect(a.roomId === 'open-plan' && a.trigger.type === 'immediate' && !a.trigger.allowObserved).toBe(false);
    });

    it('memory-room changes only happen after the player leaves', () => {
      const d = startDirector('employee', 9);
      const w = new FakeWorld();
      w.enter('manager-office');
      const plant = def('mgr-plant-moved');
      expect(d.triggerSatisfied(plant, w)).toBe(false);
      w.enter('employee-corridor');
      expect(d.triggerSatisfied(plant, w)).toBe(true);
    });

    it('witnessed anomalies are never withdrawn, unwitnessed ones expire when unobserved', () => {
      const d = startDirector('employee', 3);
      const w = new FakeWorld();
      w.visitAll();
      w.playerRoomId = 'reception';
      const s = d['state'].anomalies;
      s['cnf-clock-backward'] = { id: 'cnf-clock-backward', status: 'active', activatedAt: 0, timesActivated: 1 };
      s['brk-microwave-impossible'] = { id: 'brk-microwave-impossible', status: 'witnessed', activatedAt: 0, witnessedAt: 1, timesActivated: 1 };
      const actions = d.update(1000, w);
      expect(actions.some((a) => a.type === 'retire' && a.anomaly.id === 'cnf-clock-backward')).toBe(true);
      expect(d.status('brk-microwave-impossible')).toBe('witnessed');
    });

    it('reported anomalies are corrected once unobserved and never return', () => {
      const d = startDirector('employee', 3);
      const w = new FakeWorld();
      w.visitAll();
      w.playerRoomId = 'conference';
      d['state'].anomalies['cnf-clock-backward'] = { id: 'cnf-clock-backward', status: 'witnessed', timesActivated: 1 };
      d.markReported('cnf-clock-backward');
      expect(d.update(1, w).some((a) => a.type === 'retire')).toBe(false); // player still in the room
      w.playerRoomId = 'reception';
      expect(d.update(1, w).some((a) => a.type === 'retire' && a.reason === 'resolved')).toBe(true);
      expect(d.isEligible(def('cnf-clock-backward'), w, true)).toBe(false);
    });

    it('falls back to always-eligible anomalies when the weighted pool is empty', () => {
      const d = new AnomalyDirectorService();
      const setup = directorSetup(registry.difficulties.require('employee'));
      d.start(setup);
      const w = new FakeWorld(); // nothing visited -> most anomalies ineligible
      w.profile = profile();
      // Exhaust everything except fallbacks
      for (const id of stage.anomalyIds) if (!stage.fallbackAnomalyIds.includes(id)) d['state'].anomalies[id].status = 'retired';
      const pick = d.selectNext(w);
      expect(pick).not.toBeNull();
      expect(stage.fallbackAnomalyIds).toContain(pick!.id);
    });

    it('serialises and restores its state', () => {
      const d = startDirector('employee', 11);
      const w = new FakeWorld();
      w.visitAll();
      for (let i = 0; i < 40; i++) d.update(1, w);
      const saved = d.getState();
      const r = new AnomalyDirectorService();
      r.restore(directorSetup(registry.difficulties.require('employee'), 11), saved);
      expect(r.appliedAnomalies().map((a) => a.id).sort()).toEqual(d.appliedAnomalies().map((a) => a.id).sort());
      expect(r.elapsed).toBeCloseTo(d.elapsed);
    });
  });
});
