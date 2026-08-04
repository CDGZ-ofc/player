import type { LyricPlayer } from ".";
import type { Disposable, HasElement } from "../interfaces";
import styles from "../styles/lyric-player.module.css";
import { Spring } from "../utils/spring";

export class BottomLineEl implements HasElement, Disposable {
	private element: HTMLElement = document.createElement("div");
	private left = 0;
	private top = 0;
	private delay = 0;
	private blur = 0;
	private opacity = 0.5; 
	
	lineSize: number[] = [0, 0];
	readonly lineTransforms = {
		posX: new Spring(0),
		posY: new Spring(0),
		blur: new Spring(0),
		opacity: new Spring(0.5), 
	};
	constructor(private lyricPlayer: LyricPlayer) {
		this.element.setAttribute("class", styles.lyricLine);
		this.lineTransforms.blur.updateParams({
			mass: 1,
			damping: 20,
			stiffness: 100,
		});
		this.lineTransforms.opacity.updateParams({
			mass: 1,
			damping: 20,
			stiffness: 100,
		});
		this.rebuildStyle();
	}
	measureSize(): [number, number] {
		const size: [number, number] = [
			this.element.clientWidth,
			this.element.clientHeight,
		];
		return size;
	}
	private lastStyle = "";
	show() {
		this.rebuildStyle();
	}
	hide() {
		this.rebuildStyle();
	}
	rebuildStyle() {
		const blurLevel = this.lineTransforms.blur.getCurrentPosition();
		const opacityLevel = this.lineTransforms.opacity.getCurrentPosition();
		let style = `transform:translate(${this.lineTransforms.posX
			.getCurrentPosition()
			.toFixed(2)}px,${this.lineTransforms.posY
			.getCurrentPosition()
			.toFixed(2)}px); opacity:${opacityLevel.toFixed(2)};`;

		if (blurLevel > 0) {
			style += `filter:blur(${blurLevel.toFixed(2)}px);`;
		}

		if (!this.lyricPlayer.getEnableSpring() && this.isInSight) {
			style += `transition-delay:${this.delay}ms;`;
		}
		if (style !== this.lastStyle) {
			this.lastStyle = style;
			this.element.setAttribute("style", style);
		}
	}
	getElement() {
		return this.element;
	}
	setTransform(
		left: number = this.left,
		top: number = this.top,
		blur: number = this.blur,
		opacity: number = this.opacity,
		force = false,
		delay = 0,
	) {
		this.left = left;
		this.top = top;
		this.blur = blur;
		this.opacity = opacity;
		this.delay = (delay * 1000) | 0;
		if (force || !this.lyricPlayer.getEnableSpring()) {
			if (force) this.element.classList.add(styles.tmpDisableTransition);
			this.lineTransforms.posX.setPosition(left);
			this.lineTransforms.posY.setPosition(top);
			this.lineTransforms.blur.setPosition(blur);
			this.lineTransforms.opacity.setPosition(opacity);
			if (!this.lyricPlayer.getEnableSpring()) this.show();
			else this.rebuildStyle();
			if (force)
				requestAnimationFrame(() => {
					this.element.classList.remove(styles.tmpDisableTransition);
				});
		} else {
			this.lineTransforms.posX.setTargetPosition(left, delay);
			this.lineTransforms.posY.setTargetPosition(top, delay);
			this.lineTransforms.blur.setTargetPosition(blur, delay);
			this.lineTransforms.opacity.setTargetPosition(opacity, delay);
		}
	}
	update(delta = 0) {
		if (!this.lyricPlayer.getEnableSpring()) return;
		this.lineTransforms.posX.update(delta);
		this.lineTransforms.posY.update(delta);
		this.lineTransforms.blur.update(delta);
		this.lineTransforms.opacity.update(delta);
		if (this.isInSight) {
			this.show();
		} else {
			this.hide();
		}
	}
	get isInSight() {
		const l = this.lineTransforms.posX.getCurrentPosition();
		const t = this.lineTransforms.posY.getCurrentPosition();
		const r = l + this.lineSize[0];
		const b = t + this.lineSize[1];
		const pr = this.lyricPlayer.size[0];
		const pb = this.lyricPlayer.size[1];
		return !(l > pr || t > pb || r < 0 || b < 0);
	}
	dispose(): void {
		this.element.remove();
	}
}
