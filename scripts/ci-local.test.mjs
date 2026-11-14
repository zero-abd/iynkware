import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/ci-local.sh');

const STEPS = ['content', 'schema', 'typecheck', 'lint', 'ui', 'no-only', 'copy', 'provenance', 'unit', 'perf', 'server', 'build', 'e2e', 'secrets', 'audit'];

describe('scripts/ci-local.sh', () => {
  it('lists the fifteen steps in order', () => {
    const out = execFileSync('bash', [script, '--list'], { cwd: root, encoding: 'utf8' });
    expect(out.trim().split('\n')).toEqual(STEPS);
  });

  it('is valid bash', () => {
    expect(() => execFileSync('bash', ['-n', script])).not.toThrow();
  });

  it('rejects an unknown step and names the valid ones', () => {
    const run = spawnSync('bash', [script, '--only', 'nosuchstep'], { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('nosuchstep');
    expect(run.stderr).toContain(STEPS.join(' '));
  });

  it('no-only passes on a tree with no focused test', () => {
    const run = spawnSync('bash', [script, '--only', 'no-only'], { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(0);
  });

  it('no-only fails and names a file holding a focused test', () => {
    const fixture = join(root, 'scripts/.only-fixture.tmp.mjs');
    writeFileSync(fixture, `${['it', 'only'].join('.')}()\n`);
    try {
      const run = spawnSync('bash', [script, '--only', 'no-only'], { cwd: root, encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stdout).toContain('.only-fixture.tmp.mjs');
    } finally {
      rmSync(fixture, { force: true });
    }
  });
});
