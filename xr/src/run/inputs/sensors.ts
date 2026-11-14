/**
 * The sensors a hand acts on while the run is live, read every frame from `app.input.pose(hand)` (nothing is allocated):
 * a hand above a light sensor shades it, a hand or controller in front of a distance sensor is its obstacle, a hand held
 * over a temperature sensor warms it, and a hand held close to a humidity sensor breathes on it. Moisture has no hand
 * gesture: it gets an inked Water plate beside the part. Each sends at most 20 times a second and only on a real change.
 */
import { Vector3 } from '@iwsdk/core';
import type { Hand } from '../../contracts/input';
import { bindPlate, plateButton } from '../kit/plate';
import { animated, MOTION } from '../kit/motion';
import {
  RANGER_REST_CM,
  approach,
  breathStep,
  inCone,
  limiter,
  rangeCm,
  shadeAmount,
  shadedLux,
  soilStep,
  warmStep,
  wetSoil,
  type InputSpec,
  type Soil,
} from './map';
import type { Host, LivePart, Piece } from './shared';
import { inputStrings as S } from './strings';

const HANDS: readonly Hand[] = ['left', 'right'];
const top = new Vector3();
const up = new Vector3();
const front = new Vector3();
const rel = new Vector3();

/** A hand held this close to a temperature or humidity sensor (bench metres) is holding it. */
const HOLD_M = 0.12;
const BREATH_M = 0.1;

function specOf<K extends InputSpec['kind']>(part: LivePart, kind: K): Extract<InputSpec, { kind: K }> {
  return part.specs.find((s) => s.kind === kind) as Extract<InputSpec, { kind: K }>;
}

export function lightPiece(host: Host, part: LivePart): Piece {
  const { app } = host;
  const spec = specOf(part, 'light');
  const lim = limiter(Math.max(1, spec.rest * 0.02), undefined, spec.rest);
  let cur = spec.rest;
  const send = () => {
    host.send(part.id, spec.path, cur);
    host.chip(part, S.t(app.settings.lang.value, 'light', { v: Math.round(cur) }));
  };
  return {
    tick(dt, now) {
      part.object.updateWorldMatrix(true, false);
      top.set(part.topAt[0], part.topAt[1], part.topAt[2]).applyMatrix4(part.object.matrixWorld);
      up.setFromMatrixColumn(part.object.matrixWorld, 1).normalize();
      let shade = 0;
      for (const h of HANDS) {
        const pose = app.input.pose(h);
        if (!pose) continue;
        rel.set(pose.position[0] - top.x, pose.position[1] - top.y, pose.position[2] - top.z);
        const height = rel.dot(up);
        const side = Math.sqrt(Math.max(0, rel.lengthSq() - height * height));
        shade = Math.max(shade, shadeAmount(height, side));
      }
      const target = shadedLux(spec.rest, shade);
      cur = approach(cur, target, 0.08, dt);
      if (Math.abs(cur - target) < 0.5) cur = target;
      if (lim.take(cur, now)) send();
      else if (cur === target && lim.settle(cur, now)) send();
    },
    reset() {
      cur = spec.rest;
      lim.reset();
    },
    dispose() {},
  };
}

export function distancePiece(host: Host, part: LivePart): Piece {
  const { app } = host;
  const spec = specOf(part, 'distance');
  const half = (spec.beamDeg * Math.PI) / 360;
  const lim = limiter(0.5, undefined, RANGER_REST_CM);
  let cur = RANGER_REST_CM;
  const send = () => {
    host.send(part.id, spec.path, cur);
    host.chip(part, S.t(app.settings.lang.value, 'distance', { v: Math.round(cur) }));
  };
  return {
    tick(dt, now) {
      part.object.updateWorldMatrix(true, false);
      top.set(part.frontAt[0], part.frontAt[1], part.frontAt[2]).applyMatrix4(part.object.matrixWorld);
      front.setFromMatrixColumn(part.object.matrixWorld, 2).normalize();
      const scale = app.bench.scale.value;
      let near = Infinity;
      for (const h of HANDS) {
        const pose = app.input.pose(h);
        if (!pose) continue;
        rel.set(pose.position[0] - top.x, pose.position[1] - top.y, pose.position[2] - top.z);
        if (!inCone(rel.x, rel.y, rel.z, front.x, front.y, front.z, half)) continue;
        const cm = rangeCm(rel.length(), scale, spec.minM, spec.maxM);
        if (cm !== null && cm < near) near = cm;
      }
      const target = near === Infinity ? RANGER_REST_CM : near;
      cur = approach(cur, target, 0.05, dt);
      if (Math.abs(cur - target) < 0.2) cur = target;
      if (lim.take(cur, now) || (cur === target && lim.settle(cur, now))) send();
    },
    reset() {
      cur = RANGER_REST_CM;
      lim.reset();
    },
    dispose() {},
  };
}

