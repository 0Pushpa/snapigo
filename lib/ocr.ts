// lib/ocr.ts
import { Platform, NativeModules } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";

export type OcrBlocks = { text: string; bbox?: { x: number; y: number; w: number; h: number } }[];
export type OcrResult = { text: string; blocks?: OcrBlocks; engine: "ios-vision" };

const TARGET_LONG_EDGE = 1800;

export async function prepareForOcr(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: TARGET_LONG_EDGE } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );
  return out.uri;
}

export async function runOcr(uri: string): Promise<OcrResult> {
  const maybeNative = (NativeModules as any)?.OcrModule?.recognize;
  if (Platform.OS === "ios" && typeof maybeNative === "function") {
    const blocks: OcrBlocks = await maybeNative(uri);
    const text = blocks?.map(b => b.text).join("\n") || "";
    return { text, blocks, engine: "ios-vision" };
  }
  throw new Error("Apple Vision OcrModule not found. Add it (below) and rebuild the iOS app.");
}

export type CouponBasics = {
  storeGuess?: string;
  discount_kind?: "percent" | "amount" | "bogo";
  discount_value?: number;
  expires_guess?: string | null;
};

export function parseCouponBasics(raw: string): CouponBasics {
  const text = raw.replace(/[ \t]+/g, " ").replace(/\u00A0/g, " ").trim();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const storeGuess =
    lines.find(l => isLikelyMerchant(l)) ?? (lines[0]?.length <= 40 ? lines[0] : undefined);

  const percent = pickBestPercent(text);
  const amount  = pickBestAmount(text);
  const bogo    = /\b(bogo|buy\s*1\s*get\s*1)\b/i.test(text);

  let discount_kind: CouponBasics["discount_kind"] | undefined;
  let discount_value: number | undefined;
  if (percent != null) { discount_kind = "percent"; discount_value = percent; }
  else if (amount != null) { discount_kind = "amount"; discount_value = amount; }
  else if (bogo) { discount_kind = "bogo"; }

  const expires_guess = detectExpiryISO(text);
  return { storeGuess, discount_kind, discount_value, expires_guess };
}

function isLikelyMerchant(line: string) {
  const bad = /(valid|coupon|expires|discount|percent|%|off|save|only|terms|conditions|present|offer)/i;
  const hasLetters = /[A-Za-z]/.test(line);
  return hasLetters && !bad.test(line) && line.length <= 40;
}

function pickBestPercent(text: string): number | null {
  const re = /(\d{1,3})\s*%/g; let m: RegExpExecArray | null; let best: number | null = null;
  while ((m = re.exec(text))) { const v = parseInt(m[1],10); if (v>=5 && v<=100) best = best==null? v : Math.max(best,v); }
  return best;
}
function pickBestAmount(text: string): number | null {
  const re = /(?:\$|USD\s*)\s*(\d+(?:\.\d{2})?)\s*(?:off|discount|save)?/gi;
  let m: RegExpExecArray | null; let best: number | null = null;
  while ((m = re.exec(text))) { const v = parseFloat(m[1]); if (!isNaN(v) && v>0) best = best==null? v : Math.max(best,v); }
  return best;
}
function detectExpiryISO(text: string): string | null {
  const month = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{2,4})?)/i.exec(text)?.[1];
  if (month) { const iso = toISO(month); if (iso) return iso; }
  const num = /((?:\d{1,2})[\/\-](?:\d{1,2})[\/\-](?:\d{2,4}))/i.exec(text)?.[1];
  if (num) { const iso = numericToISO(num); if (iso) return iso; }
  return null;
}
function toISO(s: string) { const d = new Date(s.replace(/,/g,"")); return isNaN(d.getTime())? null : toISODateOnly(d); }
function numericToISO(s: string) {
  const [a,b,c] = s.split(/[\/\-]/).map(v=>v.trim()); let mm=+a, dd=+b, yy=+c; if (yy<100) yy+=2000;
  if (!(mm>=1&&mm<=12&&dd>=1&&dd<=31)) { mm=+b; dd=+a; }
  const d = new Date(yy, mm-1, dd); return isNaN(d.getTime())? null : toISODateOnly(d);
}
function toISODateOnly(d: Date) { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
