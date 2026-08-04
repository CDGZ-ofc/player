export function loadImage(imageUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = document.createElement("img");
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = imageUrl;
		img.crossOrigin = "anonymous";
		img.loading = "eager";
	});
}

export function loadResourceFromUrl(url: string): Promise<HTMLImageElement> {
	return loadImage(url);
}

export function loadResourceFromElement(element: HTMLImageElement): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		if (element.complete) {
			resolve(element);
		} else {
			element.onload = () => resolve(element);
			element.onerror = reject;
		}
	});
}
