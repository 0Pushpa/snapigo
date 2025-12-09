import * as Location from 'expo-location';

/** ---------- Shared types ---------- */

export type BBox = { x: number; y: number; w: number; h: number };
export type OcrLineBlock = { text: string; bbox?: BBox };

/** What the UI expects from the quick parser */
export type ParsedCoupon = {
  store?: string | null;
  address?: string | null;
  phone?: string | null;
  mode?: '' | 'dine-in' | 'pickup';
  location_note?: string | null;
  terms?: string | null;
  title?: string | null;
  expires_at?: string | null; // 👈 NEW
};

/** ---------- Common regex/helpers ---------- */

// Accepts optional country code, optional area code, separators (space/.-/•/·),
// and 7–10 digit phones (to catch local formats like "365 • 0055")
const PHONE_SEP = String.raw`[\s.\-•·]`;
const PHONE_RE = new RegExp(
  String.raw`(?:\+?1${PHONE_SEP}*)?(?:\(?\d{3}\)?${PHONE_SEP}*)?\d{3}${PHONE_SEP}\d{4}`,
  'g'
);

const MODE_RE = /\b(dine[\s-]?in|pickup|pick[\s-]?up)\b/i;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?([a-z0-9\-]+)\.(?:com|net|org|co|us|edu))\b/i;

function toTitleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// e.g., "meltingpot" -> "Melting Pot"
function spacedFromDomainLabel(label: string) {
  const hy = label.split('-').join(' ');
  const withSpaces = hy
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z]{3,})([a-z]{3,})/gi, '$1 $2');
  return toTitleCase(withSpaces);
}

// Normalize brand / line text for comparison: remove punctuation, spaces, ®, etc.
function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** ---------- Lightweight, text-only extractor (keeps your old flow working) ---------- */
/** Heuristics for discount/title */
function pickBestPercent(text: string): number | null {
  const re = /(\d{1,3})\s*%/g;
  let m: RegExpExecArray | null,
    best: number | null = null;
  while ((m = re.exec(text))) {
    const v = parseInt(m[1], 10);
    if (v >= 5 && v <= 100) best = best == null ? v : Math.max(best, v);
  }
  return best;
}
function pickBestAmount(text: string): number | null {
  const re = /(?:\$|USD\s*)\s*(\d+(?:\.\d{2})?)\s*(?:off|discount|save)?/gi;
  let m: RegExpExecArray | null,
    best: number | null = null;
  while ((m = re.exec(text))) {
    const v = parseFloat(m[1]);
    if (!isNaN(v) && v > 0) best = best == null ? v : Math.max(best, v);
  }
  return best;
}

function deriveTitle(raw: string): string | null {
  const p = pickBestPercent(raw);
  if (p != null) return `${p}% off`;
  const a = pickBestAmount(raw);
  if (a != null) return `$${a} off`;
  return null;
}

function extractTerms(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const idx = text.search(/\b(terms|conditions|valid|offer valid|not valid|exclusions|present|only)\b/i);
  if (idx >= 0) {
    const snippet = text.slice(idx);
    return snippet.slice(0, 400);
  }
  return text.slice(Math.max(0, text.length - 300));
}

function detectMode(raw: string): ParsedCoupon['mode'] {
  const m = raw.match(MODE_RE);
  if (!m) return '';
  return m[1].toLowerCase().includes('dine') ? 'dine-in' : 'pickup';
}

/** Extract an expiry date-looking string from the raw OCR text. */
function extractExpiry(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ');

  // 01/05/2026, 1-5-26, 01.05.2026
  const numericRe = /\b(0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])[\/\-\.](20\d{2}|\d{2})\b/;
  const m1 = text.match(numericRe);
  if (m1) return m1[0];

  // Jan 5, 2026 / January 5 2026
  const longRe =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+(20\d{2}|\d{2})\b/i;
  const m2 = text.match(longRe);
  if (m2) return m2[0];

  // "Expires 12/31/26", "Valid thru 12-31-2026"
  const labeledRe =
    /\b(expires?|valid (?:thru|through|until))[:\s]+((0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])[\/\-\.](20\d{2}|\d{2}))\b/i;
  const m3 = text.match(labeledRe);
  if (m3) return m3[2];

  return null;
}

/**
 * Text-only extractor you already use.
 * Store/address are left undefined so the layout-aware extractor can take precedence.
 */
