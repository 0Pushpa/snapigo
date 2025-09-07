// utils/params.ts
export function toStr(v: unknown, fallback = ""): string {
    if (Array.isArray(v)) return v[0] ?? fallback;
    if (typeof v === "string") return v;
    if (v == null) return fallback;
    return String(v);
  }
  
  export function toNum(v: unknown, fallback = 0): number {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return Number.isFinite(n) ? n : fallback;
  }
  
  export function toBool(v: unknown, fallback = false): boolean {
    const s = Array.isArray(v) ? v[0] : v;
    if (s === "true" || s === true) return true;
    if (s === "false" || s === false) return false;
    return fallback;
  }
  