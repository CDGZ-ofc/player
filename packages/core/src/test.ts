

import { parseTTML } from "@applemusic-like-lyrics/ttml";
import GUI from "lil-gui";
import Stats from "stats.js";
import {
    BackgroundRender,
    MeshGradientRenderer,
    PixiRenderer,
} from "./bg-render";
import {
    type LyricLine,
    type LyricLineMouseEvent,
    LyricPlayer,
    type LyricWord,
} from "./lyric-player";
import type { SpringParams } from "./utils/spring";

const audio = document.createElement("audio");
audio.volume = 0.5;
audio.preload = "auto";

const debugValues = {
	lyric:
		new URL(location.href).searchParams.get("lyric") ||
		new URL(location.href).searchParams.get("lrc") ||
		"",
	music:
		new URL(location.href).searchParams.get("music") ||
		new URL(location.href).searchParams.get("audio") ||
		"",
	album:
		new URL(location.href).searchParams.get("album") ||
		new URL(location.href).searchParams.get("img") ||
		"",
	name: new URL(location.href).searchParams.get("name") || "",
	artist: new URL(location.href).searchParams.get("artist") || "",
	neteaseId: new URL(location.href).searchParams.get("n") || "",
	enableSpring: true,
	bgFPS: 60,
	bgMode: new URL(location.href).searchParams.get("bg") || "mg",
	bgScale: 1,
	bgFlowSpeed: 2,
	bgPlaying: true,
	bgStaticMode: true,
	currentTime: 0,
	enableBlur: true,
	enableWordRuby: true,
	rubyScale: 0.42,
	rubyWeight: 600,
	rubyOpacity: 0.75,
	playing: false,
	async mockPlay() {
		this.playing = true;
		const startTime = Date.now();
		const baseTime = this.currentTime * 1000;
		while (this.playing && this.currentTime < 300) {
			const time = Date.now() - startTime;
			this.currentTime = (baseTime + time) / 1000;
			progress.updateDisplay();
			lyricPlayer.setCurrentTime(baseTime + time);
			await waitFrame();
		}
	},
	play() {
		this.playing = true;
		audio.load();
		audio.play();
	},
	pause() {
		this.playing = false;
		if (audio.paused) {
			audio.play();
		} else {
			audio.pause();
		}
	},
	lineSprings: {
		posX: {
			mass: 1,
			damping: 10,
			stiffness: 100,
			soft: false,
		} as SpringParams,
		posY: {
			mass: 1,
			damping: 15,
			stiffness: 100,
			soft: false,
		} as SpringParams,
		scale: {
			mass: 1,
			damping: 20,
			stiffness: 100,
			soft: false,
		} as SpringParams,
	},
};

function recreateBGRenderer(mode: string) {
	window.globalBackground?.dispose();
	if (mode === "pixi") {
		window.globalBackground = BackgroundRender.new(PixiRenderer);
	} else if (mode === "mg") {
		window.globalBackground = BackgroundRender.new(MeshGradientRenderer);
	} else {
		throw new Error("Unknown renderer mode");
	}
	const bg = window.globalBackground;
	bg.setFPS(debugValues.bgFPS);
	bg.setRenderScale(debugValues.bgScale);
	bg.setStaticMode(debugValues.bgStaticMode);
	bg.getElement().style.position = "absolute";
	bg.getElement().style.top = "0";
	bg.getElement().style.left = "0";
	bg.getElement().style.width = "100%";
	bg.getElement().style.height = "100%";

	if (debugValues.album) {
		bg.setAlbum(debugValues.album);
		const albumCoverImg = document.getElementById(
			"album-cover-img",
		) as HTMLImageElement;
		if (albumCoverImg) {
			albumCoverImg.src = debugValues.album;
		}
	}
}

const scrollingTextElements = new Map<HTMLElement, string>();

