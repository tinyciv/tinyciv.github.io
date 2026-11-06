export const WORLD_GENERATION_STYLES = ['continents', 'pangaea', 'fractal', 'mediterranean'] as const;
export type WorldGenerationStyle = typeof WORLD_GENERATION_STYLES[number];
export const DEFAULT_WORLD_STYLE: WorldGenerationStyle = 'fractal';
export const WORLD_STYLE_NAMES: Record<WorldGenerationStyle, string> = {
  continents: 'Continents', pangaea: 'Pangaea', fractal: 'Fractal', mediterranean: 'Mediterreanean',
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
  reliefCoverage: { group: 'Relief', label: 'Raised land target', default: 0.0924, min: .04, max: .14 },
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
  startSpacing: { group: 'Settlements', label: 'Faction spacing strength', default: 0.795, min: .7, max: 1.3 },
  startRelaxations: { group: 'Settlements', label: 'Faction spacing passes', default: 3, min: 1, max: 6 },
} as const;
export type LandscapeParameter = keyof typeof LANDSCAPE_CONTROLS;
export type LandscapeParameters = { [K in LandscapeParameter]: number };
export const DEFAULT_LANDSCAPE_PARAMETERS = Object.fromEntries(Object.entries(LANDSCAPE_CONTROLS)
  .map(([key, control]) => [key, control.default])) as LandscapeParameters;
export function resolveLandscapeParameters(overrides: Partial<LandscapeParameters> = {}): LandscapeParameters {
  const parameters = { ...DEFAULT_LANDSCAPE_PARAMETERS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(LANDSCAPE_CONTROLS, key)) throw new RangeError(`Unknown landscape parameter: ${key}`);
    const name = key as LandscapeParameter, control = LANDSCAPE_CONTROLS[name];
    if (!Number.isFinite(value) || value < control.min || value > control.max)
      throw new RangeError(`${key} must be between ${control.min} and ${control.max}.`);
    parameters[name] = value;
  }
  return parameters;
}
export interface WorldGenerationOptions {
  style?: WorldGenerationStyle;
  parameters?: Partial<LandscapeParameters>;
  landformFamily?: LandformFamily;
  /** Disable only for comparison studies of the underlying coastline. */
  riverDeltas?: boolean;
}

export const WORLD_STYLE_DESCRIPTIONS: Record<WorldGenerationStyle, string> = {
  continents: 'Broad continents separated by ocean channels.',
  pangaea: 'One great connected landmass with a varied inland frontier.',
  fractal: 'Branching coasts, deep inlets, and scattered islands.',
  mediterranean: 'Mediterranean geography circa 200 BC with reconstructed and inferred vegetation. Geography stays fixed; the seed varies local detail and starting positions.',
};
