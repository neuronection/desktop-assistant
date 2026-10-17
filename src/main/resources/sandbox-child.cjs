'use strict';
// The Tier-2 sandbox child (ADR-0030 clause 2, capability-rpc/1). Spawned
// by path with a scrubbed environment and cwd inside the pack's sandbox
// workdir. Stdlib only — it deliberately imports nothing from the app, so
// host config, secrets and code cannot reach it even by accident.
//
// Frozen module surface: pack code runs in a fresh vm context whose only
// non-standard global is `capability` (the RPC client) plus `SandboxError`.
// The client is BUILT INSIDE the context and the two host primitives it
// needs are passed as closure parameters, so no host function object is
// reachable from pack code (the `.constructor.constructor` escape dies).
// There is no require, no process, no fetch, no timers, no dynamic import.
//
// Digest law: both pins are re-derived BEFORE any pack byte runs; a
// mismatch exits 2 (the sandbox never runs drifted content).

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROTOCOL_VERSION = 1;
const RPC_LINE_MAX_BYTES = 1048576;
const MANIFEST_MAX_BYTES = 524288;
const ENTRY_MAX_BYTES = 262144;
const CONTENT_TOTAL_MAX_BYTES = 2097152;
const INPUT_MAX_BYTES = 262144;
const OUTPUT_MAX_BYTES = 1048576;
const ERROR_DETAIL_MAX_CHARS = 500;
const MAX_PROTOCOL_VIOLATIONS = 3;
const INVOCATION_OP_PATTERN = /^[a-z][a-z0-9:._-]{0,63}$/;

const ERROR_CODES = new Set([
  'not-ready', 'needs-secret', 'invalid', 'unsupported', 'io', 'not-found', 'path-denied',
  'net-denied', 'auth', 'rate-limited', 'unreachable', 'protocol', 'provider', 'budget', 'canceled',
]);
const RETRYABLE = new Set(['yes', 'no', 'after-delay', 'after-config-change']);
const HOST_METHODS = new Set(['ext.invoke', 'ext.dispose']);

