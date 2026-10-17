handlers = {
  'command:convert'(input) {
    const value = Number(input.args.argv[0] ?? 0);
    if (!Number.isFinite(value)) {
      throw new capability.SandboxError({ code: 'invalid', detail: 'give a number', retryable: 'no' });
    }
    return { converted: value * (input.config.rate ?? 2), unit: input.config.unit ?? 'km' };
  },
  async 'command:full-surface'(input) {
    await capability.stateSet('last', input.args.argv[0] ?? null);
    const last = await capability.stateGet('last');
    const accepted = await capability.itemsEmit([{ kind: 'conversion', value: last }]);
    capability.progress(50, 'refpack.progress.half');
    capability.log('info', 'halfway through the full-surface probe');
    let secretStatus;
    try {
      secretStatus = { injectedAs: await capability.secretsNeed('api-token') };
    } catch (error) {
      secretStatus = { code: error.code, retryable: error.retryable };
    }
    let net;
    try {
      await capability.netFetch('https://example.invalid/');
      net = 'allowed';
    } catch (error) {
      net = error.code;
    }
    return { last, accepted, secretStatus, net };
  },
};
