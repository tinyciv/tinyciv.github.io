import { runtimeArtUrl } from '../game/runtime-art';
import './science-icon.css';

export const SCIENCE_ICON_URL = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/ui/resources/science.png`);

export function scienceIcon(): string {
  return `<img class="science-icon" src="${SCIENCE_ICON_URL}" alt="" aria-hidden="true">`;
}
