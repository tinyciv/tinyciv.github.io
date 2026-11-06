/** Code-native pixel emblems use the existing HUD's dark outlines, brass and cloth. */
export type MilitaryActionIcon = 'garrison' | 'levy';
export type MilitaryIconStyle = 'stone' | 'brass' | 'compact';
const safeColor = (color: string): string => /^#[\da-f]{6}$/i.test(color) ? color : '#c94c4c';
export function militaryActionIcon(name: MilitaryActionIcon, color: string, style: MilitaryIconStyle = 'stone'): string {
  const cloth = safeColor(color), brass = style === 'brass', compact = style === 'compact';
  const stone = brass ? '#a88b53' : '#9aa397', light = brass ? '#e6ce8d' : '#d2d7bd', shade = brass ? '#6c5639' : '#58665e';
  const ink = '#26302e', canvas = (body: string) => `<svg aria-hidden="true" class="icon military-action-icon ${name}-action-icon" viewBox="0 0 32 32" shape-rendering="crispEdges">${body}</svg>`;
  if (name === 'garrison') return canvas(`
    <path fill="${ink}" d="M2 8V3h6v3h4V3h6v3h4V3h7v5h2v23H2Z"/>
    <path fill="${shade}" d="M4 9h25v18H4Z"/>
    <path fill="${stone}" d="M4 5h2v3h8V5h2v3h8V5h3v7H4Z"/>
    <path fill="${light}" d="M4 8h23v2H4Z"/>
    <path fill="${ink}" d="m16 10 10 15H6Z"/>
    <path fill="${cloth}" d="m16 12 8 12H8Z"/>
    <path fill="${brass ? '#ead292' : '#e1b570'}" d="m16 12 2 12h-8Z"/>
    <path fill="${ink}" d="m16 17 3 7h-6Z"/>
    <path fill="${stone}" d="M4 12h4v12h4v5H4Zm21 0h4v17h-9v-5h5Z"/>
    <path fill="${light}" d="M4 12h4v2H4Zm21 0h4v2h-4ZM4 24h8v2H4Zm16 0h12v2H20Z"/>
    ${compact ? '' : `<path fill="${shade}" d="M4 18h4v2H4Zm21 0h4v2h-4ZM8 26h2v3H8Zm15 0h2v3h-2Z"/>`}
    <path fill="${ink}" d="M13 24h6v7h-6Z"/>
    <path fill="#a88b53" d="M13 27h6v2h-6Z"/>
  `);
  const person = (x: number, y: number) => `<g transform="translate(${x} ${y})">
    <path fill="${ink}" d="M-3-1h6v2h1v5H3v2h2v8H3v5H0v-4h-1v4h-3v-5h-3V8h3V6h-1V1h1Z"/>
    <path fill="#765332" d="M-2 0h4v2h-4Z"/><path fill="#d7ab71" d="M-2 2h4v4h-4Z"/>
    <path fill="${brass ? '#bda56d' : cloth}" d="M-3 8h6v7h-6Z"/>
    <path fill="${brass ? '#e6ce8d' : '#ecd69d'}" d="M-3 8h6v2h-6Z"/>
    <path fill="#725332" d="M-2 15h2v4h-2Zm3 0h2v4H1Z"/>
    <path fill="${ink}" d="M4 0h3v11H4Z"/><path fill="${light}" d="M5 0h1v8H5Z"/>
    <path fill="#c9b278" d="M3 8h4v2H3Z"/><path fill="#d7ab71" d="M3 10h3v2H3Z"/>
    ${compact ? '' : '<path fill="#34483c" d="M-3 12h6v2h-6Z"/>'}
  </g>`;
  return canvas(person(5, 9) + person(25, 9) + person(15, 6));
}
