import { parseVideoId } from './youtube';

/**
 * Shareable links: ?v=<id or YouTube URL> (repeatable) and an optional &title=… for the first tape.
 *   https://example.com/?v=wzhdzE0I8qI
 *   https://example.com/?v=https://youtu.be/wzhdzE0I8qI&title=My%20tape
 * `tape=` is accepted as an alias for `v=`.
 */
export interface SharedTape { videoId: string; title: string | null }

export function readSharedTapes(search = location.search): SharedTape[] {
  const q = new URLSearchParams(search);
  const ids = [...q.getAll('v'), ...q.getAll('tape')]
    .flatMap((v) => v.split(','))
    .map((v) => parseVideoId(v))
    .filter((id): id is string => !!id);
  const unique = [...new Set(ids)].slice(0, 12);
  const title = q.get('title')?.trim().slice(0, 80) || null;
  return unique.map((videoId, i) => ({ videoId, title: i === 0 ? title : null }));
}

export function shareUrl(videoId: string, title?: string) {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('v', videoId);
  if (title) u.searchParams.set('title', title);
  return u.toString();
}

/** Copy to clipboard; falls back to the native share sheet, then to a prompt. */
export async function copyShareLink(url: string, title: string): Promise<'copied' | 'shared' | 'shown'> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch { /* clipboard blocked (e.g. insecure context) */ }
  try {
    if (navigator.share) { await navigator.share({ title, url }); return 'shared'; }
  } catch { /* user cancelled */ }
  window.prompt('Copy this link:', url);
  return 'shown';
}
