// `npm run pack:check` — refuses a pack with cycles, missing template types, or failing property tests.
import { validatePack } from './validate.ts';
import pack from './packs/intro-probability/index.ts';

const errors = validatePack(pack);
const byCap: Record<string, number> = {};
for (const t of pack.templates) byCap[t.meta.capability] = (byCap[t.meta.capability] ?? 0) + 1;
console.log(
  `${pack.id}@${pack.version}: ${pack.kcs.length} KCs, ${pack.misconceptions.length} misconceptions, ${pack.templates.length} templates`,
  byCap,
);
if (errors.length) {
  console.error(`${errors.length} validation error(s):\n` + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log('pack OK');
