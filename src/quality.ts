import type * as THREE from 'three';

export type Tier = 'high' | 'medium' | 'low';
export const TIERS: Tier[] = ['high', 'medium', 'low'];

export interface TierSettings { pixelRatio: number; dust: number; rain: number; holoInterval: number }

export function settingsFor(tier: Tier): TierSettings {
  const dpr = window.devicePixelRatio || 1;
  switch (tier) {
    case 'high': return { pixelRatio: Math.min(dpr, 2), dust: 1, rain: 1, holoInterval: 0.1 };
    case 'medium': return { pixelRatio: Math.min(dpr, 1.5), dust: 0.5, rain: 0.5, holoInterval: 0.15 };
    case 'low': return { pixelRatio: 1, dust: 0, rain: 0, holoInterval: 0.25 };
  }
}

const KEY = 'crtvhs.quality.v1';

/** ?quality=low|medium|high, else a remembered manual choice, else a guess from the device. */
export function initialTier(): { tier: Tier; locked: boolean } {
  const q = new URLSearchParams(location.search).get('quality') as Tier | null;
  if (q && TIERS.includes(q)) return { tier: q, locked: true };
  try {
    const saved = localStorage.getItem(KEY) as Tier | null;
    if (saved && TIERS.includes(saved)) return { tier: saved, locked: true };
  } catch { /* storage blocked */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return { tier: coarse || weak ? 'medium' : 'high', locked: false };
}

export function rememberTier(tier: Tier) { try { localStorage.setItem(KEY, tier); } catch { /* ignore */ } }

/**
 * Watches frame times and steps quality down when the page can't keep up (avg > 24 ms ≈ 42 fps for
 * ~3 s). It never steps up on its own, to avoid oscillating; the user can pick a tier manually.
 */
export class QualityGovernor {
  private samples: number[] = [];
  private slowFor = 0;
  private cooldown = 4; // ignore the first seconds (shader warm-up, texture uploads)

  constructor(public tier: Tier, public locked: boolean, private apply: (t: Tier, reason: string) => void) {}

  set(tier: Tier, manual: boolean) {
    this.tier = tier;
    if (manual) { this.locked = true; rememberTier(tier); }
    this.samples.length = 0; this.slowFor = 0; this.cooldown = 3;
    this.apply(tier, manual ? 'manual' : 'auto');
  }

  frame(dt: number) {
    if (dt <= 0 || dt > 0.5) return;               // tab switches, breakpoints
    if (this.cooldown > 0) { this.cooldown -= dt; return; }
    this.samples.push(dt);
    if (this.samples.length > 60) this.samples.shift();
    if (this.samples.length < 30 || this.locked) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg > 0.024) this.slowFor += dt; else this.slowFor = Math.max(0, this.slowFor - dt);
    if (this.slowFor > 3) {
      const i = TIERS.indexOf(this.tier);
      if (i < TIERS.length - 1) {
        console.info(`[quality] avg frame ${(avg * 1000).toFixed(1)} ms → stepping down to ${TIERS[i + 1]}`);
        this.set(TIERS[i + 1], false);
      } else this.slowFor = 0;
    }
  }
}

/** Apply pixel ratio without reallocating when unchanged. */
export function applyPixelRatio(renderer: THREE.WebGLRenderer, pr: number) {
  if (Math.abs(renderer.getPixelRatio() - pr) < 1e-3) return;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
}
