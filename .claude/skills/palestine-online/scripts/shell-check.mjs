// Opens archived pages in the shell and prints what it shows: the frame, its panes, the
// address bar, ?p=, the captured date, and any page errors.
//
//   node .claude/skills/palestine-online/scripts/shell-check.mjs [base] <path> [path...]
//
//   node .claude/skills/palestine-online/scripts/shell-check.mjs addameer.org/september2000/oldnew.html
//   node .claude/skills/palestine-online/scripts/shell-check.mjs https://palestineonline.net birzeit.edu/web/history.html
//
// base defaults to http://localhost:8080. Paths are local paths under sites/, as ?p= takes them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chromium } = await import(path.join(repo, 'node_modules/playwright/index.mjs'));

const args = process.argv.slice(2);
const base = /^https?:\/\//.test(args[0] || '') ? args.shift().replace(/\/$/, '') : 'http://localhost:8080';
if (!args.length) {
	console.error('usage: shell-check.mjs [base] <path> [path...]');
	process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message} @ ${(e.stack || '').split('\n')[1]?.trim() || ''}`));

for (const localPath of args) {
	errors.length = 0;
	await page.goto(`${base}/?p=${localPath}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	const state = await page.evaluate(() => {
		const top = document.querySelector('#frame').contentWindow;
		const at = (w) => {
			try {
				return decodeURIComponent(w.location.pathname).replace('/sites/', '');
			} catch {
				return '(unreadable)';
			}
		};
		return {
			frame: at(top),
			panes: [...top.document.querySelectorAll('frame, iframe')].map((f) => `${f.name || '?'}=${at(f.contentWindow)}`),
			p: decodeURIComponent(location.search).replace(/^\?p=/, ''),
			address: document.querySelector('#address-input')?.value,
			title: document.querySelector('.window-title')?.textContent,
			captured: document.querySelector('#status-bar-right-text')?.textContent,
		};
	});
	console.log(localPath);
	console.log(JSON.stringify(state, null, 2));
	if (errors.length) console.log('page errors:', errors);
}

await browser.close();
