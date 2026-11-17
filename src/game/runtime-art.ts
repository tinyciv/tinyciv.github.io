import artwork from '../generated/runtime-art.json';

const urls: Readonly<Record<string, string>> = artwork;

/** Keep authoring URLs readable while fetching the smallest runtime version.
 * Native sprite dimensions and pixel data are preserved by the offline build. */
export function runtimeArtUrl(url: string): string {
  const base = import.meta.env.BASE_URL;
  const relative = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, '');
  const replacement = urls[relative];
  return replacement ? `${base}${replacement}` : url;
}
