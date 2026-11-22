import path from 'node:path';
import { supportPath } from './app-target.js';
import { readJSON, saveJSON } from './gui-runtime.js';
import defaults from '../assets/reading-defaults.json' with { type: 'json' };

export const readingDefaults = Object.freeze(defaults);
export const readingFile = (support = supportPath()) => path.join(support, 'reading-preferences.json');
/** Missing preferences preserve the renderer's existing settings until the manager changes them. */
export function readingPreferences(file = readingFile()) {
    const saved = readJSON(file);
    if (!saved) return null;
    return { ...readingDefaults, ...Object.fromEntries(Object.entries(saved).filter(([key, value]) =>
        ['isRTL', 'forceRTL', 'fixAtSign'].includes(key) ? typeof value === 'boolean'
            : key === 'fs' ? ['14', '16', '18'].includes(value) : key === 'lh' && ['1.4', '1.6', '1.8'].includes(value))) };
}
export function saveReadingPreferences(input, file = readingFile(), baseline = {}) {
    if (!input || Object.keys(input).some(key => !Object.hasOwn(readingDefaults, key))) throw Error('Invalid reading settings.');
    for (const [key, value] of Object.entries(input)) {
        if (['isRTL', 'forceRTL', 'fixAtSign'].includes(key) ? typeof value !== 'boolean'
            : key === 'fs' ? !['14', '16', '18'].includes(value) : !['1.4', '1.6', '1.8'].includes(value)) throw Error('Invalid reading settings.');
    }
    // The first native save must preserve settings already used by the renderer.
    const current = Object.fromEntries(Object.entries(baseline).filter(([key, value]) =>
        ['isRTL', 'forceRTL', 'fixAtSign'].includes(key) ? typeof value === 'boolean'
            : key === 'fs' ? ['14', '16', '18'].includes(value) : key === 'lh' && ['1.4', '1.6', '1.8'].includes(value)));
    const effective = { ...readingDefaults, ...current, ...readingPreferences(file) };
    if (Object.entries(input).every(([key, value]) => effective[key] === value)) return effective;
    const next = { ...effective, ...input };
    saveJSON(file, next);
    return next;
}
