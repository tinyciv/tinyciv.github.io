import './military-action-icons.css';

export type MilitaryActionIcon = 'garrison' | 'levy';

/** Approved imagegen artwork: recruitment left, garrison right. */
export function militaryActionIcon(name: MilitaryActionIcon): string {
  return `<span aria-hidden="true" class="icon military-action-icon ${name}-action-icon" style="background-image:url('${import.meta.env.BASE_URL}assets/runtime/ui/military/actions-simple.webp')"></span>`;
}
