import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function runCli(arguments_, environment) {
  return spawnSync(process.execPath, ['src/cli.js', ...arguments_], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8'
  });
}

test('unknown experiment conditions fail before writing studio state', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-cli-condition-'));
  const studioRoot = path.join(parent, 'studio');
  const result = runCli(['run', '--condition', 'not-a-condition'], {
    ...process.env,
    HAUNTED_STUDIO_HOME: studioRoot
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown experiment condition/);
  await assert.rejects(access(studioRoot), { code: 'ENOENT' });
});

test('missing OpenAI API key fails before writing studio state', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-cli-key-'));
  const studioRoot = path.join(parent, 'studio');
  const environment = {
    ...process.env,
    HAUNTED_STUDIO_HOME: studioRoot,
    HAUNTED_STUDIO_PROVIDER: 'openai'
  };
  delete environment.OPENAI_API_KEY;

  const result = runCli(['run'], environment);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OPENAI_API_KEY is required/);
  await assert.rejects(access(studioRoot), { code: 'ENOENT' });
});
