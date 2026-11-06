/**
 * A headset is treated as full-duplex; speakers fall back to half-duplex
 * unless the user explicitly allows barge-in on speakers (plan 25 D3).
 */
export async function detectFullDuplexOutput(bargeInOnSpeakers: boolean): Promise<boolean> {
  if (bargeInOnSpeakers) {
    return true;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(
      (device) => device.kind === 'audiooutput' && /head|ear|bud|airpod|bluetooth/i.test(device.label)
    );
  } catch {
    return false;
  }
}
