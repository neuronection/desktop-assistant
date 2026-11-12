import { evaluateExpression } from './evaluate';

export type UnitCategory =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'volume'
  | 'data'
  | 'speed'
  | 'area'
  | 'time'
  | 'angle';

export type ConversionResult =
  | { kind: 'converted'; value: number; symbol: string; category: UnitCategory }
  | { kind: 'error'; error: string }
  | { kind: 'none' };

interface UnitSpec {
  category: UnitCategory;
  symbol: string;
  aliases: string[];
  factor?: number;
  toBase?: (value: number) => number;
  fromBase?: (value: number) => number;
}

const UNITS: UnitSpec[] = [
  {
    category: 'length',
    symbol: 'm',
    aliases: ['m', 'meter', 'meters', 'metre', 'metres'],
    factor: 1,
  },
  { category: 'length', symbol: 'km', aliases: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'], factor: 1000 },
  { category: 'length', symbol: 'cm', aliases: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'], factor: 0.01 },
  { category: 'length', symbol: 'mm', aliases: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'], factor: 0.001 },
  { category: 'length', symbol: 'µm', aliases: ['um', 'µm', 'micrometer', 'micrometers', 'micron', 'microns'], factor: 1e-6 },
  { category: 'length', symbol: 'nm', aliases: ['nm', 'nanometer', 'nanometers'], factor: 1e-9 },
  {
    category: 'length',
    symbol: 'mi',
    aliases: ['mi', 'mile', 'miles'],
    factor: 1609.344,
  },
  { category: 'length', symbol: 'yd', aliases: ['yd', 'yard', 'yards'], factor: 0.9144 },
  { category: 'length', symbol: 'ft', aliases: ['ft', 'foot', 'feet'], factor: 0.3048 },
  { category: 'length', symbol: 'in', aliases: ['in', 'inch', 'inches'], factor: 0.0254 },
  { category: 'length', symbol: 'nmi', aliases: ['nmi', 'nauticalmile', 'nauticalmiles'], factor: 1852 },
  { category: 'mass', symbol: 'kg', aliases: ['kg', 'kilogram', 'kilograms'], factor: 1 },
  { category: 'mass', symbol: 'g', aliases: ['g', 'gram', 'grams'], factor: 0.001 },
  { category: 'mass', symbol: 'mg', aliases: ['mg', 'milligram', 'milligrams'], factor: 1e-6 },
  { category: 'mass', symbol: 't', aliases: ['t', 'tonne', 'tonnes', 'ton', 'tons', 'metrictons'], factor: 1000 },
  { category: 'mass', symbol: 'lb', aliases: ['lb', 'lbs', 'pound', 'pounds'], factor: 0.45359237 },
  { category: 'mass', symbol: 'oz', aliases: ['oz', 'ounce', 'ounces'], factor: 0.028349523125 },
  { category: 'mass', symbol: 'st', aliases: ['st', 'stone', 'stones'], factor: 6.35029318 },
  { category: 'volume', symbol: 'L', aliases: ['l', 'liter', 'liters', 'litre', 'litres'], factor: 1 },
  { category: 'volume', symbol: 'mL', aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], factor: 0.001 },
  { category: 'volume', symbol: 'cL', aliases: ['cl', 'centiliter', 'centiliters'], factor: 0.01 },
  { category: 'volume', symbol: 'dL', aliases: ['dl', 'deciliter', 'deciliters'], factor: 0.1 },
  { category: 'volume', symbol: 'm³', aliases: ['m3', 'cubicmeter', 'cubicmeters'], factor: 1000 },
  { category: 'volume', symbol: 'gal', aliases: ['gal', 'gallon', 'gallons'], factor: 3.785411784 },
  { category: 'volume', symbol: 'qt', aliases: ['qt', 'quart', 'quarts'], factor: 0.946352946 },
  { category: 'volume', symbol: 'pt', aliases: ['pt', 'pint', 'pints'], factor: 0.473176473 },
  { category: 'volume', symbol: 'cup', aliases: ['cup', 'cups'], factor: 0.2365882365 },
  { category: 'volume', symbol: 'fl oz', aliases: ['floz', 'fluidounce', 'fluidounces'], factor: 0.0295735295625 },
  { category: 'volume', symbol: 'tbsp', aliases: ['tbsp', 'tablespoon', 'tablespoons'], factor: 0.01478676478125 },
  { category: 'volume', symbol: 'tsp', aliases: ['tsp', 'teaspoon', 'teaspoons'], factor: 0.00492892159375 },
  { category: 'data', symbol: 'B', aliases: ['b', 'byte', 'bytes'], factor: 1 },
  { category: 'data', symbol: 'bit', aliases: ['bit', 'bits'], factor: 0.125 },
  { category: 'data', symbol: 'KB', aliases: ['kb', 'kilobyte', 'kilobytes'], factor: 1000 },
  { category: 'data', symbol: 'MB', aliases: ['mb', 'megabyte', 'megabytes'], factor: 1e6 },
  { category: 'data', symbol: 'GB', aliases: ['gb', 'gigabyte', 'gigabytes'], factor: 1e9 },
  { category: 'data', symbol: 'TB', aliases: ['tb', 'terabyte', 'terabytes'], factor: 1e12 },
  { category: 'data', symbol: 'PB', aliases: ['pb', 'petabyte', 'petabytes'], factor: 1e15 },
  { category: 'data', symbol: 'KiB', aliases: ['kib', 'kibibyte', 'kibibytes'], factor: 1024 },
  { category: 'data', symbol: 'MiB', aliases: ['mib', 'mebibyte', 'mebibytes'], factor: 1024 ** 2 },
  { category: 'data', symbol: 'GiB', aliases: ['gib', 'gibibyte', 'gibibytes'], factor: 1024 ** 3 },
  { category: 'data', symbol: 'TiB', aliases: ['tib', 'tebibyte', 'tebibytes'], factor: 1024 ** 4 },
  { category: 'speed', symbol: 'm/s', aliases: ['mps', 'meterspersecond', 'metrespersecond'], factor: 1 },
  { category: 'speed', symbol: 'km/h', aliases: ['kph', 'kmh', 'kilometersperhour', 'kilometresperhour'], factor: 1 / 3.6 },
  { category: 'speed', symbol: 'mph', aliases: ['mph', 'milesperhour'], factor: 0.44704 },
  { category: 'speed', symbol: 'kn', aliases: ['kn', 'knot', 'knots'], factor: 0.514444444 },
  { category: 'area', symbol: 'm²', aliases: ['m2', 'sqm', 'squaremeter', 'squaremeters'], factor: 1 },
  { category: 'area', symbol: 'cm²', aliases: ['cm2', 'sqcm'], factor: 1e-4 },
  { category: 'area', symbol: 'km²', aliases: ['km2', 'sqkm'], factor: 1e6 },
  { category: 'area', symbol: 'ha', aliases: ['ha', 'hectare', 'hectares'], factor: 10000 },
  { category: 'area', symbol: 'ac', aliases: ['ac', 'acre', 'acres'], factor: 4046.8564224 },
  { category: 'area', symbol: 'ft²', aliases: ['ft2', 'sqft'], factor: 0.09290304 },
  { category: 'area', symbol: 'mi²', aliases: ['mi2', 'sqmi'], factor: 2589988.110336 },
  { category: 'time', symbol: 'ms', aliases: ['ms', 'millisecond', 'milliseconds'], factor: 0.001 },
  { category: 'time', symbol: 's', aliases: ['s', 'sec', 'secs', 'second', 'seconds'], factor: 1 },
  { category: 'time', symbol: 'min', aliases: ['min', 'mins', 'minute', 'minutes'], factor: 60 },
  { category: 'time', symbol: 'h', aliases: ['h', 'hr', 'hrs', 'hour', 'hours'], factor: 3600 },
  { category: 'time', symbol: 'd', aliases: ['d', 'day', 'days'], factor: 86400 },
  { category: 'time', symbol: 'wk', aliases: ['wk', 'week', 'weeks'], factor: 604800 },
  { category: 'angle', symbol: 'rad', aliases: ['rad', 'radian', 'radians'], factor: 1 },
  { category: 'angle', symbol: '°', aliases: ['deg', 'degree', 'degrees', '°'], factor: Math.PI / 180 },
  {
    category: 'temperature',
    symbol: '°C',
    aliases: ['c', '°c', 'celsius', 'centigrade'],
    toBase: (value) => value,
    fromBase: (value) => value,
  },
  {
    category: 'temperature',
    symbol: '°F',
    aliases: ['f', '°f', 'fahrenheit'],
    toBase: (value) => ((value - 32) * 5) / 9,
    fromBase: (value) => (value * 9) / 5 + 32,
  },
  {
    category: 'temperature',
    symbol: 'K',
    aliases: ['k', 'kelvin'],
    toBase: (value) => value - 273.15,
    fromBase: (value) => value + 273.15,
  },
];

const UNIT_INDEX = new Map<string, UnitSpec>();

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[.\s_]/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/º/g, '°');
}

