

import type {
	Disposable,
	HasElement,
	LyricLine,
	LyricWord,
} from "../interfaces";
import "../styles/index.css";
import styles from "../styles/lyric-player.module.css";
import { debounceFrame } from "../utils/debounce";
import { eqSet } from "../utils/eq-set";
import { optimizeLyricLines } from "../utils/optimize-lyric";
import type { SpringParams } from "../utils/spring";
import { BottomLineEl } from "./bottom-line";
import { InterludeDots } from "./interlude-dots";
import { LyricLineEl, type RawLyricLineMouseEvent } from "./lyric-line";

export type { LyricLine, LyricWord };

export class LyricLineMouseEvent extends MouseEvent {
	constructor(
		
		public readonly lineIndex: number,
		
		public readonly line: LyricLineEl,
		event: MouseEvent,
	) {
		super(`line-${event.type}`, event);
	}
}

export type LyricLineMouseEventListener = (evt: LyricLineMouseEvent) => void;

export class LyricPlayer extends EventTarget implements HasElement, Disposable {
	private element: HTMLElement = document.createElement("div");
	private currentTime = 0;
	private lastCurrentTime = 0;
	private lyricLines: LyricLine[] = [];
	private processedLines: LyricLine[] = [];
	private lyricLinesEl: LyricLineEl[] = [];
	private lyricLinesSize: WeakMap<LyricLineEl, [number, number]> =
		new WeakMap();
	private lyricLinesIndexes: WeakMap<LyricLineEl, number> = new WeakMap();
	private hotLines: Set<number> = new Set();
	private bufferedLines: Set<number> = new Set();
	private scrollToIndex = 0;
	private _wordFadeWidth = 0.1;
	private allowScroll = true;
	private scrolledHandler = 0;
	private isScrolled = false;
	private isSeeking = false;
	private initializeSeeking = false;
	private invokedByScrollEvent = false;
	private scrollOffset = 0;
	private hidePassedLines = false;
	private isPlaying = true;
	private overscanPx = 300;
	private initialLayoutFinished = false;
	private debounceCalcLayout = debounceFrame(async () => {
		this.calcLayout(true, true);
		this.lyricLinesEl.forEach((el, i) => {
			el.markMaskImageDirty().then(() => {
				if (this.hotLines.has(i)) {
					el.enable(this.currentTime);
				}
			});
		});
	}, 5);
	private resizeObserver: ResizeObserver = new ResizeObserver(
		debounceFrame(
			((e) => {
				const rect = e[0].contentRect;
				this.size[0] = rect.width;
				this.size[1] = rect.height;
				const styles = getComputedStyle(e[0].target);
				const innerWidth =
					this.element.clientWidth -
					Number.parseFloat(styles.paddingLeft) -
					Number.parseFloat(styles.paddingRight);
				const innerHeight =
					this.element.clientHeight -
					Number.parseFloat(styles.paddingTop) -
					Number.parseFloat(styles.paddingBottom);
				this.innerSize[0] = innerWidth;
				this.innerSize[1] = innerHeight;
				this.rebuildStyle();
				this.lyricLinesEl.forEach((el, i) => {
					el.markMaskImageDirty().then(() => {
						if (this.hotLines.has(i)) {
							el.enable(this.currentTime);
						}
					});
				});
				for (const el of this.lyricLinesEl) {
					el.markLayoutDirty();
					el.markMaskImageDirty();
				}
				this.debounceCalcLayout();
			}) as ResizeObserverCallback,
			5,
		),
	);
	private posXSpringParams: Partial<SpringParams> = {
		mass: 1,
		damping: 10,
		stiffness: 100,
	};
	private posYSpringParams: Partial<SpringParams> = {
		mass: 0.9,
		damping: 15,
		stiffness: 90,
	};
	private scaleSpringParams: Partial<SpringParams> = {
		mass: 2,
		damping: 25,
		stiffness: 100,
	};

