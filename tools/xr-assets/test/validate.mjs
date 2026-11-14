// Shared checks for generated assets: the Khronos glTF validator and the sidecar's JSON schema.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import validator from 'gltf-validator';
import Ajv2020 from 'ajv/dist/2020.js';

const TOOL = join(import.meta.dirname, '..');
let validateSidecar = null;

/** The validator's report for a .glb buffer: { errors, warnings, infos, issues }. */
export async function validateGlb(buf, uri = 'asset.glb') {
  const report = await validator.validateBytes(new Uint8Array(buf), { uri, maxIssues: 50, ignoredIssues: ['UNUSED_OBJECT'] });
  return { errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos, issues: report.issues.messages };
}

/** Schema errors for a sidecar object ([] when it is valid). */
export function sidecarErrors(sidecar) {
  if (!validateSidecar) {
    const schema = JSON.parse(readFileSync(join(TOOL, 'schema', 'xr-asset.schema.json'), 'utf8'));
    validateSidecar = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  }
  return validateSidecar(sidecar) ? [] : validateSidecar.errors.map((e) => `${e.instancePath} ${e.message}`);
}
