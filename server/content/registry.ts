import type { PackDef } from '../../shared/content.ts';

// Library packs register here; server/content/library.ts loads the shipped ones.
export const LIBRARY: Record<string, PackDef> = {};
export function registerPack(p: PackDef): void {
  LIBRARY[p.id] = p;
}
