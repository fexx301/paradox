// Regression test: editing only the address on a paid order must not change its total.
// Replays the live agent's reproducer against a running store (VENDURE_BASE, default
// http://127.0.0.1:3000). Fails on Vendure 3.7.3: once a scheduled promotion expires,
// an address-only modifyOrder drops its discount from the paid order.
//
//   node --test test/paid-total-invariant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repro = fileURLToPath(new URL('../runs/2026-10-17-agent/findings/repro.mjs', import.meta.url));

test('address-only edit leaves a paid order total unchanged', { timeout: 240_000 }, () => {
  const run = spawnSync(process.execPath, [repro], { encoding: 'utf8', env: process.env, timeout: 230_000 });
  const result = (run.stdout ?? '').split('\n').find((line) => line.startsWith('RESULT:'));
  assert.ok(result, `reproducer printed no RESULT line (exit ${run.status})\n${run.stderr}`);
  assert.doesNotMatch(result, /VIOLATION/, result);
});
