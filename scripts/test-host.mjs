// Plain-Node test for the delete-conversation Host logic.
// Run: node scripts/test-host.mjs
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deleteConversation,
  encodeSegment,
  projectKey,
  resolveSessionDir,
} from '../index.js';

let passed = 0;
function ok(label) {
  passed += 1;
  console.log('ok -', label);
}

// --- encoding parity with @deepseek-ai/dsh-session-persistence-jsonl ---------
assert.equal(
  projectKey('C:\\Users\\wang\'xing\\Documents\\deepseek-harness\\default-workspace'),
  '--C-Users-wang~0027xing-Documents-deepseek-harness-default-workspace--',
);
assert.equal(encodeSegment('session-f1b72830-9086-4765-8fa7-17bf4761c196'), 'session-f1b72830-9086-4765-8fa7-17bf4761c196');
assert.equal(encodeSegment('..'), '~002E~002E');
assert.equal(encodeSegment('a/b'), 'a~002Fb');
ok('path encoding matches the shipped JSONL backend');

// The encoding turns a traversal-looking id into one inert path segment.
const encodedDots = resolveSessionDir('C:\\root', { id: '..' });
assert.equal(encodedDots.startsWith(path.resolve('C:\\root') + path.sep), true);
assert.equal(path.relative(path.resolve('C:\\root'), encodedDots).startsWith('..'), false);
ok('resolveSessionDir keeps traversal-looking ids inside the session root');

// --- happy path --------------------------------------------------------------
const root = path.join(os.tmpdir(), 'dsh-delete-conversation-test-' + process.pid);
const sessionId = 'session-abc';
const sessionDir = path.join(root, '--C-proj--', sessionId);
await fsp.rm(root + '.trash', { recursive: true, force: true });
await fsp.mkdir(sessionDir, { recursive: true });
await fsp.writeFile(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'stub');

const calls = { unarchive: [], unpin: [], detach: [] };
const workspace = {
  sessionIds: [sessionId, 'other'],
  async detachSession(id) {
    calls.detach.push(id);
  },
};
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') {
      return {
        root,
        async stat(id) {
          if (id !== sessionId) throw new Error('no such session: ' + id);
          return { header: { id, cwd: 'C:\\proj' } };
        },
      };
    }
    if (name === 'sessions') return { get: () => undefined };
    if (name === 'agents') return { get: () => undefined };
    if (name === 'workspaceRegistry') {
      return {
        async unarchiveSession(id) {
          calls.unarchive.push(id);
        },
        async unpinSession(id) {
          calls.unpin.push(id);
        },
        list: () => [workspace],
      };
    }
    return undefined;
  },
};

const result = await deleteConversation(ctx, sessionId);
assert.equal(result.status, 200, JSON.stringify(result.body));
assert.equal(result.body.ok, true);
assert.equal(result.body.warnings.length, 0);
assert.deepEqual(calls.unarchive, [sessionId]);
assert.deepEqual(calls.unpin, [sessionId]);
assert.deepEqual(calls.detach, [sessionId]);
await assert.rejects(fsp.stat(sessionDir), /ENOENT/);
const trashed = await fsp.stat(result.body.trashedPath);
assert.equal(trashed.isDirectory(), true);
assert.equal(await fsp.readFile(path.join(result.body.trashedPath, 'session.v4.jsonl.zstd'), 'utf8'), 'stub');
ok('deletes an idle session by moving its directory into sessions.trash');

// --- live guard --------------------------------------------------------------
const liveCtx = {
  get(name) {
    if (name === 'sessionPersistence') return { root, stat: async () => ({ header: { id: sessionId, cwd: 'C:\\proj' } }) };
    if (name === 'sessions') return { get: () => ({ id: sessionId }) };
    if (name === 'agents') return { get: () => undefined };
    return undefined;
  },
};
const liveResult = await deleteConversation(liveCtx, sessionId);
assert.equal(liveResult.status, 409);
assert.equal(liveResult.body.code, 'session-live');
ok('refuses a session that is still live in the Host');

// --- invalid and missing ids -------------------------------------------------
const invalid = await deleteConversation(ctx, '../escape');
assert.equal(invalid.status, 400);
assert.equal(invalid.body.code, 'invalid-session-id');
const missing = await deleteConversation(ctx, 'session-missing');
assert.equal(missing.status, 404);
assert.equal(missing.body.code, 'not-found');
ok('rejects malformed and unknown session ids without touching disk');

// --- dry run -----------------------------------------------------------------
const dryId = 'session-dry';
const dryDir = path.join(root, '--C-proj--', dryId);
await fsp.mkdir(dryDir, { recursive: true });
await fsp.writeFile(path.join(dryDir, 'session.v4.jsonl.zstd'), 'stub');
const dryCtx = {
  get(name) {
    if (name === 'sessionPersistence') {
      return {
        root,
        async stat(id) {
          if (id !== dryId) throw new Error('no such session: ' + id);
          return { header: { id, cwd: 'C:\\proj' } };
        },
      };
    }
    if (name === 'sessions') return { get: () => undefined };
    if (name === 'agents') return { get: () => undefined };
    if (name === 'workspaceRegistry') return { async unarchiveSession() { throw new Error('must not run'); }, async unpinSession() { throw new Error('must not run'); }, list: () => [] };
    return undefined;
  },
};
const dry = await deleteConversation(dryCtx, dryId, { dryRun: true });
assert.equal(dry.status, 200);
assert.equal(dry.body.dryRun, true);
assert.equal(dry.body.sessionDir, dryDir);
await fsp.stat(dryDir); // still there
assert.equal((await fsp.readdir(path.join(root, '--C-proj--'))).includes(dryId), true);
await fsp.rm(dryDir, { recursive: true, force: true });
ok('dryRun resolves the target paths without moving files or touching the registry');

await fsp.rm(root, { recursive: true, force: true });
await fsp.rm(root + '.trash', { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
