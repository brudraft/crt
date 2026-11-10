const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const loadingUI = {
  progress(frac: number) {
    const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
    $('loading-fill').style.width = pct + '%';
    $('loading-pct').textContent = pct + '%';
  },
  done() {
    const el = $('loading');
    el.classList.add('done');
    setTimeout(() => el.remove(), 700);
  },
  fail(msg: string) {
    $('loading-pct').textContent = msg;
  },
};

export function showContractError(lines: string[]) {
  const el = $('contract-error');
  el.hidden = false;
  el.textContent =
    'SCENE CONTRACT FAILED – public/crt_vhs_scene.glb is missing required objects.\n' +
    'Fix the GLB (see README → Scene contract) or run `npm run check:glb`.\n\n' +
    lines.join('\n');
}

export interface TapeListItem { id: string; title: string }

export interface UIHandlers {
  onAddTape(url: string, title: string | null): Promise<{ ok: boolean; msg: string; needTitle?: boolean }>;
  onRemoveTape(id: string): void;
  onPlayTape(id: string): void;
  onShareTape(id: string): void;
  onToggleMute(): void;
  onToggleSfx(): void;
  onHome(): void;
  onUnmuteHint(): void;
}

export function setupUI(h: UIHandlers) {
  const form = $<HTMLFormElement>('tape-form');
  const url = $<HTMLInputElement>('tape-url');
  const titleRow = $('title-row');
  const title = $<HTMLInputElement>('tape-title');
  const msg = $('tape-msg');
  const list = $<HTMLUListElement>('tape-list');
  const mute = $<HTMLButtonElement>('btn-mute');
  const sfx = $<HTMLButtonElement>('btn-sfx');
  const hint = $<HTMLButtonElement>('unmute-hint');

  const say = (text: string, err = false) => { msg.textContent = text; msg.classList.toggle('err', err); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]') as HTMLButtonElement;
    btn.disabled = true;
    say('Recording…');
    try {
      const res = await h.onAddTape(url.value.trim(), titleRow.hidden ? null : title.value.trim() || null);
      say(res.msg, !res.ok);
      if (res.needTitle) { titleRow.hidden = false; title.focus(); }
      else if (res.ok) { url.value = ''; title.value = ''; titleRow.hidden = true; }
    } finally { btn.disabled = false; }
  });

  mute.addEventListener('click', () => h.onToggleMute());
  sfx.addEventListener('click', () => h.onToggleSfx());
  $('btn-home').addEventListener('click', () => h.onHome());
  hint.addEventListener('click', () => h.onUnmuteHint());

  return {
    say,
    toggleMute() { h.onToggleMute(); },
    setTapes(items: TapeListItem[]) {
      list.replaceChildren(...items.map((t) => {
        const li = document.createElement('li');
        const s = document.createElement('span'); s.textContent = '▮ ' + t.title; s.title = t.title;
        const play = document.createElement('button'); play.type = 'button'; play.textContent = '▶';
        play.setAttribute('aria-label', `Load tape “${t.title}”`);
        play.addEventListener('click', () => h.onPlayTape(t.id));
        const share = document.createElement('button'); share.type = 'button'; share.textContent = '🔗';
        share.setAttribute('aria-label', `Copy share link for “${t.title}”`);
        share.title = 'Copy a link that opens the room with this tape';
        share.addEventListener('click', () => h.onShareTape(t.id));
        const del = document.createElement('button'); del.type = 'button'; del.textContent = '✕';
        del.setAttribute('aria-label', `Erase tape “${t.title}”`);
        del.addEventListener('click', () => h.onRemoveTape(t.id));
        li.append(s, play, share, del);
        return li;
      }));
    },
    setMuted(muted: boolean) {
      mute.textContent = muted ? '🔇 SOUND OFF' : '🔊 SOUND ON';
      mute.setAttribute('aria-pressed', String(muted));
    },
    setSfx(on: boolean) {
      sfx.textContent = on ? 'SFX ON' : 'SFX OFF';
      sfx.setAttribute('aria-pressed', String(on));
    },
    showUnmuteHint(show: boolean) { hint.hidden = !show; },
    onQuality(fn: () => void) { $('btn-quality').addEventListener('click', fn); },
    setQuality(label: string, tier: string) {
      const b = $<HTMLButtonElement>('btn-quality');
      b.textContent = '⚙ ' + label;
      b.title = `Graphics quality: ${tier} (click to change)`;
      b.setAttribute('aria-label', `Graphics quality ${tier}. Click to change.`);
    },
    showFatal(msg: string) {
      const el = $('contract-error');
      el.hidden = false;
      el.textContent = msg + String.fromCharCode(10, 10);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Reload';
      btn.addEventListener('click', () => location.reload());
      el.append(btn);
      btn.focus();
    },
    setCursor(c: string) { document.body.style.cursor = c; },
  };
}
export type UI = ReturnType<typeof setupUI>;
