

import type {
	LyricLine,
	LyricWord,
	TTMLLyric,
	TTMLMetadata,
} from "./ttml-types";

const timeRegexp =
	/^(((?<hour>[0-9]+):)?(?<min>[0-9]+):)?(?<sec>[0-9]+([.:]([0-9]+))?)/;
function parseTimespan(timeSpan: string): number {
	const matches = timeRegexp.exec(timeSpan);
	if (matches) {
		const hour = Number(matches.groups?.hour || "0");
		const min = Number(matches.groups?.min || "0");
		const sec = Number(matches.groups?.sec.replace(/:/, ".") || "0");
		return Math.floor((hour * 3600 + min * 60 + sec) * 1000);
	}
	throw new TypeError(`时间戳字符串解析失败：${timeSpan}`);
}

interface TransliterationEntry {
	
	begin: string;
	
	end: string;
	
	text: string;
}

interface TransliterationBlock {
	
	lang?: string;
	
	texts: Map<string, TransliterationEntry[]>;
}

function parseTransliterations(ttmlDoc: XMLDocument): TransliterationBlock[] {
	const blocks: TransliterationBlock[] = [];

	for (const blockEl of ttmlDoc.querySelectorAll("transliteration")) {
		const texts = new Map<string, TransliterationEntry[]>();

		for (const textEl of blockEl.children) {
			if (textEl.localName !== "text") continue;
			const forKey = textEl.getAttribute("for");
			if (!forKey) continue;

			const entries: TransliterationEntry[] = [];
			for (const spanEl of textEl.children) {
				if (spanEl.localName !== "span") continue;
				const begin = spanEl.getAttribute("begin");
				const end = spanEl.getAttribute("end");
				const text = spanEl.textContent;
				if (begin === null || end === null || !text) continue;
				entries.push({ begin, end, text });
			}

			if (entries.length === 0) continue;
			const existing = texts.get(forKey);
			if (existing) existing.push(...entries);
			else texts.set(forKey, entries);
		}

		if (texts.size === 0) continue;
		blocks.push({
			lang: blockEl.getAttribute("xml:lang") ?? undefined,
			texts,
		});
	}

	return blocks;
}

function pickTransliterationBlock(
	blocks: TransliterationBlock[],
	preferredLanguage?: string,
): TransliterationBlock | undefined {
	if (blocks.length === 0) return undefined;
	if (preferredLanguage) {
		const exact = blocks.find((b) => b.lang === preferredLanguage);
		if (exact) return exact;
	}
	return blocks.find((b) => !b.lang?.includes("-Latn")) ?? blocks[0];
}

