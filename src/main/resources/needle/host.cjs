'use strict';

const { createRuntime } = require('./host-core.cjs');

let runtime = null;

async function ensureRuntime() {
  if (!runtime) {
    runtime = createRuntime(__dirname);
    await runtime.init();
  }
  return runtime;
}

function post(message) {
  process.parentPort.postMessage(message);
}

process.parentPort.on('message', async (event) => {
  const { id, op, payload } = event.data ?? {};
  if (id === undefined || typeof op !== 'string') {
    return;
  }
  try {
    const rt = await ensureRuntime();
    let result;
    switch (op) {
      case 'load': {
        const rc = rt.loadWeights(payload.weightsPath);
        if (rc < 0) {
          throw new Error(`needle_load failed (${rc})`);
        }
        result = rc;
        break;
      }
      case 'init': {
        const rc = rt.callInit(payload.systemPrompt, payload.toolsJson);
        if (rc < 0) {
          throw new Error(`needle_init failed (${rc})`);
        }
        result = rc;
        break;
      }
      case 'complete': {
        result = rt.callComplete(payload.input, payload.maxNewTokens ?? 512);
        break;
      }
      case 'reset': {
        rt.callReset();
        result = 0;
        break;
      }
      default:
        throw new Error(`unknown op ${op}`);
    }
    post({ id, ok: true, result });
  } catch (error) {
    post({ id, ok: false, error: String((error && error.message) || error) });
  }
});
