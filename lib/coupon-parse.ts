// lib/coupon-parse.ts
export type Block = { text: string; bbox?: { x: number; y: number; w: number; h: number } };
export type ParsedCoupon = {
  store?: string;
  titleFromDiscount?: string; // convenience; you already compute title separately too
  location_note?: string;
  address?: string;
  phone?: string;
  mode?: 'dine-in' | 'pickup';
  terms?: string;
};

const tidy = (s: string) => s.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim();

const phoneRe = /\b(?:\(?\d{3}\)?[-.\s]*)?\d{3}[-.\s]?\d{4}\b/;
const addressStreetType = /\b(Ave|Avenue|St|Street|Rd|Road|Blvd|Drive|Dr|Ct|Court|Way|Lane|Ln|Ter|Terrace|Pl|Place)\b/i;
const addressLeadingNum = /^\d{3,6}\s+[A-Za-z0-9.'-]+/;
const isAddress = (s: string) => addressLeadingNum.test(s) && addressStreetType.test(s);

const isLocationNote = (s: string) => /^valid at .* location only\b/i.test(s);
const isModeLine = (s: string) => /\b(dine\s*in|pick\s*up|carry[-\s]?out)\b.*\bonly\b/i.test(s);
const isBoiler = (s: string) =>
  /^not valid/i.test(s) || /(other offers|holidays|senior citizen|children's|childrens)/i.test(s);

const isDiscountLine = (s: string) =>
  /(\d{1,3})\s*%/.test(s) || /(?:\$|USD\s*)\s*\d+(?:\.\d{2})?/.test(s) || /\bbogo\b/i.test(s);

function pickStore(lines: string[], blocks?: Block[]): string | undefined {
  // Prefer positional info: top-most non-boilerplate line that isn't clearly meta
  if (blocks?.length) {
    const sorted = blocks
      .map((b, i) => ({ i, y: b.bbox?.y ?? 1, t: tidy(b.text) }))
      .filter(b => b.t)
      .sort((a, b) => a.y - b.y);

    const cand = sorted.find(b =>
      !isBoiler(b.t) && !isLocationNote(b.t) && !isModeLine(b.t) && !isDiscountLine(b.t)
    );
    if (cand) return cand.t.length <= 60 ? cand.t : undefined;
  }
  // Fallback: first reasonable line
  const cand2 = lines.find(l => !isBoiler(l) && !isLocationNote(l) && !isModeLine(l) && !isDiscountLine(l));
  return cand2 && cand2.length <= 60 ? cand2 : lines[0];
}

export function extractCouponFields(raw: string, blocks?: Block[]): ParsedCoupon {
  const lines = raw.split(/\r?\n/).map(tidy).filter(Boolean);

  const store = pickStore(lines, blocks);

  // location note, address, phone, mode
  let location_note: string | undefined;
  let address: string | undefined;
  let phone: string | undefined;
  let mode: 'dine-in' | 'pickup' | undefined;

  for (const line of lines) {
    if (!location_note && isLocationNote(line)) location_note = line;
    if (!address && isAddress(line)) address = line;
    if (!phone && phoneRe.test(line)) phone = line.match(phoneRe)?.[0]!;
    if (!mode && isModeLine(line)) mode = /dine\s*in/i.test(line) ? 'dine-in' : 'pickup';

    // Handle "addr • phone" single line
    if (!address || !phone) {
      const parts = line.split(/•|\u2022/).map(tidy);
      if (parts.length === 2) {
        if (!address && isAddress(parts[0])) address = parts[0];
        if (!phone && phoneRe.test(parts[1])) phone = parts[1].match(phoneRe)?.[0]!;
      }
    }
  }

  // Terms = everything that looks like policy text, excluding the recognized fields
  const omit = new Set([store, location_note, address].filter(Boolean) as string[]);
  const termsLines = lines.filter(l =>
    !omit.has(l) && !phoneRe.test(l) && !isModeLine(l) && !isDiscountLine(l)
  );
  const terms = termsLines.join('\n').trim() || undefined;

  return { store, location_note, address, phone, mode, terms };
}
