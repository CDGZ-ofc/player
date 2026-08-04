type Subscriber<T> = (value: T) => void;

export class Atom<T> {
	private value: T;
	private subscribers: Set<Subscriber<T>> = new Set();

	constructor(initialValue: T) {
		this.value = initialValue;
	}

	get(): T {
		return this.value;
	}

	set(newValue: T): void {
		if (this.value !== newValue) {
			this.value = newValue;
			this.notify();
		}
	}

	subscribe(subscriber: Subscriber<T>): () => void {
		this.subscribers.add(subscriber);
		return () => this.subscribers.delete(subscriber);
	}

	private notify(): void {
		for (const subscriber of this.subscribers) {
			subscriber(this.value);
		}
	}
}

export class AtomWithStorage<T> extends Atom<T> {
	private key: string;
	private storage: Storage;

	constructor(key: string, initialValue: T, storage: Storage = localStorage) {
		const stored = storage.getItem(key);
		const value = stored !== null ? JSON.parse(stored) : initialValue;
		super(value);
		this.key = key;
		this.storage = storage;
	}

	override set(newValue: T): void {
		super.set(newValue);
		this.storage.setItem(this.key, JSON.stringify(newValue));
	}
}

export function atom<T>(initialValue: T): Atom<T> {
	return new Atom(initialValue);
}

export function atomWithStorage<T>(
	key: string,
	initialValue: T,
	storage?: Storage,
): AtomWithStorage<T> {
	return new AtomWithStorage(key, initialValue, storage);
}

export const musicIdAtom = atom<string | null>(null);
export const musicNameAtom = atom("未知歌曲");
export const musicPlayingAtom = atom(false);
export const musicPlayingPositionAtom = atom(0);
export const musicDurationAtom = atom(0);
export const musicVolumeAtom = atomWithStorage("amll.musicVolume", 0.5);
export const musicLyricOffsetAtom = atom(0);

export interface LyricPlayerState {
	currentTime: number;
	isPlaying: boolean;
	isSeeking: boolean;
	scrollToIndex: number;
}

export const lyricPlayerStateAtom = atom<LyricPlayerState>({
	currentTime: 0,
	isPlaying: true,
	isSeeking: false,
	scrollToIndex: 0,
});
