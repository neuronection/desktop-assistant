'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUT_CAPACITY = 8192;

function createRuntime(dir) {
  const createNeedle = require(path.join(dir, 'needle.js'));
  const wasmBinary = fs.readFileSync(path.join(dir, 'needle.wasm'));
  let mod = null;
  let loadFn = null;
  let initFn = null;
  let completeFn = null;
  let embedFn = null;
  let resetFn = null;
  let outPtr = 0;
  let weightsPtr = 0;

  async function init() {
    if (mod) {
      return;
    }
    mod = await createNeedle({ wasmBinary });
    outPtr = mod._malloc(OUT_CAPACITY);
    loadFn = mod.cwrap('needle_load', 'number', ['number', 'number']);
    initFn = mod.cwrap('needle_init', 'number', ['string', 'string', 'string']);
    completeFn = mod.cwrap('needle_complete', 'number', ['string', 'number', 'number', 'number']);
    embedFn = mod.cwrap('needle_embed', 'number', ['string', 'number', 'number']);
    resetFn = mod.cwrap('needle_reset', 'void', []);
  }

  function loadWeights(weightsPath) {
    const bytes = fs.readFileSync(weightsPath);
    weightsPtr = mod._malloc(bytes.length);
    mod.HEAPU8.set(bytes, weightsPtr);
    return loadFn(weightsPtr, BigInt(bytes.length));
  }

  function callInit(systemPrompt, toolsJson) {
    return initFn(systemPrompt ?? '', toolsJson ?? '[]', '');
  }

  function callComplete(input, maxNewTokens) {
    const rc = completeFn(input, maxNewTokens, outPtr, OUT_CAPACITY);
    if (rc < 0) {
      throw new Error(`needle_complete failed (${rc})`);
    }
    return mod.UTF8ToString(outPtr);
  }

  function callEmbed(input) {
    return embedFn(input, 0, 0);
  }

  function callReset() {
    resetFn();
  }

  function dispose() {
    if (mod && weightsPtr) {
      mod._free(weightsPtr);
      weightsPtr = 0;
    }
    mod = null;
  }

  return { init, loadWeights, callInit, callComplete, callEmbed, callReset, dispose };
}

module.exports = { createRuntime };
