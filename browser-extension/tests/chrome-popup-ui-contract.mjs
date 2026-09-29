import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css] = await Promise.all([
  readFile(new URL('../common/popup.html', import.meta.url), 'utf8'),
  readFile(new URL('../common/popup.css', import.meta.url), 'utf8'),
]);

const requiredIds = [
  'enabled', 'mode', 'ruleBudgetStandard', 'ruleBudgetUltra', 'ruleBudgetBoost',
  'ruleBudgetRuntime', 'liveRefresh', 'feedHealthBadge', 'memoryBadge', 'host',
  'pauseBadge', 'siteToggle', 'tempPauseBtn', 'heuristicRecoveryBtn', 'smartEnabled',
  'autoSkip', 'networkCount', 'hiddenCount', 'smartCount', 'learnedCount',
  'pickerBtn', 'falseBtn', 'resetMemoryBtn', 'clearRecoveryHistoryBtn',
  'domainInput', 'addDomainBtn', 'testBtn', 'githubBtn',
];
for (const id of requiredIds) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `popup contract missing #${id}`);
}

assert.match(css, /--bg-0\s*:\s*#02050a/i, 'premium SWIR dark token missing');
assert.match(css, /--blue\s*:\s*#0088ff/i, 'electric-blue token missing');
assert.match(css, /--cyan\s*:\s*#62e5ff/i, 'electric-cyan token missing');
assert.match(css, /backdrop-filter\s*:\s*blur/i, 'glass surface treatment missing');
assert.match(css, /:focus-visible/, 'keyboard focus-visible styling missing');
assert.match(css, /prefers-reduced-motion\s*:\s*reduce/i, 'reduced-motion fallback missing');
assert.match(css, /@media\s*\(forced-colors\s*:\s*active\)/i, 'Windows high-contrast/forced-colors fallback missing');
assert.match(css, /outline\s*:\s*2px\s+solid\s+Highlight/i, 'forced-colors focus indicator missing');
assert.match(css, /forced-color-adjust\s*:\s*auto/i, 'native forced-colors control semantics missing');
assert.match(css, /font-variant-numeric\s*:\s*tabular-nums/i, 'stable numeric dashboard alignment missing');
assert.match(css, /width\s*:\s*404px/i, 'popup width contract drifted');
assert.doesNotMatch(css, /https?:\/\//i, 'popup CSS must stay self-contained and offline');
assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'inline executable script is not allowed in popup');
assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/, 'viewport contract missing');

console.log('Chrome premium popup UI contract: PASS (motion + forced-colors accessibility)');