function setScrollingText(element: HTMLElement | null, text: string) {
	if (!element) return;

	scrollingTextElements.set(element, text);

	element.textContent = text;
	element.classList.remove("scrolling");
	element.removeAttribute("data-text");

	const container = element.parentElement;
	if (!container) return;

	const checkAndScroll = () => {
		const elementWidth = element.scrollWidth;
		const containerWidth = container.clientWidth;

		if (elementWidth > containerWidth + 5) {
			element.classList.add("scrolling");
			element.setAttribute("data-text", text);
		}
	};

	requestAnimationFrame(() => {
		checkAndScroll();
	});

	setTimeout(checkAndScroll, 100);
}

function recheckAllScrollingText() {
	scrollingTextElements.forEach((text, element) => {
		element.classList.remove("scrolling");
		element.removeAttribute("data-text");

		const container = element.parentElement;
		if (!container) return;

		const elementWidth = element.scrollWidth;
		const containerWidth = container.clientWidth;

		if (elementWidth > containerWidth + 5) {
			element.classList.add("scrolling");
			element.setAttribute("data-text", text);
		}
	});
}

let resizeTimeout: ReturnType<typeof setTimeout>;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimeout);
	resizeTimeout = setTimeout(recheckAllScrollingText, 100);
});

async function loadAudio(url: string, autoPlay = true) {
	const isNeteaseAudio = url.includes("music.163.com/song/media/outer/url");

	if (isNeteaseAudio) {
		audio.src = url;
		await audio.load();
		if (autoPlay && debugValues.lyric) {
			await loadLyric();
			audio.play().catch(() => {});
		} else if (autoPlay) {
			audio.play().catch(() => {});
		}
		return true;
	}

	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const blob = await response.blob();
		const blobUrl = URL.createObjectURL(blob);
		audio.src = blobUrl;
		await audio.load();
		if (autoPlay && debugValues.lyric) {
			await loadLyric();
			audio.play().catch(() => {});
		} else if (autoPlay) {
			audio.play().catch(() => {});
		}
		return true;
	} catch (error) {
		audio.src = url;
		await audio.load();
		if (autoPlay) {
			audio.play().catch(() => {});
		}
		return false;
	}
}

