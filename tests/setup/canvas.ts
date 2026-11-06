const NOOP = (): void => undefined;

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const defaults: Record<string, unknown> = {
    canvas,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDashOffset: 0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return new Proxy(defaults, {
    get(target, property) {
      if (property in target) {
        return target[property as string];
      }
      if (property === 'measureText') {
        return () => ({ width: 0 });
      }
      if (property === 'getImageData') {
        return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
      }
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => ({ addColorStop: NOOP });
      }
      if (property === 'createPattern') {
        return () => null;
      }
      return NOOP;
    },
    set(target, property, value) {
      target[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement, contextId: string) {
      return contextId === '2d' ? canvasContext(this) : null;
    },
  });
}