for (const unit of UNITS) {
  for (const alias of unit.aliases) {
    UNIT_INDEX.set(normalizeToken(alias), unit);
  }
}

const SEPARATORS = [' to ', ' -> ', ' → ', ' into ', ' as ', ' in '];

const NUMBER_UNIT = /^(.*?)([a-zA-Zµ°][a-zA-Z0-9µ°]*)$/;

function splitConversion(input: string): { left: string; right: string } | null {
  const lower = input.toLowerCase();
  for (const separator of SEPARATORS) {
    const index = lower.indexOf(separator);
    if (index > 0) {
      const right = input.slice(index + separator.length).trim();
      if (right.length === 0) {
        return null;
      }
      return { left: input.slice(0, index).trim(), right };
    }
  }
  return null;
}

function parseLeft(left: string): { expression: string; unit: UnitSpec } | { error: string } {
  const match = NUMBER_UNIT.exec(left);
  if (!match) {
    return { error: `could not read '${left}' as a number and unit` };
  }
  const expression = (match[1] ?? '').trim();
  const rawUnit = (match[2] ?? '').trim();
  if (!expression) {
    return { error: `could not read '${left}' as a number and unit` };
  }
  const unit = UNIT_INDEX.get(normalizeToken(rawUnit));
  if (!unit) {
    return { error: `unknown unit '${rawUnit}'` };
  }
  return { expression, unit };
}

