
import GUI from "lil-gui";
import Stats from "stats.js";
import { MeshGradientRenderer } from "./bg-render";

const ValuesGG = {
	controlPointSize: 4,
	subdivideDepth: 15,
	wireFrame: false,
};

const canvas = document.getElementById("bg")! as HTMLCanvasElement;
const mgRenderer = new MeshGradientRenderer(canvas);

mgRenderer.setManualControl(true);
mgRenderer.setFPS(Number.POSITIVE_INFINITY);

function updateControlPointDraggers() {
	for (const el of document.querySelectorAll(".dragger")) {
		const x = Number.parseInt(el.getAttribute("x") ?? "");
		const y = Number.parseInt(el.getAttribute("y") ?? "");
		const point = mgRenderer.getControlPoint(x, y);
		if (point === undefined) return;
		(el as HTMLElement).style.left = `${(point.location.x + 1) * 50}%`;
		(el as HTMLElement).style.top = `${(1 - point.location.y) * 50}%`;
	}
}

window.addEventListener("resize", updateControlPointDraggers);

const resultTextArea = document.getElementById(
	"result",
)! as HTMLTextAreaElement;
resultTextArea.value = "";
function updateResult() {
	const result = [
		`preset(${ValuesGG.controlPointSize}, ${ValuesGG.controlPointSize}, [`,
	];
	for (let y = 0; y < ValuesGG.controlPointSize; y++) {
		for (let x = 0; x < ValuesGG.controlPointSize; x++) {
			const point = mgRenderer.getControlPoint(x, y);
			if (point === undefined) continue;
			result.push(`	p(${x}, ${y}, ${point.location.x}, ${point.location.y}),`);
			
			
			
			
			
			
			
		}
	}
	result.push("]),");
	resultTextArea.value = result.join("\n");
}

function resizeControlPoint() {
	document
		.querySelectorAll(".dragger")
		.forEach((el) => el.parentElement?.removeChild(el));
	mgRenderer.resizeControlPoints(
		ValuesGG.controlPointSize,
		ValuesGG.controlPointSize,
	);
	mgRenderer.resetSubdivition(ValuesGG.subdivideDepth);

	for (let y = 0; y < ValuesGG.controlPointSize; y++) {
		for (let x = 0; x < ValuesGG.controlPointSize; x++) {
			const point = mgRenderer.getControlPoint(x, y);
			if (point === undefined) continue;
			const dragger = document.createElement("div");
			const draggerInput = document.createElement("input");
			draggerInput.type = "color";
			draggerInput.style.position = "absolute";
			draggerInput.style.visibility = "hidden";
			dragger.appendChild(draggerInput);
			dragger.setAttribute("x", `${x}`);
			dragger.setAttribute("y", `${y}`);
			dragger.className = "dragger";
			dragger.style.left = `${(x * 100) / (ValuesGG.controlPointSize - 1)}%`;
			dragger.style.top = `${
				((ValuesGG.controlPointSize - y - 1) * 100) /
				(ValuesGG.controlPointSize - 1)
			}%`;
			draggerInput.addEventListener("input", () => {
				
				const c = draggerInput.value;
				console.log(c);
				dragger.style.backgroundColor = c;
				const color = c.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
				if (color) {
					point.color.r = Number.parseInt(color[1], 16) / 255;
					point.color.g = Number.parseInt(color[2], 16) / 255;
					point.color.b = Number.parseInt(color[3], 16) / 255;
					dragger.setAttribute("r", `${point.color.r}`);
					dragger.setAttribute("g", `${point.color.g}`);
					dragger.setAttribute("b", `${point.color.b}`);
					updateResult();
				}
			});
			let dragging = false;
			dragger.addEventListener("mousedown", (evt) => {
				evt.stopPropagation();
				function onMouseMove(evt: MouseEvent) {
					dragger.style.left = `${Math.min(
						window.innerWidth,
						Math.max(0, evt.clientX),
					)}px`;
					dragger.style.top = `${Math.min(
						window.innerHeight,
						Math.max(0, evt.clientY),
					)}px`;
					if (point) {
						point.location.x = Math.max(
							-1,
							Math.min(1, (evt.clientX / window.innerWidth) * 2 - 1),
						);
						point.location.y = Math.max(
							-1,
							Math.min(1, -((evt.clientY / window.innerHeight) * 2 - 1)),
						);
					}
					dragging = true;
					updateResult();
					evt.stopPropagation();
				}
				function onMouseUp(evt: MouseEvent) {
					if (dragging) {
						dragging = false;
					} else if (dragger.classList.contains("active")) {
						draggerInput.click();
					} else {
						for (const el of document.querySelectorAll(".dragger.active")) {
							el.classList.remove("active");
						}
						dragger.classList.add("active");
					}
					window.removeEventListener("mousemove", onMouseMove);
					window.removeEventListener("mouseup", onMouseUp);
					evt.stopPropagation();
				}
				window.addEventListener("mousemove", onMouseMove);
				window.addEventListener("mouseup", onMouseUp);
			});
			document.body.appendChild(dragger);
		}
	}
}

function subdivide() {
	mgRenderer.resetSubdivition(ValuesGG.subdivideDepth);
}

mgRenderer.setAlbum("bigsur.jpg").then(() => {
	resizeControlPoint();
	subdivide();
});

const gui = new GUI();
gui.close();
gui.title("MG Renderer 调试页面");
gui
	.add(ValuesGG, "controlPointSize", 3, 10, 1)
	.name("控制点矩阵大小")
	.onFinishChange(resizeControlPoint);
gui
	.add(ValuesGG, "subdivideDepth", 2, 50, 1)
	.name("细分深度")
	.onChange(subdivide);
gui
	.add(ValuesGG, "wireFrame")
	.name("线框模式")
	.onChange((v: boolean) => mgRenderer.setWireFrame(v));

const stats = new Stats();
stats.showPanel(0);
stats.dom.style.left = "50px";
document.body.appendChild(stats.dom);
const frame = (time: number) => {
	stats.end();
	stats.begin();
	requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
