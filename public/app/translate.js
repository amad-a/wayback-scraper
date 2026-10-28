// The toolbar's Translate button: the page in the frame into English if it is mostly
// Arabic, into Arabic otherwise. A second click puts the original text back.
//
// It uses Chrome's built-in Translator API, which translates on this machine: no key,
// no quota, and nothing about the page leaves the browser. The first use of a pair of
// languages downloads its model, so the button needs a click to start (the API requires
// one) and shows the download in the status bar. Browsers without the API never see the
// button -- it starts hidden and is only shown when `Translator` exists.
//
// What changes is the text in the page's text nodes, in the frame and in every pane of a
// frameset; markup, links and images are left alone. The originals are kept so the
// toggle can restore them, and dropped when the frame navigates, since the page they
// belonged to is gone.

const button = document.getElementById('translate');
const iframe = document.getElementById('frame');
const statusText = document.getElementById('status-bar-left-text');

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-zÀ-ɏ]/g;
const LETTER = /[\p{L}]/u;
// Text that is not prose, in any language.
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);

let originals = null; // { text: node -> text, dirs: [el, dir] } from before, while translated
let running = null; // { cancelled } while a translation is under way

function status(message) {
	if (statusText) statusText.textContent = message;
}

// The frame's document and those of its panes, nested framesets included. Bounded like
// the rest of the shell's frame walking: framesets nest, but not indefinitely.
function documents(win = iframe.contentWindow, depth = 0, out = []) {
	if (!win || depth > 3) return out;
	try {
		if (win.document?.body) out.push(win.document);
	} catch {
		return out; // cross-origin; nothing we can read
	}
	for (let i = 0; i < win.frames.length; i++) documents(win.frames[i], depth + 1, out);
	return out;
}

function textNodes(doc) {
	const nodes = [];
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (!LETTER.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
			for (let el = node.parentElement; el; el = el.parentElement) {
				if (SKIP.has(el.tagName)) return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	while (walker.nextNode()) nodes.push(walker.currentNode);
	return nodes;
}

// English if the page is mostly Arabic, by letters counted; otherwise Arabic, from
// whatever the page is written in -- asked of the browser's language detector where it
// has one, else taken to be English.
async function direction(nodes) {
	const text = nodes.map((n) => n.nodeValue).join(' ');
	const arabic = (text.match(ARABIC) || []).length;
	const latin = (text.match(LATIN) || []).length;
	if (arabic > latin) return { sourceLanguage: 'ar', targetLanguage: 'en' };

	let sourceLanguage = 'en';
	if ('LanguageDetector' in self) {
		try {
			const detector = await LanguageDetector.create();
			const [top] = await detector.detect(text.slice(0, 4000));
			if (top && top.detectedLanguage !== 'und' && top.detectedLanguage !== 'ar') {
				sourceLanguage = top.detectedLanguage;
			}
		} catch {
			// no detector model; English is the likeliest guess for this archive
		}
	}
	return { sourceLanguage, targetLanguage: 'ar' };
}

// Asked twice before giving up: the first create can fail while Chrome is still
// installing a model it has just downloaded for another pair.
async function createTranslator(languages, into) {
	const options = {
		...languages,
		monitor(m) {
			m.addEventListener('downloadprogress', (e) => {
				status(`Downloading the ${into} translation model... ${Math.round(e.loaded * 100)}%`);
			});
		},
	};
	if ((await Translator.availability(languages)) === 'unavailable') return null;
	try {
		return await Translator.create(options);
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		try {
			return await Translator.create(options);
		} catch {
			return null;
		}
	}
}

// Arabic pages are laid out right to left, which puts English punctuation on the wrong
// end of every line (":Preface"). Into English, then, each dir="rtl" becomes ltr for as
// long as the translation lasts. Into Arabic the layout is left alone: flipping a 1990s
// table layout would rearrange it, and Arabic reads correctly within left-to-right.
function flipDirection(docs) {
	const flipped = [];
	for (const doc of docs) {
		for (const el of doc.querySelectorAll('[dir]')) {
			if (el.getAttribute('dir').toLowerCase() !== 'rtl') continue;
			flipped.push([el, el.getAttribute('dir')]);
			el.setAttribute('dir', 'ltr');
		}
	}
	return flipped;
}

async function translatePage() {
	const docs = documents();
	const nodes = docs.flatMap(textNodes);
	if (!nodes.length) return;

	const job = { cancelled: false };
	running = job;
	button.classList.add('pressed');

	const languages = await direction(nodes);
	const into = languages.targetLanguage === 'en' ? 'English' : 'Arabic';

	const translator = await createTranslator(languages, into);
	if (!translator) {
		running = null;
		button.classList.remove('pressed');
		status(`This page can't be translated to ${into} in this browser.`);
		return;
	}

	const before = { text: new Map(), dirs: languages.targetLanguage === 'en' ? flipDirection(docs) : [] };
	for (let i = 0; i < nodes.length; i++) {
		if (job.cancelled) break;
		const node = nodes[i];
		const value = node.nodeValue;
		const [, lead, core, trail] = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
		try {
			const result = await translator.translate(core);
			if (job.cancelled) break;
			before.text.set(node, value);
			node.nodeValue = lead + result + trail;
		} catch {
			// one string the model would not take; leave it as it was
		}
		if (i % 20 === 0) status(`Translating to ${into}... ${Math.round((i / nodes.length) * 100)}%`);
	}
	translator.destroy?.();

	if (job.cancelled) {
		restore(before);
		return;
	}
	running = null;
	originals = before;
	status(`Translated to ${into}`);
}

function restore({ text, dirs }) {
	for (const [node, value] of text) node.nodeValue = value;
	for (const [el, value] of dirs) el.setAttribute('dir', value);
}

function toggle() {
	if (running) {
		running.cancelled = true;
		running = null;
		button.classList.remove('pressed');
		status('');
		return;
	}
	if (originals) {
		restore(originals);
		originals = null;
		button.classList.remove('pressed');
		status('');
		return;
	}
	translatePage();
}

// A new page in the frame: whatever was translated went with the old one.
function reset() {
	if (running) running.cancelled = true;
	running = null;
	originals = null;
	button.classList.remove('pressed');
}

export function initTranslate() {
	if (!button || !('Translator' in self)) return;
	button.hidden = false;
	button.addEventListener('click', toggle);
	iframe.addEventListener('load', reset);
}
