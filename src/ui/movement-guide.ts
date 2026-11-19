import './movement-guide.css';

export function movementGuideMarkup(): string {
    return `<figure class="movement-guide" aria-label="Move the Leader with W up, A left, S down, and D right">
      <figcaption>Move the Leader</figcaption>
      <div class="movement-guide-keys" aria-hidden="true">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
      </div>
      <div class="movement-guide-field" aria-hidden="true">
        <div class="movement-guide-leader"><i></i><i></i><i></i><i></i></div>
      </div>
    </figure>`;
}
