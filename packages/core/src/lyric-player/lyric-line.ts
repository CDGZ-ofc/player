import type { LyricPlayer } from ".";
import type {
    Disposable,
    HasElement,
    LyricLine,
    LyricWord,
} from "../interfaces";
import styles from "../styles/lyric-player.module.css";
import { measure, mutate } from "../utils/schedule";
import { Spring } from "../utils/spring";

const HIRAGANA_KATAKANA = /[\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]/;
const ENGLISH_WORD = /[a-zA-Z]+/g;
const ZWSP = "\u200B";


const RUBY_MIN_GAP = 0.25;

function containsJapanese(text: string): boolean {
	return HIRAGANA_KATAKANA.test(text);
}

function protectWords(text: string): string {
	return text.replace(ENGLISH_WORD, (match) => ZWSP + match + ZWSP);
}

interface RealWord extends LyricWord {
	mainElement: HTMLSpanElement;
	subElements: HTMLSpanElement[];
	elementAnimations: Animation[];
	maskAnimations: Animation[];
	width: number;
	height: number;
	padding: number;
	shouldEmphasize: boolean;

	rubyElement?: HTMLSpanElement;

	rubyReservedWidth?: number;
}



function generateFadeGradient(
	width: number,
	padding = 0,
	bright = "rgba(0,0,0,var(--bright-mask-alpha, 1.0))",
	dark = "rgba(0,0,0,var(--dark-mask-alpha, 1.0))",
): [string, number] {
	const totalAspect = 2 + width + padding;
	const widthInTotal = width / totalAspect;
	const leftPos = (1 - widthInTotal) / 2;
	return [
		`linear-gradient(to right,${bright} ${leftPos * 100}%,${dark} ${
			(leftPos + widthInTotal) * 100
		}%)`,
		totalAspect,
	];
}

function chunkAndSplitLyricWords(
	words: LyricWord[],
): (LyricWord | LyricWord[])[] {
	const resplitedWords: LyricWord[] = [];

	for (const w of words) {
		const realLength = w.word.replace(/\s/g, "").length;
		const splited = w.word.split(" ").filter((v) => v.trim().length > 0);
		if (splited.length > 1) {
			if (w.word.startsWith(" ")) {
				resplitedWords.push({
					word: " ",
					startTime: 0,
					endTime: 0,
				});
			}
			let charPos = 0;
			let rubyAssigned = false;
			for (const s of splited) {
				const word: LyricWord = {
					word: s,
					startTime:
						w.startTime + (charPos / realLength) * (w.endTime - w.startTime),
					endTime:
						w.startTime +
						((charPos + s.length) / realLength) * (w.endTime - w.startTime),
				};

				
				if (w.ruby && !rubyAssigned) {
					word.ruby = w.ruby;
					rubyAssigned = true;
				}
				resplitedWords.push(word);
				resplitedWords.push({
					word: " ",
					startTime: 0,
					endTime: 0,
				});
				charPos += s.length;
			}
			if (!w.word.endsWith(" ")) {
				resplitedWords.pop();
			}
		} else {
			resplitedWords.push({
				...w,
			});
		}
	}

	let wordChunk: string[] = [];
	let wChunk: LyricWord[] = [];
	const result: (LyricWord | LyricWord[])[] = [];

	for (const w of resplitedWords) {
		const word = w.word;
		wordChunk.push(word);
		wChunk.push(w);
		if (word.length > 0 && word.trim().length === 0) {
			wordChunk.pop();
			wChunk.pop();
			if (wChunk.length === 1) {
				result.push(wChunk[0]);
			} else if (wChunk.length > 1) {
				result.push(wChunk);
			}
			result.push(w);
			wordChunk = [];
			wChunk = [];
		} else if (!/^\s*[^\s]*\s*$/.test(wordChunk.join(""))) {
			wordChunk.pop();
			wChunk.pop();
			if (wChunk.length === 1) {
				result.push(wChunk[0]);
			} else if (wChunk.length > 1) {
				result.push(wChunk);
			}
			wordChunk = [word];
			wChunk = [w];
		}
	}

	if (wChunk.length === 1) {
		result.push(wChunk[0]);
	} else {
		result.push(wChunk);
	}

	return result;
}

export function shouldEmphasize(_word: LyricWord): boolean {
	return false;
}

export class RawLyricLineMouseEvent extends MouseEvent {
	constructor(
		public readonly line: LyricLineEl,
		event: MouseEvent,
	) {
		super(event.type, event);
	}
}

function getScaleFromTransform(transform: string): number {
	const match = transform.match(/matrix\(([^)]+)\)/);
	if (match) {
		const values = match[1].split(", ");
		const scaleX = Number.parseFloat(values[0]);
		const scaleY = Number.parseFloat(values[3]);
		return (scaleX + scaleY) / 2;
	}
	return 1;
}

type MouseEventMap = {
	[evt in keyof HTMLElementEventMap]: HTMLElementEventMap[evt] extends MouseEvent
		? evt
		: never;
};
type MouseEventTypes = MouseEventMap[keyof MouseEventMap];
type MouseEventListener = (
	this: LyricLineEl,
	ev: RawLyricLineMouseEvent,
) => void;

