import { RESOURCES } from '../data/resources.js';

export function getResourcesForDimensions(dimensions = [], level = 1) {
  return RESOURCES.filter(
    r => dimensions.includes(r.dimension) && level >= r.level_min && level <= r.level_max
  );
}

export function getWeakestDimensions(scores = {}, n = 3) {
  return Object.entries(scores)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([key]) => key);
}
