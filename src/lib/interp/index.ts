/**
 * iynk interpreters: an Arduino C++ subset, a MicroPython/Python subset and a
 * Verilog subset, all on one deterministic virtual clock.
 *
 * ```ts
 * const run = createRun({ board: 'uno-r3', source: sketch });
 * run.on('serial', (text) => monitor.append(text));
 * run.on('pins', (snap) => figure.send('set', { pins: snap }));
 * run.start();
 * // each animation frame:
 * run.step(frameMs);
 * ```
 */
export { createRun, check, type Run, type RunOptions, type RunEvents, type RunState, type RunStatus, type DeviceKind } from './run';
export { InterpError, type Diagnostic, type SourcePos, type ErrorKind } from '../../sim/lang/errors';
export { PROFILES, BOARD_IDS, getProfile, resolvePin, hasPwm, type BoardId, type BoardProfile, type Language, type LedDef, type ButtonDef, type FpgaPort } from '../../sim/boards/profiles';
export { World, type Snapshot, type PinView, type PinMode, type WorldOptions, type WifiNetwork, type OledText } from './world';
export { Mpu6050, Pca9685, Ssd1306, Lcd1602, HcSr04, GenericI2C, litSegments, type I2CDevice } from './devices';
export type { RosMessage } from './python/modules';
export { runHeadless, type HeadlessOptions } from './headless';
export { INTERP_LANGUAGE } from './language';
export { CHECK_BUDGET_MS, LIMIT_MESSAGE } from './check-limits';
export { evaluateChecks, evaluateCheck, servoDegrees, sampleAt, risingEdges, codeOnly, type CheckResult, type CheckContext } from './checks';
export { stateMatches } from './state-match';
export { pinNet, netResolver, pinoutNets } from './pins';
export { WorldBinding, drivesFor, runOptionsFor, qtrDarkness, type PinDrive, type HttpExchange, type WorldBindingOptions } from './lesson-world';
export { runChecks, lessonJob, taskJob, lessonVariant, boardNets, type CheckJob, type CheckOutcome, type CheckRunOptions } from './check-job';
export { startChecks, type CheckHandle } from './check-client';
