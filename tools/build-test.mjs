import { readFileSync, writeFileSync } from 'node:fs';

// Keep top-level initialization in its original order inside one IIFE.
const sourceFiles = [
  '00-header.js',
  'core/storage.js',
  'core/dom.js',
  'items/catalog.js',
  'items/annotations.js',
  'core/fiber.js',
  'core/state.js',
  'market/native.js',
  'net/pagenet.js',
  'logs/parse.js',
  'warehouse.js',
  'cart/selection.js',
  'rare.js',
  'settings/loot.js',
  'refine/backpack.js',
  'cart/transfer.js',
  'refine.js',
  'market.js',
  'hud.js',
  'party-move.js',
  'router.js',
  'mvp.js',
  '99-boot.js',
];
const sourceRoot = new URL('../src/test/', import.meta.url);
const userscript = Buffer.concat(sourceFiles.map(name => readFileSync(new URL(name, sourceRoot))));
writeFileSync(new URL('../ro-idle-helper.test.user.js', import.meta.url), userscript);