export function extractCouponFields(
  text: string,
  _blocks?: { text: string; bbox?: BBox }[]
): ParsedCoupon {
  const phoneMatch = [...(text.matchAll(PHONE_RE) ?? [])].map((m) => m[0]);
  const pickDigits = (s: string) => (s.match(/\d/g) || []).length;
  const phone = phoneMatch.length ? phoneMatch.sort((a, b) => pickDigits(b) - pickDigits(a))[0] : null;

  const title = deriveTitle(text);
  const terms = extractTerms(text);
  const mode = detectMode(text);
  const expiry = extractExpiry(text); // 👈 NEW

  return {
    store: undefined,
    address: undefined,
    phone,
    mode,
    location_note: null,
    terms,
    title,
    expires_at: expiry, // 👈 NEW
  };
}

/** ---------- Layout-aware extractor (store/address/phone via bbox + optional geocode) ---------- */

const STREET_SUFFIXES = [
  'ST',
  'STREET',
  'AVE',
  'AVENUE',
  'RD',
  'ROAD',
  'BLVD',
  'BOULEVARD',
  'DR',
  'DRIVE',
  'HWY',
  'HIGHWAY',
  'LN',
  'LANE',
  'CT',
  'COURT',
  'PL',
  'PLACE',
  'PKWY',
  'PARKWAY',
  'WAY',
  'TER',
  'TERRACE',
  'CIR',
  'CIRCLE',
];
const ADDRESS_HINTS = [...STREET_SUFFIXES, 'STE', 'SUITE', '#'];
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;

const allCapsRatio = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters) return 0;
  const caps = letters.replace(/[^A-Z]/g, '').length;
  return caps / letters.length;
};

// Make street detection more robust: ignore punctuation and allow "ST." etc.
const hasStreetToken = (s: string) => {
  const normalized = (' ' + s.toUpperCase() + ' ').replace(/[.,]/g, ' '); // "ST." -> " ST "
  return (
    STREET_SUFFIXES.some((tok) => normalized.includes(' ' + tok + ' ')) ||
    ADDRESS_HINTS.some((tok) => normalized.includes(' ' + tok + ' ')) ||
    ZIP_RE.test(s)
  );
};

// Lines that are clearly offers / marketing, not addresses
const ADDRESS_BAD_RE =
  /\b(buy\s*\d|free|%|percent|off\b|save\b|coupon|offer|valid only|customer must)\b/i;

const fuzzyScore = (a: string, b: string) => {
  const A = a.toLowerCase().trim();
  const B = b.toLowerCase().trim();
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.85;
  const at = new Set(A.split(/\s+/));
  const bt = new Set(B.split(/\s+/));
  const inter = [...at].filter((t) => bt.has(t)).length;
  return inter / Math.max(at.size, bt.size);
};

// Try to stitch the top-most 1–3 short lines into a brand-like title (e.g., "Melting" + "Pot")
function stitchTopTitle(lines: { text: string; block?: { bbox?: { y: number } } }[]) {
  const sorted = [...lines].sort(
    (a, b) => (a.block?.bbox?.y ?? 0) - (b.block?.bbox?.y ?? 0)
  );
  const picks: string[] = [];
  for (const l of sorted.slice(0, 5)) {
    const t = l.text.trim();
    if (!t || /\d/.test(t) || t.length > 14) break; // short, no digits
    if (/(www|valid|location|only|grand|rapids|celebration|dr|ne|excludes)/i.test(t)) break;
    picks.push(t);
    if (picks.length >= 3) break;
  }
  if (picks.length >= 2) return toTitleCase(picks.join(' '));
  return null;
}

function scoreStoreCandidate(line: string, block?: OcrLineBlock, brands?: string[]) {
  if (!line.trim()) return -999;
  let score = 0;
  const caps = allCapsRatio(line);
  const hasDigits = /\d/.test(line);
  const hasAddrCue = hasStreetToken(line);
  score += caps * 2;
  if (!hasDigits) score += 0.5;
  if (!hasAddrCue) score += 0.8;

  // 🔥 Stronger brand matching: ignore punctuation & symbols when comparing
  if (brands?.length) {
    const normLine = normalizeName(line);
    let brandBoost = 0;
    for (const b of brands) {
      const nb = normalizeName(b);
      if (!nb || !normLine) continue;
      if (normLine === nb || normLine.includes(nb) || nb.includes(normLine)) {
        brandBoost = 2.5; // big bump if it's clearly that brand
        break;
      }
    }

    if (brandBoost === 0) {
      // fallback to the older fuzzyScore, but weaker
      const bestTokenScore = Math.max(...brands.map((b) => fuzzyScore(line, b)));
      if (bestTokenScore >= 0.8) brandBoost = 2.0;
      else if (bestTokenScore >= 0.6) brandBoost = 1.0;
    }

    score += brandBoost;
  }

  if (block?.bbox) {
    const y = block.bbox.y ?? 0;
    const h = block.bbox.h ?? 0;
    score += Math.max(0, 1.2 - y / 1000); // top-most better
    score += Math.min(1.0, h / 100); // larger font better
    const centerX = (block.bbox.x ?? 0) + (block.bbox.w ?? 0) / 2;
    if (Math.abs(centerX - 200) < 60) score += 0.2; // tweak if you know camera width
  }

  if (line.length > 40) score -= 0.5;
  return score;
}

