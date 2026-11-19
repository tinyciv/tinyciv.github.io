async function playBootFilm(): Promise<void> {
    const video = document.querySelector<HTMLVideoElement>('#boot-loading video');
    if (!video || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
        const format = video.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4';
        const response = await fetch(`${import.meta.env.BASE_URL}assets/ui/loading/settlement-assault.${format}`);
        if (!response.ok) return;
        const film = await response.blob();
        if (!video.isConnected) return;
        video.src = URL.createObjectURL(film);
        video.addEventListener('ended', () => video.classList.add('is-finished'), { once: true });
        video.muted = true;
        await video.play();
    } catch { video.hidden = true; /* The film frame shows its poster underneath the video. */ }
}

export function setBootProgress(value: number): void {
    const progress = document.querySelector<HTMLProgressElement>('#boot-progress');
    const percent = document.querySelector('#boot-loading output');
    if (progress) progress.value = value;
    if (percent) percent.textContent = `${Math.round(value * 100)}%`;
}

export function finishBootLoading(): void {
    const boot = document.querySelector('#boot-loading');
    const video = boot?.querySelector('video');
    video?.pause();
    if (video?.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
    boot?.remove();
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

void playBootFilm();