async function loadNeteaseSong(id: string) {
	try {
		const apiUrl = `https://n.kawa.my/?id=${id}`;
		const audioUrl = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;

		const res = await fetch(apiUrl);
		if (!res.ok) return false;

		const data = await res.json();

		if (data.songName) {
			debugValues.name = debugValues.name || data.songName || "";
			debugValues.artist = debugValues.artist || data.artistsName || "";
			debugValues.album = debugValues.album || data.picUrl || "";
			debugValues.music = debugValues.music || audioUrl;

			const trackTitle = document.getElementById("track-title");
			const trackArtist = document.getElementById("track-artist");
			const albumCoverImg = document.getElementById(
				"album-cover-img",
			) as HTMLImageElement | null;

			if (trackTitle)
				setScrollingText(trackTitle as HTMLElement, debugValues.name);
			if (trackArtist)
				setScrollingText(trackArtist as HTMLElement, debugValues.artist);
			if (albumCoverImg && debugValues.album) {
				albumCoverImg.src = debugValues.album;
			}

			window.globalBackground?.setAlbum(debugValues.album);
		}

		if (debugValues.lyric) {
			const lyricContent = await (await fetch(debugValues.lyric)).text();
			const lowerFile = debugValues.lyric.toLowerCase();
			if (lowerFile.endsWith(".ttml") || lowerFile.endsWith(".xml")) {
				lyricPlayer.setLyricLines(parseTTML(lyricContent).lyricLines);
			} else {
				lyricPlayer.setLyricLines(parseLrc(lyricContent));
			}
		} else if (data.lyric) {
			const mainLyrics = parseLrc(data.lyric);
			const translatedLyrics = data.tlyric ? parseLrc(data.tlyric) : [];

			const translatedMap = new Map<number, string>();
			for (const line of translatedLyrics) {
				translatedMap.set(line.startTime, line.words[0]?.word || "");
			}

			for (const line of mainLyrics) {
				const translated = translatedMap.get(line.startTime);
				if (translated) {
					line.translatedLyric = translated;
				}
			}

			const finalLyrics = mainLyrics;

			if (data.creators) {
				const creatorLines = data.creators
					.split("\n")
					.filter((line: string) => line.trim());

				const bottomLineEl = lyricPlayer.getBottomLineElement();
				if (bottomLineEl) {
					bottomLineEl.innerHTML = "";

					const contributorsContainer = document.createElement("div");
					contributorsContainer.style.marginTop = "40px";
					contributorsContainer.style.fontSize =
						"var(--amll-sub-font-size, 20px)";

					contributorsContainer.style.color = "#ffffff";
					contributorsContainer.style.textAlign = "left";
					contributorsContainer.style.fontFamily =
						"var(--amll-font-family, system-ui, -apple-system, sans-serif)";
					contributorsContainer.style.lineHeight = "1.8";
					contributorsContainer.style.fontWeight = "bold";

					contributorsContainer.style.width = "var(--amll-lp-line-width, 100%)";
					contributorsContainer.style.minWidth =
						"var(--amll-lp-line-width, 100%)";
					contributorsContainer.style.maxWidth =
						"var(--amll-lp-line-width, 100%)";

					contributorsContainer.style.marginLeft = "0";
					contributorsContainer.style.marginRight = "0";
					contributorsContainer.style.display = "flex";
					contributorsContainer.style.flexDirection = "column";
					contributorsContainer.style.justifyContent = "flex-start";

					for (const line of creatorLines) {
						const el = document.createElement("div");
						el.textContent = line;
						contributorsContainer.appendChild(el);
					}

					if (creatorLines.length > 0) {
						bottomLineEl.appendChild(contributorsContainer);
					}
				}
			}

			lyricPlayer.setLyricLines(finalLyrics);
		}

		if (debugValues.music) {
			await loadAudio(debugValues.music);
		}

		return true;
	} catch (error) {
		return false;
	}
}

let lyricOffset = 0;

(window as any).adjustOffset = (delta: number) => {
	lyricOffset += delta * 1000;

	const offsetDisplay = document.getElementById("offsetDisplay");
	if (offsetDisplay) {
		offsetDisplay.textContent = (lyricOffset / 1000).toFixed(1) + "s";
	}

	lyricPlayer.setCurrentTime(audio.currentTime * 1000 + lyricOffset, true);
};

if (debugValues.neteaseId) {
	loadNeteaseSong(debugValues.neteaseId);
} else if (debugValues.music) {
	loadAudio(debugValues.music);
}

const gui = new GUI({ autoPlace: false });
gui.close();

gui
	.add(debugValues, "lyric")
	.name("歌词文件URL")
	.onFinishChange(async (url: string) => {
		lyricPlayer.setLyricLines(
			parseTTML(await (await fetch(url)).text()).lyricLines,
		);
	});
gui
	.add(debugValues, "music")
	.name("歌曲URL")
	.onFinishChange((v: string) => {
		audio.src = v;
	});
gui
	.add(debugValues, "album")
	.name("专辑图片URL")
	.onFinishChange((v: string) => {
		window.globalBackground.setAlbum(v);

		const albumCoverImg = document.getElementById(
			"album-cover-img",
		) as HTMLImageElement | null;
		if (albumCoverImg) {
			albumCoverImg.src = v;
		}
	});

const bgGui = gui.addFolder("背景");
bgGui
	.add(debugValues, "bgPlaying")
	.name("播放")
	.onFinishChange((v: boolean) => {
		if (v) {
			window.globalBackground.resume();
		} else {
			window.globalBackground.pause();
		}
	});
bgGui
	.add(debugValues, "bgMode", ["pixi", "mg"])
	.name("背景渲染器")
	.onFinishChange((v: string) => {
		recreateBGRenderer(v);
	});
