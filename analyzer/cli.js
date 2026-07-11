#!/usr/bin/env node
// Analyzer CLI (Component C) — join a macro + telemetry dump, score movement, print a report.
//
//   node analyzer/cli.js <macro.gdr> <dump.telemetry.jsonl> [--complete] [--end-x N] [--force]
//
// --complete : the macro is a known completion (enables the death-desync guard, §6.5 #2)
// --end-x N  : expected final x for the divergence check (§6.5 #3)
// --force    : analyze even if determinism guards fail (you have been warned)

import { readFileSync } from 'node:fs';
import { parseMacro } from '../shared/gdr.js';
import { parseTelemetry } from '../shared/telemetry.js';
import { analyze } from './pipeline.js';
import { formatReport } from './report.js';

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--complete') opts.expectComplete = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--end-x') opts.expectedEndX = Number(argv[++i]);
    else pos.push(a);
  }
  return { pos, opts };
}

function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error('usage: node analyzer/cli.js <macro> <telemetry.jsonl> [--complete] [--end-x N] [--force]');
    process.exit(2);
  }
  const [macroPath, telePath] = pos;

  const macroBytes = readFileSync(macroPath);
  const macro = parseMacro(new Uint8Array(macroBytes));
  const telemetry = parseTelemetry(readFileSync(telePath, 'utf-8'));

  console.log(`macro:    ${macro.botName ?? '?'} · ${macro.tps} TPS · ${macro.inputs.length} inputs · ` +
    `level ${macro.level.name ?? macro.level.id ?? '?'}`);
  console.log(`telemetry: ${telemetry.length} ticks · ${(telemetry.at(-1)?.ms / 1000 || 0).toFixed(1)}s`);

  const result = analyze(macro, telemetry, opts);

  if (result.capture.warnings.length) {
    for (const w of result.capture.warnings) console.log(`  ⚠ ${w}`);
  }
  if (!result.ok) {
    console.error('\n✗ Capture failed determinism guards (§6.5). NOT analyzing:');
    for (const e of result.capture.errors) console.error(`  ✗ ${e}`);
    console.error('  (re-run with --force to analyze anyway)');
    process.exit(1);
  }

  console.log('\n── severity report ──');
  console.log(formatReport(result.report));

  const flagged = result.notes.filter((n) => n.severity > 0).length;
  console.log(`\n${result.notes.length} notes · ${flagged} flagged · ` +
    `${result.report.length} segment flags`);
}

main();
