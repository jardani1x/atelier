import type { TranslationKey } from './index';

// Presentation only: factory names and generated project data stay unchanged.
export const templateLabels: Record<string, { name: TranslationKey; description: TranslationKey }> = {
  "4-Room HDB Flat": { name: 'templates.hdb4.name', description: 'templates.hdb4.description' },
  "Studio Apartment": { name: 'templates.studio.name', description: 'templates.studio.description' },
  "1-Bedroom Apartment": { name: 'templates.one.name', description: 'templates.one.description' },
  "2-Bedroom House": { name: 'templates.two.name', description: 'templates.two.description' },
  "Open Concept Home": { name: 'templates.open.name', description: 'templates.open.description' },
  "L-Shaped House": { name: 'templates.l.name', description: 'templates.l.description' },
};