	private scaleForBGSpringParams: Partial<SpringParams> = {
		mass: 1,
		damping: 20,
		stiffness: 50,
	};
	private emUnit = Math.max(Math.min(innerHeight * 0.05, innerWidth * 0.1), 12);
	private enableBlur = true;
	private enableScale = true;
	private interludeDots: InterludeDots;
	private interludeDotsSize: [number, number] = [0, 0];
	private bottomLine: BottomLineEl;
	readonly supportPlusLighter = CSS.supports("mix-blend-mode", "plus-lighter");
	readonly supportMaskImage = CSS.supports("mask-image", "none");
	private disableSpring = false;
	private alignAnchor: "top" | "bottom" | "center" = "center";
	private alignPosition = 0.35;
	private isNonDynamic = false;
	private isNonDuet = false;
	private enableWordRuby = true;
	private hasWordRuby = false;
	private scrollBoundary = [0, 0];
	readonly size: [number, number] = [0, 0];
	readonly innerSize: [number, number] = [0, 0];
	private readonly onLineClickedHandler = (e: RawLyricLineMouseEvent) => {
		const evt = new LyricLineMouseEvent(
			this.lyricLinesIndexes.get(e.line) ?? -1,
			e.line,
			e,
		);
		if (!this.dispatchEvent(evt)) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		}
	};
	
	_getIsNonDynamic() {
		return this.isNonDynamic;
	}
	getIsPlaying() {
		return this.isPlaying;
	}
	setIsSeeking(isSeeking: boolean) {
		this.isSeeking = isSeeking;
	}
	
	setEnableSpring(enable = true) {
		this.disableSpring = !enable;
		if (enable) {
			this.element.classList.remove(styles.disableSpring);
		} else {
			this.element.classList.add(styles.disableSpring);
		}
		this.calcLayout(true);
	}
	
	getEnableSpring() {
		return !this.disableSpring;
	}
	
	setEnableScale(enable = true) {
		this.enableScale = enable;
		this.calcLayout();
	}
	
	getEnableScale() {
		return this.enableScale;
	}
	setOverscanPx(px: number) {
		this.overscanPx = Math.max(0, px | 0);
	}
	getOverscanPx() {
		return this.overscanPx;
	}
	private _baseFontSize = Number.parseFloat(
		getComputedStyle(this.element).fontSize,
	);
	public get baseFontSize() {
		return this._baseFontSize;
	}
	private isPageVisible = true;
	private onPageShow = () => {
		this.isPageVisible = true;
		this.setCurrentTime(this.currentTime, true);
	};
	private onPageHide = () => {
		this.isPageVisible = false;
	};
	constructor() {
		super();
		this.interludeDots = new InterludeDots(this);
		this.bottomLine = new BottomLineEl(this);
		this.element.setAttribute("class", "amll-lyric-player");
		if (this.disableSpring) {
			this.element.classList.add(styles.disableSpring);
		}
		this.rebuildStyle();
		this.resizeObserver.observe(this.element);
		this.element.appendChild(this.interludeDots.getElement());
		this.element.appendChild(this.bottomLine.getElement());
		this.interludeDots.setTransform(0, 200);
		window.addEventListener("pageshow", this.onPageShow);
		window.addEventListener("pagehide", this.onPageHide);
		let startScrollY = 0;
		let direction: "up" | "down" | "none" = "none";
		let startTouchPosY = 0;
		let startScrollTime = 0;
		let scrollSpeed = 0;
		let scrollId = Symbol("amll-scroll");
		let lastMoveY = 0;
		let lastDragTime = 0;
		this.element.addEventListener("touchstart", (evt) => {
			if (this.beginScrollHandler()) {
				evt.preventDefault();
				startScrollY = this.scrollOffset;
				startTouchPosY = evt.touches[0].screenY;
				lastMoveY = startTouchPosY;
				startScrollTime = Date.now();
				scrollSpeed = 0;
			}
		});
		this.element.addEventListener("touchmove", (evt) => {
			if (this.beginScrollHandler()) {
				evt.preventDefault();
				const touchScreenY = evt.touches[0].screenY;
				const delta = touchScreenY - startTouchPosY;
				const lastDelta = touchScreenY - lastMoveY;
				const targetDirection =
					lastDelta > 0 ? "down" : lastDelta < 0 ? "up" : "none";
				if (direction !== targetDirection) {
					direction = targetDirection;
					startScrollY = this.scrollOffset;
					startTouchPosY = touchScreenY;
					startScrollTime = Date.now();
				} else {
					this.scrollOffset = startScrollY - delta;
				}
				lastMoveY = touchScreenY;
				lastDragTime = Date.now();
				this.limitScrollOffset();
				this.calcLayout(true);
			}
		});
		this.element.addEventListener("touchend", (evt) => {
			if (this.beginScrollHandler()) {
				evt.preventDefault();
				startTouchPosY = 0;
				const curTime = Date.now();
				if (curTime - lastDragTime > 100) return this.endScrollHandler();
				const scrollDuration = curTime - startScrollTime;
				scrollSpeed =
					((this.scrollOffset - startScrollY) / scrollDuration) * 1000;
				let lt = 0;
				const curScrollId = Symbol("amll-scroll");
				scrollId = curScrollId;
				const onScrollFrame = (dt: number) => {
					lt ||= dt;
					if (scrollId === curScrollId && this.beginScrollHandler()) {
						this.scrollOffset += (scrollSpeed * (dt - lt)) / 1000;
						scrollSpeed *= 0.99;
						this.limitScrollOffset();
						this.calcLayout(true);
						if (
							Math.abs(scrollSpeed) > 1 &&
							!this.scrollBoundary.includes(this.scrollOffset)
						) {
							requestAnimationFrame(onScrollFrame);
						}
						this.endScrollHandler();
						lt = dt;
					}
				};
				requestAnimationFrame(onScrollFrame);
				this.endScrollHandler();
			}
		});
		this.element.addEventListener("wheel", (evt) => {
			if (this.beginScrollHandler()) {
				if (evt.deltaMode === evt.DOM_DELTA_PIXEL) {
					this.scrollOffset += evt.deltaY;
					this.limitScrollOffset();
					this.calcLayout(true);
				} else {
					this.scrollOffset += evt.deltaY * 50;
					this.limitScrollOffset();
					this.calcLayout(false);
				}
				this.endScrollHandler();
			}
		});
	}
	private beginScrollHandler() {
		const allowed = this.allowScroll;
		if (allowed) {
			this.isScrolled = true;
			this.invokedByScrollEvent = true;
			clearTimeout(this.scrolledHandler);
			this.scrolledHandler = setTimeout(() => {
				this.isScrolled = false;
				this.scrollOffset = 0;
			}, 5000);
		}
		return allowed;
	}
	private endScrollHandler() {
		this.invokedByScrollEvent = false;
	}
	private limitScrollOffset() {
		this.scrollOffset = Math.max(
			Math.min(this.scrollBoundary[1], this.scrollOffset),
			this.scrollBoundary[0],
		);
	}
	
	getCurrentInterlude(): [number, number, number, boolean] | undefined {
		if (this.bufferedLines.size > 0) return undefined;
		const currentTime = this.currentTime + 20;
		const i = this.scrollToIndex;
		if (i === 0) {
			if (this.processedLines[0]?.startTime) {
				if (this.processedLines[0].startTime > currentTime) {
					return [
						currentTime,
						Math.max(currentTime, this.processedLines[0].startTime - 250),
						-2,
						this.processedLines[0].isDuet,
					];
				} else {
					if (
						this.processedLines[1].startTime > currentTime &&
						this.processedLines[0].endTime < currentTime
					) {
						return [
							Math.max(this.processedLines[0].endTime, currentTime),
							this.processedLines[1].startTime,
							0,
							this.processedLines[1].isDuet,
						];
					}
				}
			}
		} else if (
			this.processedLines[i]?.endTime &&
			this.processedLines[i + 1]?.startTime
		) {
			if (
				this.processedLines[i + 1].startTime > currentTime &&
				this.processedLines[i].endTime < currentTime
			) {
				return [
					Math.max(this.processedLines[i].endTime, currentTime),
					this.processedLines[i + 1].startTime,
					i,
					this.processedLines[i + 1].isDuet,
				];
			} else if (
				this.processedLines[i + 2]?.startTime &&
				this.processedLines[i + 2].startTime > currentTime &&
				this.processedLines[i + 1].endTime < currentTime
			) {
				return [
					Math.max(this.processedLines[i + 1].endTime, currentTime),
					this.processedLines[i + 2].startTime,
					i + 1,
					this.processedLines[i + 2].isDuet,
				];
			}
		}
		return undefined;
	}
	
	rebuildStyle() {
		this._baseFontSize = Number.parseFloat(
			getComputedStyle(this.element).fontSize,
		);
		let style = "";
		style += "--amll-lp-width:";
		const width = this.innerSize[0] - this._baseFontSize * 2;
		style += `${width.toFixed(4)}px;`;
		style += "--amll-lp-height:";
		style += `${(this.innerSize[1] - this._baseFontSize * 2).toFixed(4)}px;`;

		style += "--amll-lp-line-width:";
		if (this.innerSize[0] < 768) {
			style += `${width.toFixed(4)}px;`;
		} else {
			style += `${(width * 0.8).toFixed(4)}px;`;
		}

		this.element.setAttribute("style", style);
	}
	
	setHidePassedLines(hide: boolean) {
		this.hidePassedLines = hide;
		this.calcLayout();
	}
	
	setEnableBlur(enable: boolean) {
		if (this.enableBlur === enable) return;
		this.enableBlur = enable;
		this.calcLayout();
	}

	
	setEnableWordRuby(enable = true) {
		if (this.enableWordRuby === enable) return;
		this.enableWordRuby = enable;
		this.updateWordRubyState();
		
		
		for (const el of this.lyricLinesEl) {
			el.setLine(el.getLine());
			el.markLayoutDirty();
		}
		this.debounceCalcLayout();
	}
	
	getEnableWordRuby() {
		return this.enableWordRuby;
	}
	
	getHasWordRuby() {
		return this.hasWordRuby;
	}
	
	_getEnableWordRuby() {
		return this.enableWordRuby;
	}
	
	private updateWordRubyState() {
		this.element.classList.toggle(
			"amll-lyric-player-ruby",
			this.hasWordRuby && this.enableWordRuby,
		);
	}

	public get wordFadeWidth() {
		return this._wordFadeWidth;
	}

	
	setWordFadeWidth(value = 0.1) {
		this._wordFadeWidth = Math.max(0.0001, value);
		for (const el of this.lyricLinesEl) {
			el.markMaskImageDirty();
		}
	}

	
	setLyricLines(lines: LyricLine[], initialTime = 0) {
		this.lyricLines = structuredClone(lines);
		this.processedLines = structuredClone(this.lyricLines);
		optimizeLyricLines(this.processedLines);

		this.processedLines = this.processedLines.filter(
			(line) =>
				line.words.reduce((pv, cv) => pv + cv.word.trim().length, 0) > 0,
		);

		this.isNonDynamic = true;
		this.processedLines.forEach((line) => {
			if (line.words.length > 1) {
				this.isNonDynamic = false;
			}
		});
		this.isNonDuet = true;
		this.processedLines.forEach((line) => {
			if (line.isDuet) {
				this.isNonDuet = false;
			}
		});
		
		this.hasWordRuby = this.processedLines.some((line) =>
			line.words.some((word) => !!word.ruby),
		);
		this.updateWordRubyState();
		this.rebuildStyle();

		for (const line of this.lyricLinesEl) {
			line.removeMouseEventListener("click", this.onLineClickedHandler);
			line.removeMouseEventListener("contextmenu", this.onLineClickedHandler);
			line.dispose();
		}

		this.lyricLinesEl = this.processedLines.map((line) => {
			const lineEl = new LyricLineEl(this, line);
			lineEl.addMouseEventListener("click", this.onLineClickedHandler);
			lineEl.addMouseEventListener("contextmenu", this.onLineClickedHandler);
			return lineEl;
		});

		this.lyricLinesEl.forEach((el, i) => {
			this.lyricLinesIndexes.set(el, i);
			el.markMaskImageDirty();
		});
		this.interludeDots.setInterlude(undefined);
		this.hotLines.clear();
		this.bufferedLines.clear();
		this.setLinePosXSpringParams({});
		this.setLinePosYSpringParams({});
		this.setLineScaleSpringParams({});
		this.resetScroll();
		this.initialLayoutFinished = false;
		this.setCurrentTime(initialTime, true);
		this.calcLayout(true, true);
		this.initialLayoutFinished = true;
	}
	
	resetScroll() {
		this.isScrolled = false;
		this.scrollOffset = 0;
		this.invokedByScrollEvent = false;
		clearTimeout(this.scrolledHandler);
		this.scrolledHandler = 0;
	}
	
	calcLayout(force = false, reflow = false) {
		if (reflow) {
			this.emUnit = Number.parseFloat(getComputedStyle(this.element).fontSize);
			for (const el of this.lyricLinesEl) {
				const size: [number, number] = el.measureSize();
				this.lyricLinesSize.set(el, size);
				el.lineSize = size;
			}
			this.interludeDotsSize[0] = this.interludeDots.getElement().clientWidth;
			this.interludeDotsSize[1] = this.interludeDots.getElement().clientHeight;

			this.bottomLine.lineSize = this.bottomLine.measureSize();
		}
		const interlude = this.getCurrentInterlude();
		let curPos = -this.scrollOffset;
		let targetAlignIndex = this.scrollToIndex;
		let interludeDuration = 0;
		if (interlude) {
			interludeDuration = interlude[1] - interlude[0];
			if (interludeDuration >= 4000) {
				const nextLine = this.lyricLinesEl[interlude[2] + 1];
				if (nextLine) {
					targetAlignIndex = interlude[2] + 1;
				}
			}
		} else {
			this.interludeDots.setInterlude(undefined);
		}
		const scrollOffset = this.lyricLinesEl
			.slice(0, targetAlignIndex)
			.reduce(
				(acc, el) =>
					acc + (el.getLine().isBG ? 0 : this.lyricLinesSize.get(el)?.[1] ?? 0),
				0,
			);
		this.scrollBoundary[0] = -scrollOffset;
		curPos -= scrollOffset;
		curPos += this.size[1] * this.alignPosition;
		const curLine = this.lyricLinesEl[targetAlignIndex];
		if (curLine) {
			const lineHeight = this.lyricLinesSize.get(curLine)?.[1] ?? 0;
			switch (this.alignAnchor) {
				case "bottom":
					curPos -= lineHeight;
					break;
				case "center":
					curPos -= lineHeight / 2;
					break;
				case "top":
					break;
			}
		}
		const latestIndex = Math.max(...this.bufferedLines);
		let delay = 0;
		let baseDelay = 0.05;
		let setDots = false;
		const playerHeight = this.size[1];
		const overscan = this.overscanPx;
		this.lyricLinesEl.forEach((el, i) => {
			const hasBuffered = this.bufferedLines.has(i);
			const isActive =
				hasBuffered || (i >= this.scrollToIndex && i < latestIndex);
			const line = el.getLine();

			const lineY = curPos;
			const lineHeight = this.lyricLinesSize.get(el)?.[1] ?? 0;
			const isInView =
				lineY + lineHeight + overscan >= 0 && lineY - overscan <= playerHeight;

			let left = 24;
			if (line.isDuet) {
				left = this.size[0] - (this.lyricLinesSize.get(el)?.[0] ?? 0) - 24;
			}
			if (
				!setDots &&
				interludeDuration >= 4000 &&
				((i === this.scrollToIndex && interlude?.[2] === -2) ||
					i === this.scrollToIndex + 1)
			) {
				setDots = true;
				this.interludeDots.setTransform(24, curPos + 10);
				if (interlude) {
					this.interludeDots.setInterlude([interlude[0], interlude[1]]);
				}
				curPos += this.interludeDotsSize[1] + 40;
			}
			let targetOpacity: number;
			let targetSubOpacity: number;

			if (this.hidePassedLines) {
				if (i < (interlude ? interlude[2] + 1 : this.scrollToIndex)) {
					targetOpacity = 0;
					targetSubOpacity = 0;
				} else if (hasBuffered) {
					targetOpacity = 0.85;
					targetSubOpacity = 0.4;
				} else {
					targetOpacity = this.isNonDynamic ? 0.2 : 1;
					targetSubOpacity = 0.2;
				}
			} else {
				if (hasBuffered) {
					targetOpacity = 0.85;
					targetSubOpacity = 0.4;
				} else {
					targetOpacity = this.isNonDynamic ? 0.2 : 1;
					targetSubOpacity = 0.2;
				}
			}

			let blurLevel = 0;
			if (this.enableBlur) {
				if (isActive) {
					blurLevel = 0;
				} else {
					blurLevel = 1;
					if (i < this.scrollToIndex) {
						blurLevel += Math.abs(this.scrollToIndex - i) + 1;
					} else {
						blurLevel += Math.abs(
							i - Math.max(this.scrollToIndex, latestIndex),
						);
					}
				}
			}
			if (this.invokedByScrollEvent) {
				blurLevel = 0;
			}

			const currentAbove =
				i < (interlude ? interlude[2] + 1 : this.scrollToIndex);
			const SCALE_ASPECT = this.enableScale ? 99 : 100;

			if (isInView || isActive) {
				el.show();
			} else {
				el.hide();
			}

			el.setTransform(
				left,
				curPos,
				isActive ? 100 : line.isBG ? 75 : SCALE_ASPECT,
				targetOpacity,
				targetSubOpacity,
				window.innerWidth <= 1024 ? blurLevel * 0.8 : blurLevel,
				force,
				delay,
				currentAbove,
			);
			if (line.isBG && isActive) {
				curPos += this.lyricLinesSize.get(el)?.[1] ?? 0;
			} else if (!line.isBG) {
				curPos += this.lyricLinesSize.get(el)?.[1] ?? 0;
			}
			if (curPos >= 0 && !this.isSeeking) {
				if (!line.isBG) delay += baseDelay;

				if (i >= this.scrollToIndex) baseDelay /= 1.05;
			}
		});
		this.scrollBoundary[1] = curPos + this.scrollOffset - this.size[1] / 2;

		let bottomLineBlur = 0;
		let bottomLineOpacity = 0.5;

		if (this.enableBlur) {
			if (targetAlignIndex >= this.lyricLinesEl.length - 1) {
				bottomLineBlur = 0;
				bottomLineOpacity = 0.5;
			} else {
				bottomLineBlur = 2;
				bottomLineOpacity = 0.2;
			}
			if (this.invokedByScrollEvent) {
				bottomLineBlur = 0;
			}
			bottomLineBlur =
				window.innerWidth <= 1024 ? bottomLineBlur * 0.8 : bottomLineBlur;
		} else {
			if (targetAlignIndex >= this.lyricLinesEl.length - 1) {
				bottomLineOpacity = 0.5;
			} else {
				bottomLineOpacity = 0;
			}
		}

		this.bottomLine.setTransform(
			24,
			curPos,
			bottomLineBlur,
			bottomLineOpacity,
			force,
			delay,
		);
	}
	
	getCurrentTime() {
		return this.currentTime;
	}
	
	getLyricLines() {
		return this.lyricLines;
	}
	getElement(): HTMLElement {
		return this.element;
	}
	
	getBottomLineElement(): HTMLElement {
		return this.bottomLine.getElement();
	}
	
	setAlignAnchor(alignAnchor: "top" | "bottom" | "center") {
		this.alignAnchor = alignAnchor;
	}
	
	setAlignPosition(alignPosition: number) {
		this.alignPosition = alignPosition;
	}
	
	setCurrentTime(time: number, isSeek = false) {
		this.currentTime = time;

		if (!this.initialLayoutFinished && !isSeek) return;

		this.initializeSeeking = isSeek;
		if (Math.abs(this.currentTime - this.lastCurrentTime) >= 100) {
			this.initializeSeeking = true;
		}
		if (!this.isPageVisible) return;
		if (!this._getIsNonDynamic() && !this.supportMaskImage)
			this.element.style.setProperty("--amll-player-time", `${time}`);
		if (this.isScrolled) return;
		const removedHotIds = new Set<number>();
		const removedIds = new Set<number>();
		const addedIds = new Set<number>();

		if (isSeek) {
			for (const line of this.lyricLinesEl) {
				line.setMaskAnimationState(time);
			}
		}

		for (const lastHotId of this.hotLines) {
			const line = this.processedLines[lastHotId];
			if (line) {
				if (line.isBG) continue;
				const nextLine = this.processedLines[lastHotId + 1];
				if (nextLine?.isBG) {
					const nextMainLine = this.processedLines[lastHotId + 2];
					const startTime = Math.min(line.startTime, nextLine?.startTime);
					const endTime = Math.min(
						Math.max(line.endTime, nextMainLine?.startTime ?? Number.MAX_VALUE),
						Math.max(line.endTime, nextLine?.endTime),
					);
					if (startTime > time || endTime <= time) {
						this.hotLines.delete(lastHotId);
						removedHotIds.add(lastHotId);
						this.hotLines.delete(lastHotId + 1);
						removedHotIds.add(lastHotId + 1);
						if (isSeek) {
							this.lyricLinesEl[lastHotId]?.disable(time);
							this.lyricLinesEl[lastHotId + 1]?.disable(time);
						}
					}
				} else if (line.startTime > time || line.endTime <= time) {
					this.hotLines.delete(lastHotId);
					removedHotIds.add(lastHotId);
					if (isSeek) this.lyricLinesEl[lastHotId]?.disable(time);
				}
			} else {
				this.hotLines.delete(lastHotId);
				removedHotIds.add(lastHotId);
				if (isSeek) this.lyricLinesEl[lastHotId]?.disable(time);
			}
		}
		this.processedLines.forEach((line, id, arr) => {
			if (!line.isBG && line.startTime <= time && line.endTime > time) {
				if (!this.hotLines.has(id)) {
					this.hotLines.add(id);
					addedIds.add(id);
					if (isSeek) this.lyricLinesEl[id].enable(time);
					if (arr[id + 1]?.isBG) {
						this.hotLines.add(id + 1);
						addedIds.add(id + 1);
						if (isSeek) this.lyricLinesEl[id + 1].enable(time);
					}
				}
			}
		});
		for (const v of this.bufferedLines) {
			if (!this.hotLines.has(v)) {
				removedIds.add(v);
				if (isSeek) this.lyricLinesEl[v].disable(time);
			}
		}
		if (isSeek) {
			if (this.bufferedLines.size > 0) {
				this.scrollToIndex = Math.min(...this.bufferedLines);
			} else {
				this.scrollToIndex = this.processedLines.findIndex(
					(line) => line.startTime >= time,
				);
			}
			this.bufferedLines.clear();
			for (const v of this.hotLines) {
				this.bufferedLines.add(v);
			}
			this.calcLayout(true);
		} else if (removedIds.size > 0 || addedIds.size > 0) {
			if (removedIds.size === 0 && addedIds.size > 0) {
				for (const v of addedIds) {
					this.bufferedLines.add(v);
					this.lyricLinesEl[v].enable(time);
				}
				this.scrollToIndex = Math.min(...this.bufferedLines);
				this.calcLayout();
			} else if (addedIds.size === 0 && removedIds.size > 0) {
				if (eqSet(removedIds, this.bufferedLines)) {
					for (const v of this.bufferedLines) {
						if (!this.hotLines.has(v)) {
							this.bufferedLines.delete(v);
							this.lyricLinesEl[v].disable(time);
						}
					}
					this.calcLayout();
				}
			} else {
				for (const v of addedIds) {
					this.bufferedLines.add(v);
					this.lyricLinesEl[v].enable(time);
				}
				for (const v of removedIds) {
					this.bufferedLines.delete(v);
					this.lyricLinesEl[v].disable(time);
				}
				if (this.bufferedLines.size > 0)
					this.scrollToIndex = Math.min(...this.bufferedLines);
				this.calcLayout();
			}
		}
		this.lastCurrentTime = time;
	}
	
	pause() {
		this.interludeDots.pause();
		if (this.isPlaying) {
			this.isPlaying = false;
			for (const line of this.lyricLinesEl) {
				line.pause(this.currentTime);
			}
			this.calcLayout();
		}
	}
	
	resume() {
		this.interludeDots.resume();
		if (!this.isPlaying) {
			this.isPlaying = true;
			for (const line of this.lyricLinesEl) {
				line.resume(this.currentTime);
			}
			this.calcLayout();
		}
	}
	
	update(delta = 0) {
		if (!this.isPageVisible) return;
		const deltaS = delta / 1000;
		this.interludeDots.update(delta);
		this.bottomLine.update(deltaS);
		for (const line of this.lyricLinesEl) {
			line.update(deltaS);
		}
	}
	setLyricAdvanceDynamicLyricTime(enable: boolean) {
		for (const line of this.lyricLinesEl) {
			line.setLyricAdvanceDynamicLyricTime(enable);
		}
	}
	
	setLinePosXSpringParams(params: Partial<SpringParams>) {
		this.posXSpringParams = {
			...this.posXSpringParams,
			...params,
		};
		this.bottomLine.lineTransforms.posX.updateParams(this.posXSpringParams);
		for (const line of this.lyricLinesEl) {
			line.lineTransforms.posX.updateParams(this.posXSpringParams);
		}
	}
	
	setLinePosYSpringParams(params: Partial<SpringParams>) {
		this.posYSpringParams = {
			...this.posYSpringParams,
			...params,
		};
		this.bottomLine.lineTransforms.posY.updateParams(this.posYSpringParams);
		for (const line of this.lyricLinesEl) {
			line.lineTransforms.posY.updateParams(this.posYSpringParams);
		}
	}
	
	setLineScaleSpringParams(params: Partial<SpringParams>) {
		this.scaleSpringParams = {
			...this.scaleSpringParams,
			...params,
		};
		this.scaleForBGSpringParams = {
			...this.scaleForBGSpringParams,
			...params,
		};
		for (const line of this.lyricLinesEl) {
			if (line.getLine().isBG) {
				line.lineTransforms.scale.updateParams(this.scaleForBGSpringParams);
			} else {
				line.lineTransforms.scale.updateParams(this.scaleSpringParams);
			}
		}
	}
	dispose(): void {
		this.element.remove();
		this.resizeObserver.disconnect();
		for (const el of this.lyricLinesEl) {
			el.dispose();
		}
		window.removeEventListener("pageshow", this.onPageShow);
		this.bottomLine.dispose();
		this.interludeDots.dispose();
	}
}