bgGui
	.add(debugValues, "bgScale", 0.01, 1, 0.01)
	.name("分辨率比率")
	.onChange((v: number) => {
		window.globalBackground.setRenderScale(v);
	});
bgGui
	.add(debugValues, "bgFPS", 1, 60, 1)
	.name("帧率")
	.onFinishChange((v: number) => {
		window.globalBackground.setFPS(v);
	});
bgGui
	.add(debugValues, "bgFlowSpeed", 0, 10, 0.1)
	.name("流动速度")
	.onFinishChange((v: number) => {
		window.globalBackground.setFlowSpeed(v);
	});
bgGui
	.add(debugValues, "bgStaticMode")
	.name("静态模式")
	.onFinishChange((v: boolean) => {
		window.globalBackground.setStaticMode(v);
	});

{
	const animation = gui.addFolder("歌词行动画/效果");
	animation
		.add(debugValues, "enableBlur")
		.name("启用歌词模糊")
		.onChange((v: boolean) => {
			lyricPlayer.setEnableBlur(v);
		});
	animation
		.add(debugValues, "enableSpring")
		.name("使用弹簧动画")
		.onChange((v: boolean) => {
			lyricPlayer.setEnableSpring(v);
		});
	animation
		.add(debugValues, "enableWordRuby")
		.name("显示逐字音译（注音）")
		.onChange((v: boolean) => {
			lyricPlayer.setEnableWordRuby(v);
		});
	
	
	const rubyStyleEl = document.createElement("style");
	document.head.appendChild(rubyStyleEl);
	const updateRubyStyle = () => {
		rubyStyleEl.textContent = `.amll-lyric-player{--amll-lp-ruby-scale:${debugValues.rubyScale};--amll-lp-ruby-weight:${debugValues.rubyWeight};--amll-lp-ruby-opacity:${debugValues.rubyOpacity};}`;
	};
	updateRubyStyle();
	animation
		.add(debugValues, "rubyScale")
		.min(0.2)
		.max(0.8)
		.step(0.01)
		.name("注音字号倍数")
		.onChange(updateRubyStyle);
	animation
		.add(debugValues, "rubyWeight")
		.min(100)
		.max(900)
		.step(100)
		.name("注音字重")
		.onChange(updateRubyStyle);
	animation
		.add(debugValues, "rubyOpacity")
		.min(0)
		.max(1)
		.step(0.01)
		.name("注音不透明度")
		.onChange(updateRubyStyle);
	function addSpringDbg(name: string, obj: SpringParams, onChange: () => void) {
		const x = animation.addFolder(name);
		x.close();
		x.add(obj, "mass").name("质量").onFinishChange(onChange);
		x.add(obj, "damping").name("阻力").onFinishChange(onChange);
		x.add(obj, "stiffness").name("弹性").onFinishChange(onChange);
		x.add(obj, "soft")
			.name("强制软弹簧（当阻力小于 1 时有用）")
			.onFinishChange(onChange);
	}
	addSpringDbg("水平位移弹簧", debugValues.lineSprings.posX, () => {
		lyricPlayer.setLinePosXSpringParams(debugValues.lineSprings.posX);
	});
	addSpringDbg("垂直位移弹簧", debugValues.lineSprings.posY, () => {
		lyricPlayer.setLinePosYSpringParams(debugValues.lineSprings.posY);
	});
	addSpringDbg("缩放弹簧", debugValues.lineSprings.scale, () => {
		lyricPlayer.setLineScaleSpringParams(debugValues.lineSprings.scale);
	});
}

const playerGui = gui.addFolder("音乐播放器");
const progress = playerGui
	.add(debugValues, "currentTime")
	.min(0)
	.step(1)
	.name("当前进度")
	.onChange((v: number) => {
		audio.currentTime = v;
		lyricPlayer.setCurrentTime(v * 1000, true);
	});
