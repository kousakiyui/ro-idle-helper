'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('ro-idle-helper.user.js', 'utf8');
const lines = source.split(/\r?\n/);
assert.equal(lines[0], '// ==UserScript==', 'UserScript header must be first line');
const end = lines.indexOf('// ==/UserScript==');
assert.ok(end > 0, 'UserScript metadata closing marker is missing');
const header = lines.slice(1, end).join('\n');
const field = (key) => {
  const match = header.match(new RegExp('^//\\s*@' + key + '\\s+(.+)$', 'm'));
  assert.ok(match, 'Missing metadata field @' + key);
  return match[1].trim();
};
assert.match(field('version'), /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 'Invalid @version');
assert.equal(field('match'), 'https://ro-idle.app/*');
assert.equal(field('run-at'), 'document-idle');
for (const grant of ['unsafeWindow', 'GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'GM_notification']) {
  assert.ok(header.includes('// @grant        ' + grant), 'Missing @grant ' + grant);
}
for (const key of ['downloadURL', 'updateURL']) {
  const url = new URL(field(key));
  assert.equal(url.protocol, 'https:', '@' + key + ' must use HTTPS');
  assert.equal(url.hostname, 'update.greasyfork.org', '@' + key + ' must retain official update origin');
}
assert.ok(source.length > 1000, 'Source unexpectedly short');
console.log('Userscript header sanity checks passed. In-game behavior is NOT verified.');
