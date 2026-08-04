
export interface HasElement {
	
	getElement(): HTMLElement;
}

export interface Disposable {
	
	dispose(): void;
}

export interface LyricWord {

	startTime: number;

	endTime: number;

	word: string;
	
	ruby?: string;
}

export interface LyricLine {
	
	words: LyricWord[];
	
	translatedLyric: string;
	
	romanLyric: string;
	
	startTime: number;
	
	endTime: number;
	
	isBG: boolean;
	
	isDuet: boolean;
}
