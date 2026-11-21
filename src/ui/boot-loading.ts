export function setBootProgress(value: number): void {
    const progress = document.querySelector<HTMLProgressElement>('#boot-progress');
    const percent = document.querySelector('#boot-loading output');
    if (progress) progress.value = value;
    if (percent) percent.textContent = `${Math.round(value * 100)}%`;
}

export function finishBootLoading(): void {
    document.querySelector('#boot-loading')?.remove();
}

export function showBootFontError(): void {
    const boot = document.querySelector('#boot-loading');
    const error = boot?.querySelector<HTMLElement>('.boot-loading-error');
    if (!error) return;
    boot?.querySelector('.boot-loading-progress')?.setAttribute('hidden', '');
    error.hidden = false;
    const retry = error.querySelector('button')!;
    retry.onclick = () => location.reload();
    retry.focus();
}
