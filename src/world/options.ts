export const WORLD_GENERATION_STYLES = ['continents', 'pangaea', 'fractal'] as const;
export type WorldGenerationStyle = typeof WORLD_GENERATION_STYLES[number];
export const DEFAULT_WORLD_STYLE: WorldGenerationStyle = 'fractal';
export const LEDGES_ENABLED = (import.meta.env?.VITE_ENABLE_LEDGES
  ?? (typeof process === 'undefined' ? undefined : process.env.VITE_ENABLE_LEDGES)) === 'true';
export const WORLD_STYLE_NAMES: Record<WorldGenerationStyle, string> = {
  continents: 'Continents', pangaea: 'Pangaea', fractal: 'Fractal',
};
export const LANDFORM_KINDS = ['river-basin', 'folded-range', 'dissected-plateau', 'rift-lakes', 'glacial-coast', 'rolling-uplands'] as const;
export type LandformKind = typeof LANDFORM_KINDS[number];
export type LandformFamily = 'mixed' | LandformKind;
export const LANDFORM_NAMES: Record<LandformFamily, string> = {
  mixed: 'Mixed regions', 'river-basin': 'River basins', 'folded-range': 'Folded ranges',
  'dissected-plateau': 'Dissected plateaus', 'rift-lakes': 'Rift valleys and lakes',
  'glacial-coast': 'Glacial coasts', 'rolling-uplands': 'Rolling uplands',
};

/** Defaults are the approved Fractal gallery sample #20 (FRACTAL-STUDY-2026).
 * Public controls for every landscape stage. Distances are game-grid scales,
 * not calibrated physical units. Geometry/access safety limits stay internal. */
export const LANDSCAPE_CONTROLS = {
  seaLevel: { group: 'World', label: 'Sea level (% water target)', default: 70, min: 60, max: 80 },
  age: { group: 'World', label: 'World age (billion years)', default: 4, min: 3, max: 5 },
  climate: { group: 'World', label: 'Climate (0 arid / 1 normal / 2 wet)', default: 1, min: 0, max: 2 },
  temperature: { group: 'World', label: 'Temperature (0 warm / 1 temperate / 2 cool)', default: 1, min: 0, max: 2 },
  landScale: { group: 'Coasts', label: 'Landmass size', default: 1.021, min: .85, max: 1.15 },
  coastRoughness: { group: 'Coasts', label: 'Coast roughness', default: 0.7815, min: .6, max: 1.5 },
  islandDensity: { group: 'Coasts', label: 'Island density', default: 0.955, min: .3, max: 1.8 },
  islandSize: { group: 'Coasts', label: 'Island size', default: 0.871, min: .6, max: 1.5 },
  equatorPosition: { group: 'Climate', label: 'Equator (map height)', default: 0.7585, min: .45, max: .8 },
  equatorWidth: { group: 'Climate', label: 'Warm belt width', default: 0.2423, min: .2, max: .45 },
  latitudeInfluence: { group: 'Climate', label: 'Latitude influence', default: 0.2144, min: .16, max: .4 },
  climateVariation: { group: 'Climate', label: 'Climate variation', default: 0.3758, min: .18, max: .4 },
  climatePatchScale: { group: 'Climate', label: 'Climate patch size', default: 0.7883, min: .65, max: 1.6 },
  moisture: { group: 'Climate', label: 'Background moisture', default: 0.5154, min: .44, max: .62 },
  desertThreshold: { group: 'Climate', label: 'Desert aridity threshold', default: 0.4759, min: .43, max: .57 },
  forestThreshold: { group: 'Woodland', label: 'Woodland threshold', default: 0.5668, min: .48, max: .61 },
  forestPatchScale: { group: 'Woodland', label: 'Woodland patch size', default: 0.9499, min: .65, max: 1.6 },
  forestNorthBias: { group: 'Woodland', label: 'Northern woodland bias', default: 0.1114, min: .06, max: .2 },
  riparianBoost: { group: 'Woodland', label: 'Freshwater moisture boost', default: 0.2281, min: .08, max: .26 },
  ruggednessScale: { group: 'Relief', label: 'Rugged province size', default: 0.9685, min: .65, max: 1.6 },
  reliefCoverage: { group: 'Ledges', label: 'Ledge coverage', default: 0.0924, min: .04, max: .14 },
  mountainShare: { group: 'Mountains', label: 'Mountain share of relief', default: 0.2956, min: .25, max: .7 },
  mountainClumpShare: { group: 'Mountains', label: 'Compact mountain weight', default: 0.2669, min: .1, max: .7 },
  mountainStringShare: { group: 'Mountains', label: 'Broken mountain weight', default: 0.2074, min: .1, max: .7 },
  mountainLengthMin: { group: 'Mountains', label: 'Minimum mountain length', default: 20, min: 8, max: 24 },
  mountainLengthMax: { group: 'Mountains', label: 'Maximum mountain length', default: 56, min: 40, max: 110 },
  mountainWidth: { group: 'Mountains', label: 'Mountain chain width', default: 4.2879, min: 4, max: 6 },
  mountainBend: { group: 'Mountains', label: 'Mountain bend', default: 0.5625, min: .4, max: 2 },
  hillSize: { group: 'Hills', label: 'Hill size', default: 0.9581, min: .7, max: 1.5 },
  hillSpacing: { group: 'Hills', label: 'Hill spacing', default: 1.0009, min: .65, max: 1.5 },
  hillClustering: { group: 'Hills', label: 'Hill clustering', default: 0.8777, min: .4, max: .95 },
  lakeDensity: { group: 'Lakes', label: 'Lake density', default: 1.5499, min: .5, max: 1.7 },
  lakeSize: { group: 'Lakes', label: 'Lake size', default: 0.8319, min: .65, max: 1.5 },
  compactLakeAspectMax: { group: 'Lakes', label: 'Compact lake maximum aspect', default: 1.5773, min: 1.2, max: 2 },
  riverCount: { group: 'Rivers', label: 'River network density', default: 7, min: 3, max: 11 },
  riverWidth: { group: 'Rivers', label: 'River width', default: 1.2025, min: .7, max: 1.3 },
  riverMeander: { group: 'Rivers', label: 'River meander', default: 0.9306, min: .6, max: 1.5 },
  beachFraction: { group: 'Coasts', label: 'Sandy coastline share', default: 0.4255, min: .25, max: .7 },
  beachWidth: { group: 'Coasts', label: 'Beach width', default: 0.8142, min: .65, max: 1.3 },
  palmDensity: { group: 'Coasts', label: 'Beach palm density', default: 1.1131, min: .4, max: 1.6 },
  startSpacing: { group: 'Towns', label: 'Faction spacing strength', default: 0.795, min: .7, max: 1.3 },
  startRelaxations: { group: 'Towns', label: 'Faction spacing passes', default: 3, min: 1, max: 6 },
} as const;
export type LandscapeParameter = keyof typeof LANDSCAPE_CONTROLS;
export type LandscapeParameters = { [K in LandscapeParameter]: number };
export const DEFAULT_LANDSCAPE_PARAMETERS = Object.fromEntries(Object.entries(LANDSCAPE_CONTROLS)
  .map(([key, control]) => [key, control.default])) as LandscapeParameters;
