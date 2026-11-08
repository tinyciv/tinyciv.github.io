let cabin: HTMLImageElement | undefined, hermit: HTMLImageElement | undefined, fire: HTMLImageElement | undefined;
let outline: HTMLCanvasElement | undefined;
export async function loadHermitArt(): Promise<void> {
  const load = (name: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
    image.src = `${import.meta.env.BASE_URL}assets/hermit/${name}.png`;
  });
  [cabin, hermit, fire] = await Promise.all(['cabin', 'hermit', 'fire'].map(load));
  outline = document.createElement('canvas'); outline.width = 18; outline.height = 18;
  const c = outline.getContext('2d')!;
  for (const [x,y] of [[0,1],[2,1],[1,0],[1,2]]) c.drawImage(hermit, x, y);
  c.globalCompositeOperation = 'source-in'; c.fillStyle = '#fff1af'; c.fillRect(0,0,18,18);
  c.globalCompositeOperation = 'destination-out'; c.drawImage(hermit,1,1);
}
export function drawHermitCabin(c: CanvasRenderingContext2D, frame: number, active: boolean): void {
  c.imageSmoothingEnabled = false;
  if (cabin) c.drawImage(cabin, 0, 0, 32, 32);
  if (active && fire) c.drawImage(fire, frame * 4, 0, 4, 4, 3, 32, 8, 8);
}
export function drawHermit(c: CanvasRenderingContext2D, highlight: boolean, fleeing: boolean, frame: number): void {
  c.imageSmoothingEnabled = false;
  const bob = fleeing ? frame % 2 : 0;
  if (highlight && outline) c.drawImage(outline, 1, 1 + bob, 25.2, 25.2);
  if (hermit) c.drawImage(hermit, 2.4, 2.4 + bob, 22.4, 22.4);
}