export function parseTTML(
	ttmlText: string,
	options: { transliterationLanguage?: string } = {},
): TTMLLyric {
	const domParser = new DOMParser();
	const ttmlDoc: XMLDocument = domParser.parseFromString(
		ttmlText,
		"application/xml",
	);

	const transliterations = pickTransliterationBlock(
		parseTransliterations(ttmlDoc),
		options.transliterationLanguage,
	)?.texts;

	let mainAgentId = "v1";

	const metadata: TTMLMetadata[] = [];
	for (const meta of ttmlDoc.querySelectorAll("meta")) {
		if (meta.tagName === "amll:meta") {
			const key = meta.getAttribute("key");
			if (key) {
				const value = meta.getAttribute("value");
				if (value) {
					const existing = metadata.find((m) => m.key === key);
					if (existing) {
						existing.value.push(value);
					} else {
						metadata.push({
							key,
							value: [value],
						});
					}
				}
			}
		}
	}

	for (const agent of ttmlDoc.querySelectorAll("ttm\\:agent")) {
		if (agent.getAttribute("type") === "person") {
			const id = agent.getAttribute("xml:id");
			if (id) {
				mainAgentId = id;
			}
		}
	}

	const lyricLines: LyricLine[] = [];

	
	function applyTransliterations(
		itunesKey: string,
		line: LyricLine,
		rawTimestamps: ([string, string] | undefined)[],
	) {
		const entries = transliterations?.get(itunesKey);
		if (!entries) return;

		let cursor = 0;
		for (const entry of entries) {
			for (let i = cursor; i < rawTimestamps.length; i++) {
				const raw = rawTimestamps[i];
				if (!raw || raw[0] !== entry.begin || raw[1] !== entry.end) continue;
				
				if (line.words[i].ruby === undefined) {
					line.words[i].ruby = entry.text;
				}
				cursor = i + 1;
				break;
			}
		}
	}

	function parseParseLine(
		lineEl: Element,
		isBG = false,
		isDuet = false,
		
		itunesKey?: string,
	) {
		const line: LyricLine = {
			words: [],
			translatedLyric: "",
			romanLyric: "",
			isBG,
			isDuet:
				!!lineEl.getAttribute("ttm:agent") &&
				lineEl.getAttribute("ttm:agent") !== mainAgentId,
			startTime: 0,
			endTime: 0,
		};
		if (isBG) line.isDuet = isDuet;
		let haveBg = false;
		
		const rawTimestamps: ([string, string] | undefined)[] = [];

		for (const wordNode of lineEl.childNodes) {
			if (wordNode.nodeType === Node.TEXT_NODE) {
				line.words?.push({
					word: wordNode.textContent ?? "",
					startTime: 0,
					endTime: 0,
				});
				rawTimestamps.push(undefined);
			} else if (wordNode.nodeType === Node.ELEMENT_NODE) {
				const wordEl = wordNode as Element;
				const role = wordEl.getAttribute("ttm:role");

				if (wordEl.nodeName === "span" && role) {
					if (role === "x-bg") {
						parseParseLine(wordEl, true, line.isDuet, itunesKey);
						haveBg = true;
					} else if (role === "x-translation") {
						line.translatedLyric = wordEl.innerHTML;
					} else if (role === "x-roman") {
						line.romanLyric = wordEl.innerHTML;
					}
				} else if (wordEl.hasAttribute("begin") && wordEl.hasAttribute("end")) {
					const rawBegin = wordEl.getAttribute("begin") ?? "";
					const rawEnd = wordEl.getAttribute("end") ?? "";
					const word: LyricWord = {
						word: wordNode.textContent ?? "",
						startTime: parseTimespan(rawBegin),
						endTime: parseTimespan(rawEnd),
					};
					const emptyBeat = wordEl.getAttribute("amll:empty-beat");
					if (emptyBeat) {
						word.emptyBeat = Number(emptyBeat);
					}
					
					
					const ruby = wordEl.getAttribute("amll:ruby");
					if (ruby) {
						word.ruby = ruby;
					}
					line.words.push(word);
					rawTimestamps.push([rawBegin, rawEnd]);
				}
			}
		}

		
		
		if (itunesKey && transliterations) {
			applyTransliterations(itunesKey, line, rawTimestamps);
		}

		if (line.isBG) {
			const firstWord = line.words?.[0];
			if (firstWord?.word.startsWith("(")) {
				firstWord.word = firstWord.word.substring(1);
				if (firstWord.word.length === 0) {
					line.words.shift();
				}
			}

			const lastWord = line.words?.[line.words.length - 1];
			if (lastWord?.word.endsWith(")")) {
				lastWord.word = lastWord.word.substring(0, lastWord.word.length - 1);
				if (lastWord.word.length === 0) {
					line.words.pop();
				}
			}
		}

		const startTime = lineEl.getAttribute("begin");
		const endTime = lineEl.getAttribute("end");
		if (startTime && endTime) {
			line.startTime = parseTimespan(startTime);
			line.endTime = parseTimespan(endTime);
		} else {
			line.startTime = line.words
				.filter((v) => v.word.trim().length > 0)
				.reduce((pv, cv) => Math.min(pv, cv.startTime), Infinity);
			line.endTime = line.words
				.filter((v) => v.word.trim().length > 0)
				.reduce((pv, cv) => Math.max(pv, cv.endTime), 0);
		}

		if (haveBg) {
			const bgLine = lyricLines.pop();
			lyricLines.push(line);
			if (bgLine) lyricLines.push(bgLine);
		} else {
			lyricLines.push(line);
		}
	}

	for (const lineEl of ttmlDoc.querySelectorAll("body p[begin][end]")) {
		parseParseLine(
			lineEl,
			false,
			false,
			lineEl.getAttribute("itunes:key") ?? undefined,
		);
	}

	return {
		metadata,
		lyricLines: lyricLines,
	};
}