/** World settings configure the existing terrain stages here, rather than in
 * the menu. Non-neutral settings own their related low-level controls; neutral
 * settings leave custom low-level values intact. Deriving from fixed defaults
 * makes resolution idempotent, including when regenerating a stored world.
 * Intermediate values interpolate between presets for the landscape editor. */
export function resolveLandscapeParameters(overrides: Partial<LandscapeParameters> = {}): LandscapeParameters {
  const parameters = { ...DEFAULT_LANDSCAPE_PARAMETERS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(LANDSCAPE_CONTROLS, key)) throw new RangeError(`Unknown landscape parameter: ${key}`);
    const name = key as LandscapeParameter, control = LANDSCAPE_CONTROLS[name];
    if (!Number.isFinite(value) || value < control.min || value > control.max)
      throw new RangeError(`${key} must be between ${control.min} and ${control.max}.`);
    parameters[name] = value;
  }
  const preset = (position: number, values: Partial<Record<LandscapeParameter, readonly [number, number]>>): void => {
    if (position === 0) return;
    for (const key of Object.keys(values) as LandscapeParameter[]) {
      const normal = DEFAULT_LANDSCAPE_PARAMETERS[key], [lower, upper] = values[key]!;
      parameters[key] = normal + Math.abs(position) * ((position < 0 ? lower : upper) - normal);
    }
  };
  // Sea level changes the continental coast envelope, preserving seeded shape
  // variation. Water coverage is a target, not a post-generation tile quota.
  preset((parameters.seaLevel - 70) / 10, { landScale: [1.15, .85] });
  // Young geology has more exposed ledges when the feature is enabled.
  preset(parameters.age - 4, { reliefCoverage: [.14, .04] });
  // Moisture feeds rainfall, drainage, biomes, vegetation and soil downstream.
  preset(parameters.climate - 1, { moisture: [.44, .62], desertThreshold: [.57, .43], forestThreshold: [.61, .48] });
  preset(parameters.temperature - 1, { equatorWidth: [.45, .2], latitudeInfluence: [.16, .4] });
  return parameters;
}
export interface WorldGenerationOptions {
  style?: WorldGenerationStyle;
  parameters?: Partial<LandscapeParameters>;
  landformFamily?: LandformFamily;
  /** Override the ledge feature flag for this generated world. */
  ledges?: boolean;
  /** Disable only for comparison studies of the underlying coastline. */
  riverDeltas?: boolean;
  /** Scenarios supply their own founding sites after generating natural terrain. */
  settlements?: boolean;
  /** A native meandering strait is cut before normal climate and ecology. */
  oceanChannelWidth?: number;
}

export const WORLD_STYLE_DESCRIPTIONS: Record<WorldGenerationStyle, string> = {
  continents: 'Broad continents separated by ocean channels.',
  pangaea: 'One great connected landmass with a varied inland frontier.',
  fractal: 'Branching coasts, deep inlets, and scattered islands.',
};