playerGui.add(debugValues, "play").name("加载/播放");
playerGui.add(debugValues, "pause").name("暂停/继续");

const lyricPlayer = new LyricPlayer();

const progressEl = document.getElementById("progress");
const currentTimeEl = document.getElementById("current-time");
const durationEl = document.getElementById("duration");

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function updateProgress() {
	if (audio.duration) {
		const progressPercent = (audio.currentTime / audio.duration) * 100;
		if (progressEl) {
			progressEl.style.width = `${progressPercent}%`;
		}
		if (currentTimeEl) {
			currentTimeEl.textContent = formatTime(audio.currentTime);
		}
		if (durationEl) {
			durationEl.textContent = formatTime(audio.duration);
		}
	}
}

lyricPlayer.addEventListener("line-click", (evt) => {
	const e = evt as LyricLineMouseEvent;
	evt.preventDefault();
	evt.stopImmediatePropagation();
	evt.stopPropagation();

	lyricPlayer.resetScroll();

	const lineTime = e.line.getLine().startTime - lyricOffset;
	audio.currentTime = lineTime / 1000;
	updateProgress();

	if (audio.paused) {
		audio.play();
		debugValues.playing = true;
	}
});

const stats = new Stats();
stats.showPanel(0);
stats.dom.style.display = "none";
let lastTime = -1;
const frame = (time: number) => {
	stats.end();
	if (lastTime === -1) {
		lastTime = time;
	}
	const audioTime = (audio.currentTime * 1000) | 0;
	debugValues.currentTime = (audioTime / 1000) | 0;
	progress.max(audio.duration | 0);
	progress.updateDisplay();
	lyricPlayer.setCurrentTime(audioTime + lyricOffset);
	lyricPlayer.update(time - lastTime);
	lastTime = time;
	stats.begin();
	requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

declare global {
	interface Window {
		globalLyricPlayer: LyricPlayer;
		globalBackground:
			| BackgroundRender<PixiRenderer>
			| BackgroundRender<MeshGradientRenderer>;
	}
}

window.globalLyricPlayer = lyricPlayer;

const waitFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

function parseLrc(content: string): LyricLine[] {
	const lines: LyricLine[] = [];
	const lrcLines = content.trim().split("\n");

	const timeRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;

	for (let i = 0; i < lrcLines.length; i++) {
		const line = lrcLines[i].trim();
		if (!line) continue;

		const timeMatches = [...line.matchAll(timeRegex)];
		if (timeMatches.length === 0) continue;

		const firstMatch = timeMatches[0];
		const minutes = Number.parseInt(firstMatch[1]);
		const seconds = Number.parseInt(firstMatch[2]);
		const milliseconds = Number.parseInt(firstMatch[3].padEnd(3, "0"));
		const startTime = Math.round(
			(minutes * 60 + seconds) * 1000 + milliseconds,
		);

		let lyricContent = line;
		for (const match of timeMatches) {
			lyricContent = lyricContent.replace(match[0], "");
		}
		lyricContent = lyricContent.trim();

		if (!lyricContent) {
			if (lines.length > 0) {
				lines[lines.length - 1].endTime = startTime;
				lines[lines.length - 1].words[0].endTime = startTime;
			}
			continue;
		}

		let endTime = startTime + 3000;
		for (let j = i + 1; j < lrcLines.length; j++) {
			const nextLine = lrcLines[j].trim();
			if (!nextLine) continue;
			const nextTimeMatch = nextLine.match(/\[(\d{2}):(\d{2})[.:](\d{2,3})\]/);
			if (nextTimeMatch) {
				const nextMinutes = Number.parseInt(nextTimeMatch[1]);
				const nextSeconds = Number.parseInt(nextTimeMatch[2]);
				const nextMilliseconds = Number.parseInt(
					nextTimeMatch[3].padEnd(3, "0"),
				);
				endTime = Math.round(
					(nextMinutes * 60 + nextSeconds) * 1000 + nextMilliseconds,
				);
				break;
			}
		}

		const word: LyricWord = {
			startTime,
			endTime,
			word: lyricContent,
		};

		const lyricLine: LyricLine = {
			words: [word],
			translatedLyric: "",
			romanLyric: "",
			startTime,
			endTime,
			isBG: false,
			isDuet: false,
		};

		lines.push(lyricLine);
	}

	return lines;
}

async function loadLyric() {
	const lyricFile = debugValues.lyric;
	if (!lyricFile) return;

	const content = await (await fetch(lyricFile)).text();
	const lowerFile = lyricFile.toLowerCase();

	if (lowerFile.endsWith(".ttml") || lowerFile.endsWith(".xml")) {
		lyricPlayer.setLyricLines(parseTTML(content).lyricLines);
	} else if (lowerFile.endsWith(".lrc")) {
		const lyricLines = parseLrc(content);
		lyricPlayer.setLyricLines(lyricLines);
	} else if (lowerFile.endsWith(".yrc")) {
	} else if (lowerFile.endsWith(".lys")) {
	} else if (lowerFile.endsWith(".qrc")) {
	} else {
		if (content.trim().startsWith("<")) {
			try {
				lyricPlayer.setLyricLines(parseTTML(content).lyricLines);
			} catch (e) {}
		} else if (content.includes("[")) {
			const lyricLines = parseLrc(content);
			lyricPlayer.setLyricLines(lyricLines);
		}
	}
}

(async () => {
	recreateBGRenderer(debugValues.bgMode);
	audio.style.display = "none";
	const player = document.getElementById("player");
	const lyricsWrapper = document.getElementById("lyrics-wrapper");
	if (player && lyricsWrapper) {
		player.appendChild(audio);

		const bgElement = window.globalBackground.getElement();
		bgElement.style.position = "absolute";
		bgElement.style.top = "0";
		bgElement.style.left = "0";
		bgElement.style.width = "100%";
		bgElement.style.height = "100%";
		bgElement.style.zIndex = "-1";
		player.appendChild(bgElement);

		const lyricElement = lyricPlayer.getElement();
		lyricElement.style.width = "100%";
		lyricElement.style.height = "100%";
		lyricElement.style.position = "relative";
		lyricsWrapper.appendChild(lyricElement);

		lyricsWrapper.style.height = "100%";
		lyricsWrapper.style.width = "100%";
		lyricsWrapper.style.position = "relative";

		if (lyricsWrapper.parentElement) {
			lyricsWrapper.parentElement.style.height = "100%";
			lyricsWrapper.parentElement.style.width = "100%";
			lyricsWrapper.parentElement.style.position = "relative";

			const rightSection = lyricsWrapper.parentElement.parentElement;
			if (rightSection) {
				rightSection.style.height = "100%";
				rightSection.style.width = "100%";
				rightSection.style.position = "relative";
			}
		}
	}

	const progressBar = document.getElementById("progress-bar");

	const albumCoverImg = document.getElementById("album-cover-img");
	const albumCoverOverlay = document.getElementById("album-cover-overlay");

	function updatePlayOverlay() {
		if (albumCoverOverlay) {
			if (audio.paused) {
				albumCoverOverlay.classList.add("visible");
			} else {
				albumCoverOverlay.classList.remove("visible");
			}
		}
	}

	if (albumCoverImg) {
		albumCoverImg.addEventListener("click", () => {
			if (audio.paused) {
				audio.play();
				debugValues.playing = true;
			} else {
				audio.pause();
				debugValues.playing = false;
			}
			updatePlayOverlay();
		});
	}

	audio.addEventListener("timeupdate", () => {
		updateProgress();
		updatePlayOverlay();
	});
	audio.addEventListener("loadedmetadata", updateProgress);
	audio.addEventListener("play", updatePlayOverlay);
	audio.addEventListener("pause", updatePlayOverlay);

	if (progressBar) {
		const progressInner = progressBar.querySelector(
			".progress-inner",
		) as HTMLElement;
		let isDragging = false;

		const updatePosition = (clientX: number) => {
			if (!audio.duration) return;

			const target = progressInner || progressBar;
			const rect = target.getBoundingClientRect();
			const clickX = clientX - rect.left;
			const width = rect.width;
			const percentage = Math.max(0, Math.min(1, clickX / width));

			audio.currentTime = audio.duration * percentage;
			updateProgress();
		};

		const handleStart = (e: MouseEvent | TouchEvent) => {
			if (!audio.duration) return;
			isDragging = true;
			const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
			updatePosition(clientX);
		};

		const handleMove = (e: MouseEvent | TouchEvent) => {
			if (!isDragging || !audio.duration) return;
			const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
			updatePosition(clientX);
		};

		const handleEnd = () => {
			if (isDragging && audio.paused) {
				audio.play();
				debugValues.playing = true;
			}
			isDragging = false;
		};

		progressBar.addEventListener("mousedown", handleStart);
		document.addEventListener("mousemove", handleMove);
		document.addEventListener("mouseup", handleEnd);

		progressBar.addEventListener("touchstart", handleStart, { passive: true });
		document.addEventListener("touchmove", handleMove, { passive: true });
		document.addEventListener("touchend", handleEnd);
	}

	if (!debugValues.enableSpring) {
		lyricPlayer.setEnableSpring(false);
	}
	await loadLyric();

	updatePlayOverlay();

	const topControls = document.querySelector(".top-controls") as HTMLElement;
	const SHOW_AREA_SIZE = 100;

	function showTopControls(e?: MouseEvent) {
		if (topControls && e) {
			const rect = topControls.getBoundingClientRect();
			const isNear =
				e.clientX >= rect.left - SHOW_AREA_SIZE &&
				e.clientX <= rect.right + SHOW_AREA_SIZE &&
				e.clientY >= rect.top - SHOW_AREA_SIZE &&
				e.clientY <= rect.bottom + SHOW_AREA_SIZE;

			if (isNear) {
				topControls.classList.add("visible");
				document.body.style.cursor = "default";
			} else {
				topControls.classList.remove("visible");
			}
		}
	}

	function hideTopControls() {
		if (topControls) {
			topControls.classList.remove("visible");
		}
		document.body.style.cursor = "default";
	}

	document.addEventListener("mousemove", showTopControls);
	document.addEventListener("mouseleave", hideTopControls);
	document.addEventListener("mouseenter", showTopControls);

	if (
		debugValues.lyric ||
		debugValues.music ||
		debugValues.album ||
		debugValues.name ||
		debugValues.artist ||
		debugValues.neteaseId
	) {
		const url = new URL(window.location.href);
		url.searchParams.delete("lyric");
		url.searchParams.delete("lrc");
		url.searchParams.delete("music");
		url.searchParams.delete("audio");
		url.searchParams.delete("album");
		url.searchParams.delete("img");
		url.searchParams.delete("name");
		url.searchParams.delete("artist");
		url.searchParams.delete("n");
		window.history.replaceState({}, "", url.toString());
	}

	if (debugValues.name) {
		const trackTitle = document.getElementById("track-title");
		setScrollingText(trackTitle as HTMLElement, debugValues.name);
	}
	if (debugValues.artist) {
		const trackArtist = document.getElementById("track-artist");
		setScrollingText(trackArtist as HTMLElement, debugValues.artist);
	}

	if (debugValues.neteaseId) {
		loadNeteaseSong(debugValues.neteaseId);
	} else if (debugValues.music) {
		loadAudio(debugValues.music);
	}

	document.addEventListener("keydown", (e) => {
		if (e.code === "Space" && e.target === document.body) {
			e.preventDefault();
			if (audio.paused) {
				audio.play();
				debugValues.playing = true;
			} else {
				audio.pause();
				debugValues.playing = false;
			}
		}
	});
})();
