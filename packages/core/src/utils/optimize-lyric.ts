import type { LyricLine } from "../interfaces";

function resetLineTimestamps(lines: LyricLine[]) {
	for (const line of lines) {
		if (line.words.length > 0) {
			const firstWord = line.words[0];
			const lastWord = line.words[line.words.length - 1];

			line.startTime = firstWord.startTime;
			line.endTime = lastWord.endTime;
		}
	}
}

function convertExcessiveBackgroundLines(lines: LyricLine[]) {
	let consecutiveBgCount = 0;

	for (const line of lines) {
		if (line.isBG) {
			consecutiveBgCount++;
			if (consecutiveBgCount > 1) {
				line.isBG = false;
			}
		} else {
			consecutiveBgCount = 0;
		}
	}
}

function syncMainAndBackgroundLines(lines: LyricLine[]) {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.isBG) continue;

		const nextLine = lines[i + 1];
		if (nextLine?.isBG) {
			const allWords = [...line.words, ...nextLine.words].filter(
				(w) => w.word.trim().length > 0,
			);

			if (allWords.length > 0) {
				const minStart = Math.min(...allWords.map((w) => w.startTime));
				const maxEnd = Math.max(...allWords.map((w) => w.endTime));

				const finalStart = Math.min(
					minStart,
					line.startTime,
					nextLine.startTime,
				);
				const finalEnd = Math.max(maxEnd, line.endTime, nextLine.endTime);

				line.startTime = finalStart;
				line.endTime = finalEnd;
				nextLine.startTime = finalStart;
				nextLine.endTime = finalEnd;
			}
		}
	}
}

function cleanUnintentionalOverlaps(lines: LyricLine[]) {
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i];
		if (line.isBG) continue;

		let nextMainIndex = i + 1;
		while (nextMainIndex < lines.length && lines[nextMainIndex].isBG) {
			nextMainIndex++;
		}

		if (nextMainIndex < lines.length) {
			const nextLine = lines[nextMainIndex];
			const overlap = line.endTime - nextLine.startTime;

			if (overlap > 0) {
				const nextDuration = nextLine.endTime - nextLine.startTime;
				const percentageThreshold = nextDuration * 0.1;

				const isIntentionalOverlap =
					overlap > 100 && overlap > percentageThreshold;

				if (!isIntentionalOverlap) {
					line.endTime = nextLine.startTime;

					const attachedBgLine = lines[i + 1];
					if (attachedBgLine?.isBG) {
						attachedBgLine.endTime = nextLine.startTime;
					}
				}
			}
		}
	}
}

function tryAdvanceStartTime(lines: LyricLine[]) {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.isBG) continue;

		let prevLine: LyricLine | null = null;
		if (i > 0) {
			let prevIdx = i - 1;
			if (lines[prevIdx].isBG) {
				prevIdx--;
			}
			if (prevIdx >= 0) {
				prevLine = lines[prevIdx];
			}
		}

		let targetAdvanceAmount = 0;
		let safeBoundary = 0;

		if (prevLine) {
			const originallyHadGap = line.startTime >= prevLine.endTime;

			if (originallyHadGap) {
				targetAdvanceAmount = 1000;
				safeBoundary = prevLine.endTime;
			} else {
				targetAdvanceAmount = 400;
				const prevDuration = prevLine.endTime - prevLine.startTime;
				safeBoundary = prevLine.startTime + prevDuration * 0.3;
			}
		} else {
			targetAdvanceAmount = 1000;
			safeBoundary = 0;
		}

		const targetTime = line.startTime - targetAdvanceAmount;
		const newStartTime = Math.max(safeBoundary, targetTime);

		if (newStartTime < line.startTime) {
			line.startTime = newStartTime;
		}

		const nextLine = lines[i + 1];
		if (nextLine?.isBG) {
			nextLine.startTime = line.startTime;
		}
	}
}

export function optimizeLyricLines(lines: LyricLine[]) {
	for (const line of lines) {
		for (const word of line.words) {
			word.word = word.word.replace(/\s+/g, " ");
		}
	}

	resetLineTimestamps(lines);
	convertExcessiveBackgroundLines(lines);
	syncMainAndBackgroundLines(lines);
	cleanUnintentionalOverlaps(lines);
	tryAdvanceStartTime(lines);
}