/** Temperature and humidity: a hand near the sensor drives a first order lag, read every frame. */
export function warmPiece(host: Host, part: LivePart, kind: 'temp' | 'humidity'): Piece {
  const { app } = host;
  const spec = specOf(part, kind);
  const rest = spec.rest;
  const lim = limiter(kind === 'temp' ? 0.1 : 0.5, undefined, rest);
  let cur = rest;
  const send = () => {
    host.send(part.id, spec.path, cur);
    const shown = kind === 'temp' ? Math.round(cur * 10) / 10 : Math.round(cur);
    host.chip(part, S.t(app.settings.lang.value, kind, { v: shown }));
  };
  return {
    tick(dt, now) {
      part.object.updateWorldMatrix(true, false);
      top.set(part.topAt[0], part.topAt[1], part.topAt[2]).applyMatrix4(part.object.matrixWorld);
      const reach = kind === 'temp' ? HOLD_M : BREATH_M;
      let near = false;
      for (const h of HANDS) {
        const pose = app.input.pose(h);
        if (!pose) continue;
        rel.set(pose.position[0] - top.x, pose.position[1] - top.y, pose.position[2] - top.z);
        if (rel.length() <= reach) near = true;
      }
      cur = kind === 'temp' ? warmStep(cur, near, rest, dt) : breathStep(cur, near, rest, dt);
      if (!near && Math.abs(cur - rest) < 0.05) cur = rest;
      if (lim.take(cur, now) || (!near && cur === rest && lim.settle(cur, now))) send();
    },
    reset() {
      cur = rest;
      lim.reset();
    },
    dispose() {},
  };
}

/** Moisture: an inked Water plate beside the sensor while the run is live; a press wets the soil, which then dries slowly. */
export function moisturePiece(host: Host, part: LivePart): Piece {
  const { app } = host;
  const spec = specOf(part, 'moisture');
  const lang = () => app.settings.lang.value;
  const plate = plateButton(app, { w: 0.07, d: 0.05, h: 0.008 }, { icon: null, label: S.t(lang(), 'water'), lang: lang() });
  const shown = animated(
    app,
    0,
    (v) => {
      plate.group.visible = v > 0.01;
      plate.group.scale.setScalar(Math.max(v, 0.001));
    },
    'fade',
  );
  plate.hit.name = `water:${part.id}`;
  app.bench.table.add(plate.group);
  // Beside the part, towards the person, on the bench top.
  part.object.updateWorldMatrix(true, false);
  top.set(part.topAt[0], 0, part.topAt[2]).applyMatrix4(part.object.matrixWorld);
  app.bench.table.worldToLocal(top);
  plate.group.position.set(top.x, top.y + 0.001, top.z + 0.09);
  const soil: Soil = { value: spec.rest, target: spec.rest };
  const lim = limiter(0.5, undefined, spec.rest);
  const send = () => {
    host.send(part.id, spec.path, soil.value);
    host.chip(part, S.t(lang(), 'moisture', { v: Math.round(soil.value) }));
  };
  const off = bindPlate(app, plate, `water:${part.id}`, () => {
    if (!host.live()) return;
    wetSoil(soil);
  });
  const offLang = app.settings.lang.subscribe(() => plate.set({ label: S.t(lang(), 'water'), lang: lang() }));
  return {
    live(on) {
      shown.to(on ? 1 : 0, MOTION.fade);
    },
    tick(dt, now) {
      soilStep(soil, spec.rest, dt);
      if (lim.take(soil.value, now) || (soil.value === spec.rest && lim.settle(soil.value, now))) send();
    },
    reset() {
      soil.value = spec.rest;
      soil.target = spec.rest;
      lim.reset();
    },
    dispose() {
      off();
      offLang();
      shown.dispose();
      plate.dispose();
    },
  };
}
