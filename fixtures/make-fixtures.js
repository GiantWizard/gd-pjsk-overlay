// Write the synthetic fixtures to disk for the analyzer CLI and manual inspection.
//   node fixtures/make-fixtures.js
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { synthMacro, synthTelemetryJsonl } from '../shared/synth.js';

const here = dirname(fileURLToPath(import.meta.url));

const macro = synthMacro();
writeFileSync(join(here, 'sample.gdr.json'), JSON.stringify(macro, null, 0));
writeFileSync(join(here, 'sample.telemetry.jsonl'), synthTelemetryJsonl({ withDeath: true }));

console.log('wrote fixtures/sample.gdr.json and fixtures/sample.telemetry.jsonl');
