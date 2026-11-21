import './movement-guide.css';

// The walking sheet and route are ordered north, west, south, east.
const directions = ['w', 'a', 's', 'd'] as const;

export function movementGuideMarkup(): string {
    return `<figure class="movement-guide" aria-label="Move the Leader with W up, A left, S down, and D right">
      <figcaption>Move the Leader</figcaption>
      <div class="movement-guide-keys" aria-hidden="true">
        ${directions.map(key => `<kbd data-guide-key="${key}">${key.toUpperCase()}</kbd>`).join('')}
      </div>
      <div class="movement-guide-field" aria-hidden="true">
        <div class="movement-guide-leader">${directions.map(key => `<span data-guide-key="${key}"></span>`).join('')}</div>
      </div>
    </figure>`;
}
