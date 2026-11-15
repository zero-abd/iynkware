import { describe, expect, test } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { CUES, GAIN, LOOPS } from '../src/run/kit/cues';
import { benchGeometry, onTable } from '../src/bench/core/geometry';
import { runLayout } from '../src/run/kit/layout';
import { defineStrings, fill, placeholders, stringProblems } from '../src/run/kit/strings';
import { bandOf, bandsOf, dmm, FIXED_LIGHT, rgbOf } from '../src/run/kit/tokens';

describe('run kit strings', () => {
  const s = defineStrings({
    en: { run: 'Run', clock: 't {s} s' },
    de: { run: 'Starten', clock: 't {s} s' },
    es: { run: 'Ejecutar', clock: 't {s} s' },
    fr: { run: 'Lancer', clock: 't {s} s' },
    hi: { run: 'चलाएँ', clock: 't {s} s' },
    zh: { run: '运行', clock: 't {s} 秒' },
  });

  test('picks the language and fills placeholders', () => {
    expect(s.t('de', 'run')).toBe('Starten');
    expect(s.t('zh', 'clock', { s: '1.50' })).toBe('t 1.50 秒');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(placeholders('{b} {a} {b}')).toEqual(['a', 'b', 'b']);
  });

  test('a good table has no problems', () => {
    expect(stringProblems(s.table)).toEqual([]);
  });

  test('finds empty texts, placeholder drift and exclamation marks', () => {
    const bad = {
      ...s.table,
      fr: { run: '', clock: 't {secs} s' },
      es: { run: 'Ejecutar!', clock: 't {s} s' },
    };
    expect(stringProblems(bad)).toEqual(['es.run: exclamation mark', 'fr.run: empty', 'fr.clock: placeholders differ']);
  });
});

describe('run kit tokens', () => {
  test('dmm keeps angular size', () => {
    expect(dmm(20, 0.6)).toBeCloseTo(0.012, 9);
    expect(dmm(44, 1)).toBeCloseTo(0.044, 9);
  });

  test('bands darken towards black by 16 and 42 per cent', () => {
    const b = bandsOf('#f2efe7');
    expect(b.l).toEqual(rgbOf('#f2efe7'));
    expect(b.m[0]).toBeCloseTo(b.l[0] * 0.84, 9);
    expect(b.d[2]).toBeCloseTo(b.l[2] * 0.58, 9);
  });

  test('the top face is light, faces away from the light are dark', () => {
    expect(Math.hypot(...FIXED_LIGHT)).toBeCloseTo(1, 9);
    expect(bandOf([0, 1, 0])).toBe('l');
    expect(bandOf([0, -1, 0])).toBe('d');
    expect(bandOf([0, 0, 1])).toBe('m');
  });
});

describe('run kit layout', () => {
  for (const posture of ['seated', 'standing'] as const) {
    test(`${posture}: the cluster is on the front rail and the rack mirrors the shelf`, () => {
      const right = runLayout(posture, 'right');
      const left = runLayout(posture, 'left');
      const front = right.top.d / 2;
      expect(right.cluster.position[2]).toBeCloseTo(front - 0.02, 9);
      expect(right.cluster.position[1]).toBeCloseTo(0.03, 9);
      expect(right.cluster.tiltRad).toBeCloseTo(Math.PI / 6, 9);
      expect(right.clusterHalfW).toBe(0.15);
      // Away from the dominant hand, on the bench's tools wing, beside the mat.
      const g = benchGeometry(posture, 'right');
      expect(right.rack.x).toBeLessThan(0);
      expect(left.rack.x).toBeCloseTo(-right.rack.x, 9);
      expect(right.rack).toEqual({ x: g.tools.x, z: g.tools.z, w: g.tools.w, d: g.tools.d });
      // The rack slots stay inside the (turned) rack, on the table, and apart.
      const slots = [right.meter, right.scopeProbe, right.deck];
      const c = Math.cos(g.tools.yawRad), sn = Math.sin(g.tools.yawRad);
      for (const s of slots) {
        const dx = s.position[0] - right.rack.x, dz = s.position[2] - right.rack.z;
        expect(Math.abs(dx * c - dz * sn)).toBeLessThanOrEqual(right.rack.w / 2 + 1e-9);
        expect(Math.abs(dx * sn + dz * c)).toBeLessThanOrEqual(right.rack.d / 2 + 1e-9);
        expect(onTable(g.table, s.position[0], s.position[2])).toBe(true);
        expect(s.yawRad).toBeCloseTo(g.tools.yawRad, 9);
      }
      expect(Math.hypot(right.scopeProbe.position[0] - right.deck.position[0], right.scopeProbe.position[2] - right.deck.position[2])).toBeGreaterThan(0.1);
    });
  }

  test('panels sit at their distance from the eyes and turn to face them', () => {
    const l = runLayout('seated', 'right');
    const dist = (p: readonly number[]) => Math.hypot(p[0]! - l.eye[0], p[1]! - l.eye[1], p[2]! - l.eye[2]);
    expect(dist(l.scopeScreen.position)).toBeCloseTo(0.95, 6);
    expect(dist(l.serial.position)).toBeCloseTo(1.1, 6);
    expect(l.serial.position[0]).toBeGreaterThan(0);
    expect(l.serial.yawRad).toBeLessThan(0);
    expect(runLayout('seated', 'left').serial.position[0]).toBeLessThan(0);
    expect(l.scopeScreen.tiltRad).toBeLessThan(0);
  });
});

describe('run kit cues', () => {
  test('every cue has a sane haptic pattern and a known sound', () => {
    for (const [name, spec] of Object.entries(CUES)) {
      expect(spec.haptic.length, name).toBeGreaterThan(0);
      for (const [i, ms, at] of spec.haptic) {
        expect(i).toBeGreaterThan(0);
        expect(i).toBeLessThanOrEqual(1);
        expect(ms).toBeGreaterThan(0);
        expect(at).toBeGreaterThanOrEqual(0);
      }
      if (spec.sound) expect(GAIN[spec.sound]).toBeGreaterThan(0);
    }
    for (const l of Object.values(LOOPS)) expect(GAIN[l.sound]).toBeGreaterThan(0);
  });

  test('hover is barely felt and silent, a short is unmistakable (P12)', () => {
    expect(CUES['ui-hover'].haptic).toEqual([[0.08, 8, 0]]);
    expect(CUES['ui-hover'].sound).toBeNull();
    expect(CUES.short.haptic).toEqual([[0.9, 120, 0]]);
    expect(GAIN.tick).toBeLessThan(GAIN.zap);
  });

  test('the six languages are the contract order', () => {
    expect(LANGS).toEqual(['en', 'de', 'es', 'fr', 'hi', 'zh']);
  });
});