function parseRight(right: string): { unit: UnitSpec } | { error: string } {
  const raw = right.trim();
  const unit = UNIT_INDEX.get(normalizeToken(raw));
  if (!unit) {
    return { error: `unknown unit '${raw}'` };
  }
  return { unit };
}

export function convertUnits(input: string): ConversionResult {
  const trimmed = input.trim().replace(/^convert\s+/i, '');
  const split = splitConversion(trimmed);
  if (!split) {
    return { kind: 'none' };
  }
  const left = parseLeft(split.left);
  if ('error' in left) {
    return { kind: 'error', error: left.error };
  }
  const right = parseRight(split.right);
  if ('error' in right) {
    return { kind: 'error', error: right.error };
  }
  if (left.unit.category !== right.unit.category) {
    return {
      kind: 'error',
      error: `cannot convert ${left.unit.category} to ${right.unit.category}`,
    };
  }
  const amount = evaluateExpression(left.expression);
  if (!amount.ok) {
    return { kind: 'error', error: amount.error };
  }
  const base = left.unit.toBase ? left.unit.toBase(amount.value) : amount.value * (left.unit.factor ?? 1);
  const value = right.unit.fromBase ? right.unit.fromBase(base) : base / (right.unit.factor ?? 1);
  if (!Number.isFinite(value)) {
    return { kind: 'error', error: 'number out of range' };
  }
  return {
    kind: 'converted',
    value,
    symbol: right.unit.symbol,
    category: right.unit.category,
  };
}
