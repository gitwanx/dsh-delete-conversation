/**
 * Host half of the delete-conversation plugin.
 *
 * It exposes one local, POST-only route that permanently removes a stored
 * session from the Harness session root. The session directory is moved (not
 * unlinked) to `<session-root>.trash/<stamp>-<encoded-id>`, so a mistaken
 * deletion can still be recovered by hand. The route refuses a session that is
 * still live in this Host process: the persistence backend has no delete API,
 * and pruning a file that a live write handle still owns could resurrect it.
 *
 * The session layout mirrors `@deepseek-ai/dsh-session-persistence-jsonl`:
 *   <root>/--<projectKey(cwd)>--/<encodeSegment(id)>/session.vN.jsonl.zstd
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const name = '@local/dsh-delete-conversation';

/** Mount only once the web server exists; other services are read lazily. */
export const inject = ['webServer'];

/** The web-server route the client half calls. */
export const ROUTE = '/dsh-delete-conversation/delete';

/** Session ids are opaque but safe: one path segment, no traversal. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Whether this Host runs on Windows (only affects post-failure advice). */
const isWindows = process.platform === 'win32';

/**
 * Encode one path segment exactly like the shipped JSONL backend does.
 * @param raw - the session id.
 * @returns a single filesystem-safe directory name.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/**
 * Encode a project directory exactly like the shipped JSONL backend does.
 * The project key is readable but deliberately lossy (separators collapse).
 * @param cwd - the session's recorded working directory.
 * @returns one filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path');
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/**
 * Resolve one stored session directory, refusing anything that escapes the root.
 * @param root - the configured session root.
 * @param header - the stored SessionHeader (needs `id` and optionally `cwd`).
 * @returns the absolute session directory.
 */
export function resolveSessionDir(root, header) {
  if (!header || typeof header.id !== 'string' || header.id.length === 0) {
    throw new Error('stored session header is missing its id');
  }
  const project = header.cwd ? projectKey(header.cwd) : '_no-cwd';
  const encoded = encodeSegment(header.id);
  const dir = path.resolve(root, project, encoded);
  const rel = path.relative(path.resolve(root), dir);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel) || path.basename(dir) !== encoded) {
    throw new Error('refusing a session directory outside the session root');
  }
  return dir;
}

/** The default session root used by the shipped profile. */
export function defaultSessionRoot() {
  const home = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  const dshHome = home.length > 0 ? home : path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'sessions');
}

/** Send one JSON response. */
function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** True when the request's Origin is this loopback Web UI. */
function isLoopbackOrigin(origin) {
  if (origin === undefined || origin === '') return true;
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin);
}

/**
 * Whether the Host currently owns a live session/agent for this id.
 * A live session has an open persistence write handle, so deleting its file
 * behind its back is unsafe.
 */
