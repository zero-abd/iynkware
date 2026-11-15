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
    const schema = withLabKind(JSON.parse(readFileSync(join(TOOL, 'schema', 'xr-asset.schema.json'), 'utf8')));
    validateSidecar = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  }
  return validateSidecar(sidecar) ? [] : validateSidecar.errors.map((e) => `${e.instancePath} ${e.message}`);
}

/**
 * The lab item kind (docs/XR_ASSETS.md section 1) is its own contract change (issue #10, branch
 * naeemexe/10-lab-kind-contract): it adds 'lab' to the item kinds and 'lab/' to the id pattern, nothing else. Until it
 * is merged the checked-in schema lacks both, so the tests apply exactly that change in memory; once the schema has it
 * this does nothing.
 */
export const LAB_KIND_PENDING = (schema) => !schema.$defs.itemKind.enum.includes('lab');
export function withLabKind(schema) {
  if (!LAB_KIND_PENDING(schema)) return schema;
  schema.$defs.itemKind.enum = [...schema.$defs.itemKind.enum, 'lab'];
  schema.properties.id.pattern = schema.properties.id.pattern.replace('|flight)/', '|flight|lab)/');
  if (!schema.properties.id.pattern.includes('|lab)/')) throw new Error('the schema id pattern changed: update withLabKind');
  return schema;
}