export class LyricLineEl extends EventTarget implements HasElement, Disposable {
	private lyricAdvanceDynamicLyricTime = true;
	private element: HTMLElement = document.createElement("div");
	private left = 0;
	private top = 0;
	private scale = 1;
	private blur = 0;
	private delay = 0;
	private splittedWords: RealWord[] = [];

	lineSize: number[] = [0, 0];
	readonly lineTransforms = {
		posX: new Spring(0),
		posY: new Spring(0),
		scale: new Spring(100),
	};

	setLyricAdvanceDynamicLyricTime(enable: boolean) {
		this.lyricAdvanceDynamicLyricTime = enable;
	}

	constructor(
		private lyricPlayer: LyricPlayer,
		private lyricLine: LyricLine = {
			words: [],
			translatedLyric: "",
			romanLyric: "",
			startTime: 0,
			endTime: 0,
			isBG: false,
			isDuet: false,
		},
	) {
		super();
		this._prevParentEl = lyricPlayer.getElement();
		this.element.setAttribute("class", styles.lyricLine);
		if (this.lyricLine.isBG) {
			this.element.classList.add(styles.lyricBgLine);
		}
		if (this.lyricLine.isDuet) {
			this.element.classList.add(styles.lyricDuetLine);
		}
		this.element.appendChild(document.createElement("div"));
		this.element.appendChild(document.createElement("div"));
		this.element.appendChild(document.createElement("div"));
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;
		main.setAttribute("class", styles.lyricMainLine);
		trans.setAttribute("class", styles.lyricSubLine);
		roman.setAttribute("class", styles.lyricSubLine);
		this.rebuildElement();
		this.rebuildStyle();
	}
	private listenersMap = new Map<string, Set<MouseEventListener>>();
	private touchStartX = 0;
	private touchStartY = 0;
	private touchStartTime = 0;
	private isTouchMoved = false;
	private readonly onMouseEvent = (e: MouseEvent) => {
		const wrapped = new RawLyricLineMouseEvent(this, e);
		for (const listener of this.listenersMap.get(e.type) ?? []) {
			listener.call(this, wrapped);
		}
		if (!this.dispatchEvent(wrapped) || wrapped.defaultPrevented) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			return false;
		}
	};

	private readonly onTouchStart = (e: TouchEvent) => {
		this.touchStartX = e.touches[0].clientX;
		this.touchStartY = e.touches[0].clientY;
		this.touchStartTime = Date.now();
		this.isTouchMoved = false;
	};

	private readonly onTouchMove = (e: TouchEvent) => {
		const deltaX = Math.abs(e.touches[0].clientX - this.touchStartX);
		const deltaY = Math.abs(e.touches[0].clientY - this.touchStartY);
		if (deltaX > 10 || deltaY > 10) {
			this.isTouchMoved = true;
		}
	};

	private readonly onTouchEnd = (e: TouchEvent) => {
		if (this.isTouchMoved) return;
		if (Date.now() - this.touchStartTime > 300) return;

		e.stopPropagation();

		const clickEvent = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			clientX: this.touchStartX,
			clientY: this.touchStartY,
		});
		this.element.dispatchEvent(clickEvent);
	};

	addMouseEventListener(
		type: MouseEventTypes,
		callback: MouseEventListener | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void {
		if (callback) {
			const listeners = this.listenersMap.get(type) ?? new Set();
			if (listeners.size === 0) {
				this.element.addEventListener(type, this.onMouseEvent, options);
				if (type === "click") {
					this.element.addEventListener("touchstart", this.onTouchStart, {
						passive: true,
					});
					this.element.addEventListener("touchmove", this.onTouchMove, {
						passive: true,
					});
					this.element.addEventListener("touchend", this.onTouchEnd, {
						passive: true,
					});
				}
			}
			listeners.add(callback);
			this.listenersMap.set(type, listeners);
		}
	}

	removeMouseEventListener(
		type: MouseEventTypes,
		callback: MouseEventListener | null,
		options?: boolean | EventListenerOptions | undefined,
	): void {
		if (callback) {
			const listeners = this.listenersMap.get(type);
			if (listeners) {
				listeners.delete(callback);
				if (listeners.size === 0) {
					this.element.removeEventListener(type, this.onMouseEvent, options);
					if (type === "click") {
						this.element.removeEventListener("touchstart", this.onTouchStart);
						this.element.removeEventListener("touchmove", this.onTouchMove);
						this.element.removeEventListener("touchend", this.onTouchEnd);
					}
				}
			}
		}
	}

	areWordsOnSameLine(word1: RealWord, word2: RealWord) {
		if (word1?.mainElement && word2?.mainElement) {
			const word1el = word1.mainElement;
			const word2el = word2.mainElement;

			const rect1 = word1el.getBoundingClientRect();
			const rect2 = word2el.getBoundingClientRect();

			const topDifference = Math.abs(rect1.top - rect2.top);

			return topDifference < 10;
		}

		return true;
	}

	private isEnabled = false;
	private hasFaded = false;
	async enable(maskAnimationTime = this.lyricLine.startTime) {
		this.isEnabled = true;
		this.hasFaded = false;
		this.element.classList.add(styles.active);
		await this.waitMaskImageUpdated();
		const main = this.element.children[0] as HTMLDivElement;
		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				a.currentTime = 0;
				a.playbackRate = 1;
				a.play();
			}
			for (const a of word.maskAnimations) {
				a.currentTime = Math.min(
					this.totalDuration,
					Math.max(0, maskAnimationTime - this.lyricLine.startTime),
				);
				a.playbackRate = 1;
				a.play();
			}
		}
		main.classList.add(styles.active);
	}
	disable(maskAnimationTime = 0) {
		this.isEnabled = false;
		this.hasFaded = true;
		this.element.classList.remove(styles.active);
		const main = this.element.children[0] as HTMLDivElement;
		let i = 0;
		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				if (
					a.id === "float-word" ||
					a.id.includes("emphasize-word-float-only")
				) {
					a.playbackRate = -1;
					a.play();
				}
			}
			for (const a of word.maskAnimations) {
				if (this.lyricAdvanceDynamicLyricTime) {
					if (maskAnimationTime - this.lyricLine.startTime <= 0) {
						this.hasFaded = false;
					}
					const start = word.startTime - this.lyricLine.startTime;
					const current = maskAnimationTime - this.lyricLine.startTime;
					a.finished.then(() => {
						a.pause();
					});
					if (maskAnimationTime - this.lyricLine.startTime <= 0) {
						a.currentTime = 0;
						a.pause();
					} else if (
						i === this.splittedWords.length - 1 &&
						!this.areWordsOnSameLine(
							this.splittedWords[i - 1],
							this.splittedWords[i],
						) &&
						current < start
					) {
						a.currentTime = start;
						a.playbackRate = 1;
					} else {
						a.currentTime = Math.min(
							this.totalDuration,
							Math.max(0, maskAnimationTime - this.lyricLine.startTime),
						);
						a.playbackRate = 1;
					}
				} else {
					a.currentTime = Math.min(
						this.totalDuration,
						Math.max(0, maskAnimationTime - this.lyricLine.startTime),
					);
					a.pause();
				}
			}
			i++;
		}
		main.classList.remove(styles.active);
	}
	private lastWord?: RealWord;
	resume(_currentTime = 0) {
		if (!this.isEnabled) return;
		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				if (
					!this.lastWord ||
					this.splittedWords.indexOf(this.lastWord) <
						this.splittedWords.indexOf(word)
				) {
					a.play();
				}
			}
			for (const a of word.maskAnimations) {
				if (
					!this.lastWord ||
					this.splittedWords.indexOf(this.lastWord) <
						this.splittedWords.indexOf(word)
				) {
					a.play();
				}
			}
		}
	}
	pause(currentTime = 0) {
		if (!this.isEnabled) return;
		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				if (word.startTime >= currentTime) {
					a.pause();
				} else {
					this.lastWord = word;
				}
			}
			for (const a of word.maskAnimations) {
				if (word.startTime >= currentTime) {
					a.pause();
				} else {
					this.lastWord = word;
				}
			}
		}
	}
	setMaskAnimationState(maskAnimationTime = 0) {
		const t = maskAnimationTime - this.lyricLine.startTime;
		for (const word of this.splittedWords) {
			for (const a of word.maskAnimations) {
				a.currentTime = Math.min(this.totalDuration, Math.max(0, t));
				a.playbackRate = 1;
				if (t >= 0 && t < this.totalDuration) a.play();
				else a.pause();
			}
		}
	}
	private _cacheSize: [number, number] | null = null;
	private _isLayoutDirty = true;
	markLayoutDirty() {
		this._isLayoutDirty = true;
	}

	measureSize(): [number, number] {
		this.hasFaded = false;
		if (!this._isLayoutDirty && this._cacheSize) {
			return this._cacheSize;
		}
		if (this._hide) {
			if (this._prevParentEl) {
				this._prevParentEl.appendChild(this.element);
			}
			this.element.style.display = "";
			this.element.style.visibility = "hidden";
		}
		const size: [number, number] = [
			this.element.clientWidth,
			this.element.clientHeight,
		];
		if (this._hide) {
			if (this._prevParentEl) {
				this.element.remove();
			}
			this.element.style.display = "none";
			this.element.style.visibility = "";
		}
		this._cacheSize = size;
		this._isLayoutDirty = false;
		return size;
	}
	setLine(line: LyricLine) {
		this.lyricLine = line;
		if (this.lyricLine.isBG) {
			this.element.classList.add(styles.lyricBgLine);
		} else {
			this.element.classList.remove(styles.lyricBgLine);
		}
		if (this.lyricLine.isDuet) {
			this.element.classList.add(styles.lyricDuetLine);
		} else {
			this.element.classList.remove(styles.lyricDuetLine);
		}
		this.rebuildElement();
		this.rebuildStyle();
	}
	getLine() {
		return this.lyricLine;
	}
	private _hide = true;
	private _prevParentEl: HTMLElement | null = null;
	private lastStyle = "";
	show() {
		this._hide = false;
		if (this._prevParentEl) {
			this._prevParentEl.appendChild(this.element);
			this._prevParentEl = null;
		}
		this.rebuildStyle();
	}
	hide() {
		this._hide = true;
		if (this.element.parentElement) {
			this._prevParentEl = this.element.parentElement;
			this.element.remove();
		}
		this.rebuildStyle();
	}
	rebuildStyle() {
		if (this._hide) {
			if (this.lastStyle !== "display:none;transform:translate(0,-10000px);") {
				this.lastStyle = "display:none;transform:translate(0,-10000px);";
				this.element.setAttribute(
					"style",
					"display:none;transform:translate(0,-10000px);",
				);
			}
			return;
		}
		let style = "";

		style += `transform:translate(${this.lineTransforms.posX
			.getCurrentPosition()
			.toFixed(1)}px,${this.lineTransforms.posY
			.getCurrentPosition()
			.toFixed(
				1,
			)}px) scale(${(this.lineTransforms.scale.getCurrentPosition() / 100).toFixed(4)});`;
		if (!this.lyricPlayer.getEnableSpring() && this.isInSight) {
			style += `transition-delay:${this.delay}ms;`;
		}
		style += `filter:blur(${Math.min(32, this.blur)}px);`;
		if (style !== this.lastStyle) {
			this.lastStyle = style;
			this.element.setAttribute("style", style);
		}
	}
	rebuildElement() {
		this.disposeElements();
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;

		const mainText = this.lyricLine.words.map((w) => w.word).join("");

		
		
		const rubyText = this.lyricLine.words.map((w) => w.ruby ?? "").join("");
		const useJapaneseFont = containsJapanese(mainText + rubyText);
		const fontFamily = useJapaneseFont
			? '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif'
			: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Hiragino Sans GB", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
		main.style.fontFamily = fontFamily;

		if (this.lyricPlayer._getIsNonDynamic()) {
			main.innerText = protectWords(mainText);
			trans.innerText = this.lyricLine.translatedLyric;
			roman.innerText = this.lyricLine.romanLyric;
			return;
		}
		const chunkedWords = chunkAndSplitLyricWords(this.lyricLine.words);
		main.innerHTML = "";
		for (const chunk of chunkedWords) {
			if (Array.isArray(chunk)) {
				if (chunk.length === 0) continue;
				const merged = chunk.reduce(
					(a, b) => {
						a.endTime = Math.max(a.endTime, b.endTime);
						a.startTime = Math.min(a.startTime, b.startTime);
						a.word += b.word;
						return a;
					},
					{
						word: "",
						startTime: Number.POSITIVE_INFINITY,
						endTime: Number.NEGATIVE_INFINITY,
					},
				);
				const emp = chunk
					.map((word) => shouldEmphasize(word))
					.reduce((a, b) => a || b, shouldEmphasize(merged));
				const wrapperWordEl = document.createElement("span");
				wrapperWordEl.classList.add(styles.emphasizeWrapper);
				const characterElements: HTMLElement[] = [];
				for (const word of chunk) {
					const mainWordEl = document.createElement("span");

					if (emp) {
						mainWordEl.classList.add(styles.emphasize);
						const charEls: HTMLSpanElement[] = [];
						const processedWord = protectWords(word.word.trim());
						for (const char of processedWord.split("")) {
							const charEl = document.createElement("span");
							charEl.innerText = char;
							charEls.push(charEl);
							characterElements.push(charEl);
							mainWordEl.appendChild(charEl);
						}
						const realWord: RealWord = {
							...word,
							mainElement: mainWordEl,
							subElements: charEls,
							elementAnimations: [this.initFloatAnimation(word, mainWordEl)],
							maskAnimations: [],
							width: 0,
							height: 0,
							padding: 0,
							shouldEmphasize: emp,
							rubyElement: this.appendRubyElement(mainWordEl, word),
						};
						this.splittedWords.push(realWord);
					} else {
						mainWordEl.innerText = protectWords(word.word);
						this.splittedWords.push({
							...word,
							mainElement: mainWordEl,
							subElements: [],
							elementAnimations: [this.initFloatAnimation(word, mainWordEl)],
							maskAnimations: [],
							width: 0,
							height: 0,
							padding: 0,
							shouldEmphasize: emp,
							rubyElement: this.appendRubyElement(mainWordEl, word),
						});
					}
					wrapperWordEl.appendChild(mainWordEl);
				}
				if (emp) {
					this.splittedWords[
						this.splittedWords.length - 1
					].elementAnimations.push(
						...this.initEmphasizeAnimation(
							merged,
							characterElements,
							merged.endTime - merged.startTime,
							merged.startTime - this.lyricLine.startTime,
						),
					);
				}

				if (merged.word.trimStart() !== merged.word) {
					main.appendChild(document.createTextNode(" "));
				}
				main.appendChild(wrapperWordEl);
				if (merged.word.trimEnd() !== merged.word && shouldEmphasize(merged)) {
					main.appendChild(document.createTextNode(" "));
				}
			} else if (chunk.word.trim().length === 0) {
				main.appendChild(document.createTextNode(" "));
			} else {
				const emp = shouldEmphasize(chunk);
				const mainWordEl = document.createElement("span");
				const realWord: RealWord = {
					...chunk,
					mainElement: mainWordEl,
					subElements: [],
					elementAnimations: [this.initFloatAnimation(chunk, mainWordEl)],
					maskAnimations: [],
					width: 0,
					height: 0,
					padding: 0,
					shouldEmphasize: emp,
				};
				if (shouldEmphasize(chunk)) {
					mainWordEl.classList.add(styles.emphasize);
					const charEls: HTMLSpanElement[] = [];
					const processedWord = protectWords(chunk.word.trim());
					for (const char of processedWord.split("")) {
						const charEl = document.createElement("span");
						charEl.innerText = char;
						charEls.push(charEl);
						mainWordEl.appendChild(charEl);
					}
					realWord.subElements = charEls;
					const duration = Math.abs(realWord.endTime - realWord.startTime);
					realWord.elementAnimations.push(
						...this.initEmphasizeAnimation(
							chunk,
							charEls,
							duration,
							realWord.startTime - this.lyricLine.startTime,
						),
					);
				} else {
					mainWordEl.innerText = protectWords(chunk.word.trim());
				}
				realWord.rubyElement = this.appendRubyElement(mainWordEl, chunk);
				if (chunk.word.trimStart() !== chunk.word) {
					main.appendChild(document.createTextNode(" "));
				}
				main.appendChild(mainWordEl);
				if (chunk.word.trimEnd() !== chunk.word) {
					main.appendChild(document.createTextNode(" "));
				}
				this.splittedWords.push(realWord);
			}
		}
		trans.innerText = this.lyricLine.translatedLyric;
		roman.innerText = this.lyricLine.romanLyric;
	}

	private appendRubyElement(
		mainWordEl: HTMLSpanElement,
		word: LyricWord,
	): HTMLSpanElement | undefined {
		if (!word.ruby || !this.lyricPlayer._getEnableWordRuby()) return undefined;
		
		mainWordEl.classList.add(styles.hasRuby);
		const rubyEl = document.createElement("span");
		rubyEl.setAttribute("class", styles.ruby);
		
		rubyEl.setAttribute("aria-hidden", "true");
		rubyEl.textContent = word.ruby;
		mainWordEl.appendChild(rubyEl);
		return rubyEl;
	}

	private async reserveRubyWidth() {
		const rubyWords = this.splittedWords.filter((w) => w.rubyElement);
		if (rubyWords.length === 0) return;

		
		
		
		
		
		mutate(() => {
			for (const word of rubyWords) {
				const el = word.mainElement;
				if (el) el.style.minWidth = "";
			}
		});

		
		const measurements = await measure(() => {
			const result: Array<{
				word: RealWord;
				rubyWidth: number;
				fontSize: number;
				paddingBoxWidth: number;
				top: number;
				rubyLeft: number;
				rubyRight: number;
			}> = [];
			for (const word of rubyWords) {
				const rubyEl = word.rubyElement;
				const el = word.mainElement;
				if (!rubyEl || !el) continue;
				
				
				const rubyWidth = rubyEl.offsetWidth;
				const style = getComputedStyle(el);
				const fontSize = Number.parseFloat(style.fontSize) || 0;
				
				const paddingBoxWidth = el.clientWidth;
				const rect = el.getBoundingClientRect();
				
				const center = rect.left + rect.width / 2;
				result.push({
					word,
					rubyWidth,
					fontSize,
					paddingBoxWidth,
					top: rect.top,
					rubyLeft: center - rubyWidth / 2,
					rubyRight: center + rubyWidth / 2,
				});
			}
			return result;
		});

		
		const reservations = new Map<RealWord, number>();
		for (const m of measurements) {
			
			const selfNeeded = Math.max(
				0,
				m.rubyWidth + m.fontSize * RUBY_MIN_GAP - m.paddingBoxWidth,
			);
			reservations.set(m.word, selfNeeded);
		}

		
		for (let i = 0; i < measurements.length - 1; i++) {
			const a = measurements[i];
			const b = measurements[i + 1];
			
			if (Math.abs(a.top - b.top) > a.fontSize) continue;
			const minGap = Math.max(a.fontSize, b.fontSize) * RUBY_MIN_GAP;
			const gap = b.rubyLeft - a.rubyRight;
			const aSelfNeeded = reservations.get(a.word) ?? 0;
			const bSelfNeeded = reservations.get(b.word) ?? 0;
			
			
			
			
			
			
			const effectiveGap = gap + (aSelfNeeded + bSelfNeeded) / 2;
			if (effectiveGap >= minGap) continue;
			const needed = minGap - effectiveGap;
			const ra = aSelfNeeded;
			const rb = bSelfNeeded;
			
			reservations.set(a.word, ra + needed);
			reservations.set(b.word, rb + needed);
		}

		
		const measurementMap = new Map(measurements.map((m) => [m.word, m]));

		await mutate(() => {
			for (const [word, reserved] of reservations) {
				const el = word.mainElement;
				if (!el) continue;
				if (reserved > 0) {
					
					
					
					
					
					
					
					const m = measurementMap.get(word);
					const naturalContent = m
						? m.paddingBoxWidth - 2 * m.fontSize
						: 0;
					el.style.minWidth = `${(naturalContent + reserved).toFixed(2)}px`;
				} else {
					el.style.minWidth = "";
				}
				word.rubyReservedWidth = reserved;
			}
		});
	}
	private initFloatAnimation(word: LyricWord, wordEl: HTMLSpanElement) {
		const delay = word.startTime - this.lyricLine.startTime;
		const duration = Math.max(1000, word.endTime - word.startTime);
		let up = 0.05;
		if (this.lyricLine.isBG) {
			up *= 2;
		}
		const a = wordEl.animate(
			[
				{
					transform: "translateY(0px)",
				},
				{
					transform: `translateY(${-up}em)`,
				},
			],
			{
				duration: Number.isFinite(duration) ? duration : 0,
				delay: Number.isFinite(delay) ? delay : 0,
				id: "float-word",
				composite: "add",
				fill: "both",
				easing: "ease-out",
			},
		);
		a.pause();
		return a;
	}

	private initEmphasizeAnimation(
		word: LyricWord,
		characterElements: HTMLElement[],
		duration: number,
		delay: number,
	): Animation[] {
		return [];
	}

	private get totalDuration() {
		return (
			this.lyricLine.endTime +
			(this.lyricAdvanceDynamicLyricTime ? 400 : 0) -
			this.lyricLine.startTime
		);
	}
	private maskImageDirty = false;
	private markImageDirtyPromises: (() => void)[] = [];
	markMaskImageDirty(): Promise<void> {
		this.maskImageDirty = true;
		return new Promise((resolve) => {
			this.markImageDirtyPromises.push(resolve);
		});
	}
	waitMaskImageUpdated(): Promise<void> {
		if (this.maskImageDirty) {
			return new Promise((resolve) => {
				this.markImageDirtyPromises.push(resolve);
			});
		}
		return Promise.resolve();
	}
	async updateMaskImage() {
		const resolves = this.markImageDirtyPromises;
		this.markImageDirtyPromises = [];
		this.maskImageDirty = false;
		if (
			!this.element.checkVisibility({
				contentVisibilityAuto: true,
			})
		) {
			for (const resolve of resolves) {
				resolve();
			}
			return;
		}
		if (this._hide) {
			await mutate(() => {
				if (this._prevParentEl) {
					this._prevParentEl.appendChild(this.element);
				}
				this.element.style.display = "";
				this.element.style.visibility = "hidden";
			});
		}
		
		await this.reserveRubyWidth();
		for (const word of this.splittedWords) {
			const el = word.mainElement;
			if (el) {
				await measure(() => {
					
					
					
					
					
					const style = getComputedStyle(el);
					word.padding = Number.parseFloat(style.paddingLeft) || 0;
					word.width = el.clientWidth - word.padding * 2;
					
					
					
					
					word.height =
						el.clientHeight -
						(Number.parseFloat(style.paddingTop) || 0) -
						(Number.parseFloat(style.paddingBottom) || 0);
				});
			} else {
				word.width = 0;
				word.height = 0;
				word.padding = 0;
			}
		}
		if (this.lyricPlayer.supportMaskImage) {
			this.generateWebAnimationBasedMaskImage();
		} else {
			this.generateCalcBasedMaskImage();
		}
		if (this._hide) {
			await mutate(() => {
				if (this._prevParentEl) {
					this.element.remove();
				}
				this.element.style.display = "none";
				this.element.style.visibility = "";
			});
		}
		for (const resolve of resolves) {
			resolve();
		}
	}
	private generateCalcBasedMaskImage() {
		for (const word of this.splittedWords) {
			const wordEl = word.mainElement;
			if (wordEl) {
				word.width = wordEl.clientWidth;
				word.height = wordEl.clientHeight;
				const fadeWidth = word.height * this.lyricPlayer.wordFadeWidth;
				const [maskImage, totalAspect] = generateFadeGradient(
					fadeWidth / word.width,
				);
				const totalAspectStr = `${totalAspect * 100}% 100%`;
				if (this.lyricPlayer.supportMaskImage) {
					wordEl.style.maskImage = maskImage;
					wordEl.style.maskRepeat = "no-repeat";
					wordEl.style.maskOrigin = "left";
					wordEl.style.maskSize = totalAspectStr;
				} else {
					wordEl.style.webkitMaskImage = maskImage;
					wordEl.style.webkitMaskRepeat = "no-repeat";
					wordEl.style.webkitMaskOrigin = "left";
					wordEl.style.webkitMaskSize = totalAspectStr;
				}
				const w = word.width + fadeWidth;
				const maskPos = `clamp(${-w}px,calc(${-w}px + (var(--amll-player-time) - ${
					word.startTime
				})*${
					w / Math.abs(word.endTime - word.startTime)
				}px),0px) 0px, left top`;
				wordEl.style.maskPosition = maskPos;
				wordEl.style.webkitMaskPosition = maskPos;
			}
		}
	}
	private generateWebAnimationBasedMaskImage() {
		const totalDuration =
			Math.max(
				this.splittedWords.reduce((pv, w) => Math.max(w.endTime, pv), 0),
				this.lyricLine.endTime,
			) - this.lyricLine.startTime;
		this.splittedWords.forEach((word, i) => {
			const wordEl = word.mainElement;
			if (wordEl) {
				const fadeWidth = word.height * this.lyricPlayer.wordFadeWidth;
				const [maskImage, totalAspect] = generateFadeGradient(
					fadeWidth / (word.width + word.padding * 2),
				);
				const totalAspectStr = `${totalAspect * 100}% 100%`;
				if (this.lyricPlayer.supportMaskImage) {
					wordEl.style.maskImage = maskImage;
					wordEl.style.maskRepeat = "no-repeat";
					wordEl.style.maskOrigin = "left";
					wordEl.style.maskSize = totalAspectStr;
				} else {
					wordEl.style.webkitMaskImage = maskImage;
					wordEl.style.webkitMaskRepeat = "no-repeat";
					wordEl.style.webkitMaskOrigin = "left";
					wordEl.style.webkitMaskSize = totalAspectStr;
				}

				const widthBeforeSelf =
					this.splittedWords.slice(0, i).reduce((a, b) => a + b.width, 0) +
					(this.splittedWords[0] ? fadeWidth : 0);
				const minOffset = -(word.width + word.padding * 2 + fadeWidth);
				const clampOffset = (x: number) => Math.max(minOffset, Math.min(0, x));
				let curPos = -widthBeforeSelf - word.width - word.padding - fadeWidth;
				let timeOffset = 0;
				const frames: Keyframe[] = [];
				let lastPos = curPos;
				let lastTime = 0;
				const pushFrame = () => {
					const moveOffset = curPos - lastPos;
					const time = Math.max(0, Math.min(1, timeOffset));
					const duration = time - lastTime;
					const d = Math.abs(duration / moveOffset);

					if (curPos > minOffset && lastPos < minOffset) {
						const staticTime = Math.abs(lastPos - minOffset) * d;
						const value = `${clampOffset(lastPos)}px 0`;
						const frame: Keyframe = {
							offset: lastTime + staticTime,
							maskPosition: value,
						};
						frames.push(frame);
					}
					if (curPos > 0 && lastPos < 0) {
						const staticTime = Math.abs(lastPos) * d;
						const value = `${clampOffset(curPos)}px 0`;
						const frame: Keyframe = {
							offset: lastTime + staticTime,
							maskPosition: value,
						};
						frames.push(frame);
					}
					const value = `${clampOffset(curPos)}px 0`;
					const frame: Keyframe = {
						offset: time,
						maskPosition: value,
					};
					frames.push(frame);
					lastPos = curPos;
					lastTime = time;
				};
				pushFrame();
				let lastTimeStamp = 0;
				this.splittedWords.forEach((otherWord, j) => {
					{
						const curTimeStamp = otherWord.startTime - this.lyricLine.startTime;
						const staticDuration = curTimeStamp - lastTimeStamp;
						timeOffset += staticDuration / totalDuration;
						if (staticDuration > 0) pushFrame();
						lastTimeStamp = curTimeStamp;
					}

					{
						const fadeDuration = otherWord.endTime - otherWord.startTime;
						timeOffset += fadeDuration / totalDuration;
						curPos += otherWord.width;
						if (j === 0) {
							curPos += fadeWidth * 1.5;
						}
						if (j === this.splittedWords.length - 1) {
							curPos += fadeWidth * 0.5;
						}
						if (fadeDuration > 0) pushFrame();
						lastTimeStamp += fadeDuration;
					}
				});
				for (const a of word.maskAnimations) {
					a.cancel();
				}
				try {
					const ani = wordEl.animate(frames, {
						duration: totalDuration || 1,
						id: `fade-word-${word.word}-${i}`,
						fill: "both",
					});
					ani.pause();
					word.maskAnimations = [ani];
				} catch (err) {
					console.warn("应用渐变动画发生错误", frames, totalDuration, err);
				}
			}
		});
	}
	getElement() {
		return this.element;
	}
	setTransform(
		left: number = this.left,
		top: number = this.top,
		scale: number = this.scale,
		opacity = 1,
		subopacity = 0.4,
		blur = 0,
		force = false,
		delay = 0,
		_currentAbove = true,
	) {
		const beforeInSight = this.isInSight;
		const enableSpring = this.lyricPlayer.getEnableSpring();
		this.left = left;
		this.top = top;
		this.scale = scale;
		this.delay = (delay * 1000) | 0;
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;

		main.style.opacity = `${opacity}`;
		trans.style.opacity = `${subopacity}`;
		roman.style.opacity = `${subopacity}`;
		if (force || !enableSpring) {
			this.blur = Math.min(32, blur);
			if (force) this.element.classList.add(styles.tmpDisableTransition);

			this.lineTransforms.posX.setPosition(left);
			this.lineTransforms.posY.setPosition(top);
			this.lineTransforms.scale.setPosition(scale);
			if (!enableSpring) {
				const afterInSight = this.isInSight;
				if (beforeInSight || afterInSight) {
					this.show();
				} else {
					this.hide();
				}
			} else this.rebuildStyle();
			if (force)
				requestAnimationFrame(() => {
					this.element.classList.remove(styles.tmpDisableTransition);
				});
		} else {
			this.lineTransforms.posX.setTargetPosition(left, delay);
			this.lineTransforms.posY.setTargetPosition(top, delay);
			this.lineTransforms.scale.setTargetPosition(scale);
			if (this.blur !== Math.min(32, blur)) {
				this.blur = Math.min(32, blur);
				const roundedBlur = blur.toFixed(3);
				this.element.style.filter = `blur(${roundedBlur}px)`;
			}
		}
	}
	private currentBrightAlpha = 1.0;
	private currentDarkAlpha = 0.2;
	private targetBrightAlpha = 1.0;
	private targetDarkAlpha = 0.2;


	private updateMaskAlphaTargets(scale: number) {
		const factor = Math.max(0.0, Math.min(1.0, (scale - 0.97) / 0.03));
		const dynamicDarkAlpha = factor * 0.2 + 0.2;
		const dynamicBrightAlpha = factor * 0.8 + 0.2;

		if (this.isEnabled) {
			this.targetBrightAlpha = dynamicBrightAlpha;
			this.targetDarkAlpha = dynamicDarkAlpha;
		} else {
			this.targetBrightAlpha = dynamicDarkAlpha;
			this.targetDarkAlpha = dynamicDarkAlpha;
		}
	}


	private applyAlphaToDom(delta: number) {
		const dt = delta || 0.016;
		const ATTACK_SPEED = 50.0;
		const RELEASE_SPEED = 7.0;
		const getFactor = (speed: number) => 1 - Math.exp(-speed * dt);

		const isBrightening = this.targetBrightAlpha > this.currentBrightAlpha;
		const brightSpeed = isBrightening ? ATTACK_SPEED : RELEASE_SPEED;
		const brightFactor = getFactor(brightSpeed);

		if (Math.abs(this.targetBrightAlpha - this.currentBrightAlpha) < 0.001) {
			this.currentBrightAlpha = this.targetBrightAlpha;
		} else {
			this.currentBrightAlpha +=
				(this.targetBrightAlpha - this.currentBrightAlpha) * brightFactor;
		}

		const isDarkening = this.targetDarkAlpha > this.currentDarkAlpha;
		const darkSpeed = isDarkening ? ATTACK_SPEED : RELEASE_SPEED;
		const darkFactor = getFactor(darkSpeed);

		if (Math.abs(this.targetDarkAlpha - this.currentDarkAlpha) < 0.001) {
			this.currentDarkAlpha = this.targetDarkAlpha;
		} else {
			this.currentDarkAlpha +=
				(this.targetDarkAlpha - this.currentDarkAlpha) * darkFactor;
		}

		this.element.style.setProperty(
			"--bright-mask-alpha",
			this.currentBrightAlpha.toFixed(3),
		);
		this.element.style.setProperty(
			"--dark-mask-alpha",
			this.currentDarkAlpha.toFixed(3),
		);
	}

	update(delta = 0) {
		if (!this.lyricPlayer.getEnableSpring()) return;
		this.lineTransforms.posX.update(delta);
		this.lineTransforms.posY.update(delta);
		this.lineTransforms.scale.update(delta);
		if (this.isInSight) {
			this.show();
			if (this.maskImageDirty) {
				this.updateMaskImage();
			}
		} else {
			this.hide();
		}
		if (this.lyricPlayer.getEnableSpring()) {
			this.updateMaskAlphaTargets(
				this.lineTransforms.scale.getCurrentPosition() / 100,
			);
			this.applyAlphaToDom(delta);
		} else {
			const computedStyle = window.getComputedStyle(this.element);
			const transform = computedStyle.transform;

			const scale = getScaleFromTransform(transform);

			this.element.style.setProperty(
				"--bright-mask-alpha",
				`${Math.max(0.0, Math.min(1.0, (scale - 0.97) / 0.03)) * 0.8 + 0.2}`,
			);
			this.element.style.setProperty(
				"--dark-mask-alpha",
				`${Math.max(0.0, Math.min(1.0, (scale - 0.97) / 0.03)) * 0.2 + 0.2}`,
			);
		}
	}

	_getDebugTargetPos(): string {
		return `[位移: ${this.left}, ${this.top}; 缩放: ${this.scale}; 延时: ${this.delay}]`;
	}

	get isInSight() {
		const l = this.lineTransforms.posX.getCurrentPosition();
		const t = this.lineTransforms.posY.getCurrentPosition();
		const w = this.lineSize[0];
		const h = this.lineSize[1];
		const r = l + w;
		const b = t + h;
		const pr = this.lyricPlayer.size[0];
		const pb = this.lyricPlayer.size[1];
		return !(l > pr + w || r < -w || t > pb + h || b < -h);
	}
	private disposeElements() {
		for (const realWord of this.splittedWords) {
			for (const a of realWord.elementAnimations) {
				a.cancel();
			}
			for (const a of realWord.maskAnimations) {
				a.cancel();
			}
			for (const sub of realWord.subElements) {
				sub.remove();
				sub.parentNode?.removeChild(sub);
			}
			realWord.elementAnimations = [];
			realWord.maskAnimations = [];
			realWord.subElements = [];
			if (realWord.rubyElement) {
				realWord.rubyElement.remove();
				realWord.rubyElement = undefined;
			}
			realWord.mainElement.remove();
			realWord.mainElement.parentNode?.removeChild(realWord.mainElement);
		}
		this.splittedWords = [];
	}
	dispose(): void {
		this.disposeElements();
		this.element.remove();
	}
}
