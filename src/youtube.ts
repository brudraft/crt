/* YouTube helpers: ID parsing, oEmbed title lookup, IFrame Player API wrapper. */

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Parse a video ID from watch, youtu.be, shorts, embed, live and music URLs (or a bare ID). */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  let u: URL;
  try { u = new URL(s.includes('://') ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

/** Title via oEmbed. Returns null if the browser/network blocks it. */
export async function fetchTitle(id: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { signal: ctl.signal, referrerPolicy: 'strict-origin-when-cross-origin' });
    clearTimeout(to);
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.title === 'string' && j.title ? j.title : null;
  } catch {
    return null;
  }
}

export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

let apiPromise: Promise<any> | null = null;
export function loadIframeApi(): Promise<any> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube IFrame API failed to load')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export const YTState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface PlayerEvents {
  onState(state: number): void;
  onError(code: number): void;
}

/**
 * Lazily-created player. The <iframe> is created by us (so we control referrerpolicy, allow= and the
 * privacy-enhanced host) and then handed to YT.Player, which drives it via postMessage.
 */
export class TapePlayer {
  private player: any = null;
  private iframe: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;

  constructor(private host: HTMLElement, private events: PlayerEvents) {}

  get exists() { return !!this.player; }

  private create(id: string): Promise<void> {
    this.ready = loadIframeApi().then((YT) => new Promise<void>((resolve) => {
      const p = new URLSearchParams({
        enablejsapi: '1', controls: '0', disablekb: '1', modestbranding: '1', playsinline: '1',
        rel: '0', iv_load_policy: '3', fs: '0', autoplay: '0', origin: location.origin,
      });
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?${p}`;
      f.title = 'VHS tape playback';
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      f.setAttribute('tabindex', '-1');
      f.width = '640'; f.height = '480';
      this.host.prepend(f);
      this.iframe = f;
      this.player = new YT.Player(f, {
        events: {
          onReady: () => resolve(),
          onStateChange: (e: any) => this.events.onState(e.data),
          onError: (e: any) => this.events.onError(e.data),
        },
      });
    }));
    return this.ready;
  }

  /** Load + start a video. Resolves 'sound' | 'muted' | 'failed' depending on what autoplay allowed. */
  async start(id: string, volume: number): Promise<'sound' | 'muted' | 'failed'> {
    if (!this.player) await this.create(id);
    else await this.ready;
    const pl = this.player;
    pl.unMute();
    pl.setVolume(volume);
    pl.loadVideoById({ videoId: id, startSeconds: 0 });
    if (await this.waitPlaying(2500)) return pl.isMuted() ? 'muted' : 'sound';
    // Autoplay with sound was blocked → retry muted.
    pl.mute();
    pl.playVideo();
    if (await this.waitPlaying(3000)) return 'muted';
    return 'failed';
  }

  private waitPlaying(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const s = this.player?.getPlayerState?.();
        if (s === YTState.PLAYING) return resolve(true);
        if (performance.now() - t0 > ms) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  stop() { this.player?.pauseVideo(); this.player?.seekTo(0, true); }
  unload() { this.player?.stopVideo(); }
  seekBy(sec: number) {
    if (!this.player) return;
    const t = this.player.getCurrentTime() ?? 0;
    const d = this.player.getDuration() ?? 0;
    this.player.seekTo(Math.max(0, d ? Math.min(d - 1, t + sec) : t + sec), true);
  }
  setVolume(v: number) { this.player?.setVolume(v); }
  mute() { this.player?.mute(); }
  unMute() { this.player?.unMute(); }
  isMuted(): boolean { return !!this.player?.isMuted?.(); }
  time(): number { return this.player?.getCurrentTime?.() ?? 0; }
  duration(): number { return this.player?.getDuration?.() ?? 0; }
  setVisible(v: boolean) { if (this.iframe) this.iframe.style.visibility = v ? 'visible' : 'hidden'; }
}