function isLive(ctx, sessionId) {
  const sessions = ctx.get('sessions');
  if (sessions && typeof sessions.get === 'function') {
    try {
      if (sessions.get(sessionId) !== undefined) return true;
    } catch {
      /* treat an unreadable registry as live for safety */
      return true;
    }
  }
  const agents = ctx.get('agents');
  if (agents && typeof agents.get === 'function') {
    try {
      if (agents.get(sessionId) !== undefined) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Remove the session from workspace accounting (archived, pinned, membership).
 * Failures are warnings: the file move is the authoritative step, and a stale
 * membership entry is filtered out by the registry once the header is gone.
 */
async function forgetInWorkspaces(ctx, sessionId) {
  const warnings = [];
  const registry = ctx.get('workspaceRegistry');
  if (!registry) return warnings;
  for (const method of ['unarchiveSession', 'unpinSession']) {
    if (typeof registry[method] !== 'function') continue;
    try {
      await registry[method](sessionId);
    } catch (error) {
      warnings.push(`${method}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof registry.list !== 'function') return warnings;
  let workspaces = [];
  try {
    workspaces = registry.list();
  } catch (error) {
    warnings.push(`list: ${error instanceof Error ? error.message : String(error)}`);
    return warnings;
  }
  for (const workspace of workspaces) {
    try {
      const ids = workspace.sessionIds;
      if (!Array.isArray(ids) || !ids.includes(sessionId)) continue;
      await workspace.detachSession(sessionId);
    } catch (error) {
      warnings.push(`detach: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return warnings;
}

/**
 * Delete one stored conversation.
 * @param ctx - the Cordis context (services are read lazily for testability).
 * @param sessionId - the session id to delete.
 * @param options - `{ dryRun }` resolves the target paths without moving anything.
 * @returns `{ status, body }` for the web route.
 */
export async function deleteConversation(ctx, sessionId, options = {}) {
  if (typeof sessionId !== 'string' || !ID_PATTERN.test(sessionId)) {
    return { status: 400, body: { ok: false, code: 'invalid-session-id', message: 'session id is not a valid single path segment' } };
  }
  const persistence = ctx.get('sessionPersistence');
  if (!persistence || typeof persistence.stat !== 'function') {
    return { status: 503, body: { ok: false, code: 'persistence-unavailable', message: 'session persistence is not mounted' } };
  }
  let snapshot;
  try {
    snapshot = await persistence.stat(sessionId);
  } catch (error) {
    return {
      status: 404,
      body: { ok: false, code: 'not-found', message: error instanceof Error ? error.message : String(error) },
    };
  }
  if (!snapshot || !snapshot.header) {
    return { status: 404, body: { ok: false, code: 'not-found', message: 'stored session header is unavailable' } };
  }
  if (isLive(ctx, sessionId)) {
    return {
      status: 409,
      body: { ok: false, code: 'session-live', message: 'the session is still live in this Host; switch to another conversation or restart the app first' },
    };
  }

  const root = typeof persistence.root === 'string' && persistence.root.length > 0 ? persistence.root : defaultSessionRoot();
  let sessionDir;
  try {
    sessionDir = resolveSessionDir(root, snapshot.header);
  } catch (error) {
    return { status: 500, body: { ok: false, code: 'unsafe-path', message: error instanceof Error ? error.message : String(error) } };
  }
  try {
    const stat = await fsp.stat(sessionDir);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch (error) {
    return {
      status: 404,
      body: { ok: false, code: 'files-missing', message: `session directory not found: ${sessionDir}`, detail: error instanceof Error ? error.message : String(error) },
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashRoot = path.resolve(`${root}.trash`);
  const trashDir = path.join(trashRoot, `${stamp}-${encodeSegment(sessionId)}`);
  if (options.dryRun === true) {
    return { status: 200, body: { ok: true, dryRun: true, sessionId, sessionDir, trashDir, warnings: [] } };
  }
  const warnings = await forgetInWorkspaces(ctx, sessionId);
  try {
    await fsp.mkdir(trashRoot, { recursive: true });
    await fsp.rename(sessionDir, trashDir);
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        code: 'move-failed',
        message: error instanceof Error ? error.message : String(error),
        detail: isWindows ? 'a running process may still hold the session file open' : undefined,
      },
    };
  }
  return {
    status: 200,
    body: { ok: true, sessionId, trashedPath: trashDir, warnings },
  };
}

/** Mount the local delete route. */
export function apply(ctx) {
  const marker = path.join(os.tmpdir(), 'dsh-delete-conversation.mounted.log');
  const note = (line) => {
    void fsp.appendFile(marker, `${new Date().toISOString()} ${line}\n`).catch(() => {});
  };
  if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
    note('apply: webServer service is missing');
    return;
  }
  note('mounted');

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, code: 'method-not-allowed' });
              return;
            }
            if (!isLoopbackOrigin(req.headers.origin)) {
              sendJson(res, 403, { ok: false, code: 'forbidden-origin' });
              return;
            }
            if (req.headers['x-dsh-delete-conversation'] !== '1') {
              sendJson(res, 403, { ok: false, code: 'missing-header' });
              return;
            }
            const url = new URL(req.url ?? ROUTE, 'http://127.0.0.1');
            const result = await deleteConversation(ctx, url.searchParams.get('sessionId') ?? '', {
              dryRun: url.searchParams.get('dryRun') === '1',
            });
            sendJson(res, result.status, result.body);
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              code: 'internal',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    'delete-conversation: local route',
  );
}