function scoreAddressCandidate(line: string, idxFromTop: number) {
  const raw = line.trim();
  if (!raw) return -999;

  // Immediately throw away obvious offer/headline lines
  if (ADDRESS_BAD_RE.test(raw)) return -999;

  let score = 0;
  const hasStreet = hasStreetToken(raw);
  const hasZip = ZIP_RE.test(raw);
  const hasPhone = PHONE_RE.test(raw);
  const hasDigits = /\d/.test(raw);

  if (hasStreet) score += 2.5;
  if (hasZip) score += 1.5;
  if (hasPhone) score += 0.6;
  if (hasDigits) score += 0.4;

  // Slight bias for being lower on the page but not too harsh
  score += Math.max(0, 0.8 - idxFromTop * 0.05);

  const len = raw.length;
  if (len < 8 || len > 90) score -= 0.5;

  return score;
}

/**
 * Layout-aware extractor. Use this to get more accurate store/address/phone.
 * Pass OCR blocks with bbox if available; provide brand list to improve ranking.
 */
export async function extractStoreAndAddressFromBlocks(
  blocks: OcrLineBlock[] | undefined,
  allText: string,
  options?: { brands?: string[]; tryGeocode?: boolean }
): Promise<{
  store: string | null;
  address: string | null;
  phone: string | null;
  geo?: { lat: number; lng: number };
}> {
  // Flatten to lines preserving each block's bbox
  const lines: { text: string; block?: OcrLineBlock }[] = [];
  if (blocks?.length) {
    for (const b of blocks) {
      const parts = (b.text || '')
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of parts) lines.push({ text: s, block: b });
    }
  } else {
    allText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => lines.push({ text: s }));
  }

  // ---- Brand hints from URL and stitched top title
  let urlBrand: string | null = null;
  {
    const allJoined = lines.map((l) => l.text).join(' ');
    const m = allJoined.match(URL_RE);
    if (m && m[2]) urlBrand = spacedFromDomainLabel(m[2]);
  }
  const stitchedTop = stitchTopTitle(lines);

  // Build base store candidates
  const baseStoreCands: { text: string; block?: OcrLineBlock; score: number }[] = lines.map(
    (l) => ({
      ...l,
      score: scoreStoreCandidate(l.text, l.block, options?.brands),
    })
  );

  if (stitchedTop) {
    baseStoreCands.push({
      text: stitchedTop,
      block: undefined,
      score: scoreStoreCandidate(stitchedTop, undefined, options?.brands) + 1.0,
    });
  }
  if (urlBrand) {
    baseStoreCands.push({
      text: urlBrand,
      block: undefined,
      score: scoreStoreCandidate(urlBrand, undefined, options?.brands) + 1.2,
    });
  }

  const storeCandidates = baseStoreCands
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const addressCandidates = lines
    .map((l, i) => ({ ...l, score: scoreAddressCandidate(l.text, i), idx: i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Optional: geocode validate to pick the best address
  let bestAddress: string | null = null;
  let bestGeo: { lat: number; lng: number } | undefined;
  if (options?.tryGeocode !== false && addressCandidates.length) {
    let bestScore = -999;
    for (const cand of addressCandidates) {
      try {
        const g = await Location.geocodeAsync(cand.text);
        if (g?.length) {
          const geoScore =
            2.0 +
            (ZIP_RE.test(cand.text) ? 0.3 : 0) +
            (hasStreetToken(cand.text) ? 0.2 : 0);
          const total = cand.score + geoScore;
          if (total > bestScore) {
            bestScore = total;
            bestAddress = cand.text;
            bestGeo = { lat: g[0].latitude, lng: g[0].longitude };
          }
        }
      } catch {
        // ignore geocode failures, we'll fallback
      }
    }
  }
  if (!bestAddress && addressCandidates[0]) bestAddress = addressCandidates[0].text;

  const store = storeCandidates[0]?.text || null;

  // Prefer a 10-digit phone if present; else first match
  let phone: string | null = null;
  {
    const matches = [...(allText.matchAll(PHONE_RE) ?? [])].map((m) => m[0]);
    if (matches.length) {
      const digits = (s: string) => (s.match(/\d/g) || []).length;
      matches.sort((a, b) => digits(b) - digits(a));
      phone = matches[0] || null;
    }
  }

  return { store, address: bestAddress, phone, geo: bestGeo };
}
