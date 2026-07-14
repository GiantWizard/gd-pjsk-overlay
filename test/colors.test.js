import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, baseColor, noteColor, mix } from '../renderer/js/colors.js';

test('null-gamemode holds get the hold color, not the tap color (macro-only loads)', () => {
  // Regression: an Eclipse .gdr2 loaded without telemetry has gamemode null on every
  // note — holds were rendering cyan (tap) instead of the green ribbon color.
  assert.equal(baseColor({ gamemode: null, type: 'hold' }), C.hold);
  assert.equal(baseColor({ gamemode: null, type: 'tap' }), C.tap);
});

test('gamemode-specific colors are unaffected by the null fallback', () => {
  assert.equal(baseColor({ gamemode: 'spider', type: 'tap' }), C.flip);
  assert.equal(baseColor({ gamemode: 'ship', type: 'hold' }), C.hold);
  assert.equal(baseColor({ gamemode: 'cube', type: 'tap' }), C.tap);
});

test('noteColor severity precedence: severity beats scored beats base', () => {
  assert.equal(noteColor({ severity: 1, gamemode: 'cube', type: 'tap' }), C.flagS1);
  assert.equal(noteColor({ severity: 2, gamemode: 'cube', type: 'tap' }), C.flagS2);
  // gold is reserved: only scored-clean notes earn it
  assert.equal(noteColor({ severity: 0, scored: true, gamemode: 'cube', type: 'tap' }), C.clean);
  assert.equal(noteColor({ severity: 0, gamemode: 'cube', type: 'tap' }), C.tap);
});

test('mix blends channels linearly', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(mix('#000000', '#FFFFFF', 1), '#ffffff');
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mix('#FF0000', '#00FF00', 0.5), '#808000');
});