function fail(message) {
  process.stderr.write(`sandbox-child: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    args[argv[i]] = argv[i + 1];
  }
  return args;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function manifestDigestOf(root) {
  const raw = fs.readFileSync(path.join(root, 'manifest.json'));
  if (raw.byteLength > MANIFEST_MAX_BYTES) {
    fail('manifest exceeds manifestMaxBytes');
  }
  return sha256(JSON.stringify(JSON.parse(raw.toString('utf8'))));
}

function digestTree(root) {
  const digest = createHash('sha256');
  let total = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (relative.split('/').includes('.git')) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isFile()) {
        if (entry.isDirectory()) {
          walk(full);
        }
        continue;
      }
      const stats = fs.statSync(full);
      total += stats.size;
      if (total > CONTENT_TOTAL_MAX_BYTES) {
        fail('content exceeds the total byte budget');
      }
      digest.update(relative);
      digest.update('\0');
      digest.update(String(stats.size));
      digest.update('\0');
      digest.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return digest.digest('hex');
}

function cappedDetail(data) {
  let text;
  try {
    text = JSON.stringify(data);
  } catch {
    text = '{}';
  }
  return text.slice(0, ERROR_DETAIL_MAX_CHARS);
}

const CLIENT_SOURCE = `
class SandboxError extends Error {
  constructor(envelope) {
    super(typeof envelope.detail === 'string' ? envelope.detail : '');
    this.name = 'SandboxError';
    this.code = envelope.code;
    this.detail = envelope.detail;
    this.retryable = envelope.retryable;
    this.retryAfterMs = envelope.retryAfterMs;
  }
}
let active = false;
let nextId = 1;
const pending = new Map();
function call(method, params) {
  if (!active) {
    return Promise.reject(new SandboxError({
      code: 'protocol', detail: 'capability calls are legal only inside an invoke', retryable: 'after-config-change',
    }));
  }
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    __send({ v: 1, type: 'call', id, method, params });
  });
}
function event(method, params) {
  if (!active) {
    return;
  }
  __send({ v: 1, type: 'event', id: 'e' + nextId, method, params });
  nextId += 1;
}
const capability = {
  stateGet(key) { return call('cap.state.get', { key }).then((r) => (r.value === undefined ? null : r.value)); },
  stateSet(key, value) { return call('cap.state.set', { key, value }).then((r) => r.bytes || 0); },
  itemsEmit(items) { return call('cap.items.emit', { items }).then((r) => r.accepted || 0); },
  secretsNeed(slot) { return call('cap.secrets.need', { slot }).then((r) => r.injectedAs || ''); },
  netFetch(url, options) {
    const params = { url };
    if (options && options.method !== undefined) params.method = options.method;
    if (options && options.headers !== undefined) params.headers = options.headers;
    if (options && options.body !== undefined) params.body = options.body;
    if (options && options.maxBytes !== undefined) params.maxBytes = options.maxBytes;
    return call('cap.net.fetch', params);
  },
  progress(percent, messageKey) {
    const params = {};
    if (percent !== undefined && percent !== null) params.percent = percent;
    if (messageKey !== undefined && messageKey !== null) params.messageKey = messageKey;
    event('evt.progress', params);
  },
  log(level, message) { event('evt.log', { level, message: String(message).slice(0, 500) }); },
};
return { capability, SandboxError, resolveReply: (id, message) => {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  if (message.type === 'result') entry.resolve(message.result || {});
  else entry.reject(new SandboxError(message.error || {}));
  return true;
}, setActive: (value) => { active = value; } };
`;

function buildRuntime(send) {
  const context = vm.createContext({});
  const factory = vm.compileFunction(CLIENT_SOURCE, ['__send'], { parsingContext: context });
  const runtime = factory(send);
  context.capability = runtime.capability;
  context.SandboxError = runtime.SandboxError;
  return { context, runtime };
}

function createTransport() {
  if (process.parentPort) {
    const port = process.parentPort;
    const listeners = new Set();
    port.on('message', (event) => {
      for (const listener of listeners) {
        listener(event.data);
      }
    });
    let violations = 0;
    return {
      kind: 'port',
      send(message) {
        const line = JSON.stringify(message);
        if (line.length > RPC_LINE_MAX_BYTES) {
          throw new Error('outbound message exceeds rpcLineMaxBytes');
        }
        port.postMessage(JSON.parse(line));
      },
      onMessage(listener) {
        listeners.add(listener);
      },
      countViolation() {
        violations += 1;
        return violations;
      },
    };
  }
  let buffer = '';
  const listeners = new Set();
  let violations = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        if (buffer.length > RPC_LINE_MAX_BYTES + 2) {
          buffer = '';
          deliver(null);
        }
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length > RPC_LINE_MAX_BYTES) {
        deliver(null);
        continue;
      }
      let doc = null;
      try {
        doc = JSON.parse(line);
      } catch {
        doc = null;
      }
      deliver(doc);
    }
  });
  const deliver = (doc) => {
    for (const listener of listeners) {
      listener(doc);
    }
  };
  process.on('uncaughtException', () => process.exit(70));
  return {
    kind: 'stdio',
    send(message) {
      const line = JSON.stringify(message);
      if (line.length > RPC_LINE_MAX_BYTES) {
        throw new Error('outbound message exceeds rpcLineMaxBytes');
      }
      process.stdout.write(line + '\n');
    },
    onMessage(listener) {
      listeners.add(listener);
    },
    countViolation() {
      violations += 1;
      return violations;
    },
  };
}

const structured = (value) => {
  const round = JSON.parse(JSON.stringify(value));
  if (JSON.stringify(round).length > OUTPUT_MAX_BYTES) {
    throw Object.assign(new Error('output exceeds the byte cap'), { code: 'invalid' });
  }
  return round;
};

async function main() {
  const args = parseArgs(process.argv);
  if (args['--protocol'] !== 'capability-rpc/1') {
    fail('unsupported protocol');
  }
  const contentDir = args['--content-dir'];
  const entryRelative = args['--entry'];
  if (!contentDir || !entryRelative || entryRelative.includes('..') || path.isAbsolute(entryRelative)) {
    fail('bad spawn arguments');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(contentDir, 'manifest.json'), 'utf8'));
  } catch {
    fail('manifest unreadable');
  }
  if (manifestDigestOf(contentDir) !== args['--manifest-digest']) {
    fail('manifest digest drift');
  }
  if (digestTree(contentDir) !== args['--content-digest']) {
    fail('content digest drift');
  }

  const sink = () => {};
  Object.defineProperty(globalThis, 'console', {
    value: { log: sink, info: sink, warn: sink, error: sink, debug: sink, trace: sink, dir: sink, table: sink },
    writable: false,
    configurable: false,
  });
  const transport = createTransport();
  let violations = 0;
  const violate = (reason) => {
    violations += 1;
    process.stderr.write(`sandbox-child: protocol violation: ${String(reason).slice(0, 200)}\n`);
    if (violations >= MAX_PROTOCOL_VIOLATIONS) {
      process.exit(3);
    }
  };

  let loadError = null;
  let handlers = null;
  let sandbox = null;
  try {
    const entryPath = path.join(contentDir, entryRelative);
    if (!entryPath.startsWith(contentDir + path.sep)) {
      throw Object.assign(new Error('entry escapes the content dir'), { code: 'path-denied' });
    }
    const source = fs.readFileSync(entryPath);
    if (source.byteLength > ENTRY_MAX_BYTES) {
      throw Object.assign(new Error('entry exceeds the size budget'), { code: 'invalid' });
    }
    sandbox = buildRuntime((message) => transport.send(message));
    const script = new vm.Script(source.toString('utf8'), { filename: entryRelative });
    script.runInContext(sandbox.context);
    const resolved = vm.runInContext('typeof handlers === "undefined" ? null : handlers', sandbox.context);
    if (resolved === null || typeof resolved !== 'object') {
      throw Object.assign(new Error('the entry must define a handlers object'), { code: 'invalid' });
    }
    handlers = resolved;
  } catch (error) {
    loadError = {
      code: ERROR_CODES.has(error && error.code) ? error.code : 'invalid',
      detail: cappedDetail({ stage: 'load', error: error && error.message ? String(error.message).slice(0, 200) : 'unknown' }),
      retryable: 'no',
    };
  }

  const queue = [];
  let wake = null;
  transport.onMessage((doc) => {
    if (doc === null || typeof doc !== 'object') {
      violate('line is not a JSON object');
      return;
    }
    if (doc.v !== PROTOCOL_VERSION) {
      process.exit(5);
    }
    if (doc.type !== 'call' && sandbox && sandbox.runtime.resolveReply(doc.id, doc)) {
      return;
    }
    queue.push(doc);
    if (wake) {
      wake();
    }
  });
  const nextMessage = () =>
    new Promise((resolve) => {
      if (queue.length > 0) {
        resolve(queue.shift());
        return;
      }
      wake = () => {
        wake = null;
        resolve(queue.shift());
      };
    });

  const identity = {
    id: String(manifest.id ?? ''),
    version: String(manifest.version ?? ''),
    digest: String(args['--manifest-digest']),
    ...(loadError ? { loadError } : {}),
  };

  for (;;) {
    const doc = await nextMessage();
    if (doc === null) {
      continue;
    }
    if (doc.type !== 'call' || !HOST_METHODS.has(doc.method) || typeof doc.params !== 'object' || doc.params === null) {
      violate('unexpected message toward the extension');
      continue;
    }
    const mid = doc.id;
    if (doc.method === 'ext.dispose') {
      transport.send({ v: PROTOCOL_VERSION, type: 'result', id: mid, result: {} });
      return 0;
    }
    const params = doc.params;
    const op = String(params.op ?? '');
    if (op === 'hello') {
      transport.send({ v: PROTOCOL_VERSION, type: 'result', id: mid, result: { output: identity } });
      continue;
    }
    if (loadError !== null) {
      transport.send({ v: PROTOCOL_VERSION, type: 'error', id: mid, method: doc.method, error: loadError });
      continue;
    }
    if (!INVOCATION_OP_PATTERN.test(op) || !handlers || typeof handlers[op] !== 'function') {
      transport.send({
        v: PROTOCOL_VERSION, type: 'error', id: mid, method: doc.method,
        error: { code: 'unsupported', detail: cappedDetail({ op }), retryable: 'no' },
      });
      continue;
    }
    const input = params.input;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      transport.send({
        v: PROTOCOL_VERSION, type: 'error', id: mid, method: doc.method,
        error: { code: 'invalid', detail: cappedDetail({ field: 'input' }), retryable: 'no' },
      });
      continue;
    }
    if (JSON.stringify(input).length > INPUT_MAX_BYTES) {
      transport.send({
        v: PROTOCOL_VERSION, type: 'error', id: mid, method: doc.method,
        error: { code: 'invalid', detail: cappedDetail({ field: 'input', reason: 'byte cap' }), retryable: 'no' },
      });
      continue;
    }
    sandbox.runtime.setActive(true);
    try {
      const output = await handlers[op](input);
      if (typeof output !== 'object' || output === null || Array.isArray(output)) {
        throw Object.assign(new Error('handlers must return an object'), { code: 'invalid' });
      }
      transport.send({ v: PROTOCOL_VERSION, type: 'result', id: mid, result: { output: structured(output) } });
    } catch (error) {
      const envelope =
        error instanceof sandbox.runtime.SandboxError
          ? {
              code: ERROR_CODES.has(error.code) ? error.code : 'provider',
              detail: cappedDetail({ error: error.detail }),
              retryable: RETRYABLE.has(error.retryable) ? error.retryable : 'no',
              ...(Number.isInteger(error.retryAfterMs) && error.retryAfterMs >= 0 ? { retryAfterMs: error.retryAfterMs } : {}),
            }
          : {
              code: ERROR_CODES.has(error && error.code) ? error.code : 'provider',
              detail: cappedDetail({ exceptionType: error && error.name ? error.name : 'Error' }),
              retryable: 'no',
            };
      transport.send({ v: PROTOCOL_VERSION, type: 'error', id: mid, method: doc.method, error: envelope });
    } finally {
      sandbox.runtime.setActive(false);
    }
  }
}

main().then((code) => process.exit(code), () => process.exit(70));
