// lib/ocr.ts
import textRecognition from '@react-native-ml-kit/text-recognition';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export async function prepareForOcr(uri: string) {
  // keep memory low, good accuracy
  const { uri: resized } = await manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.9, format: SaveFormat.JPEG }
  );
  return resized;
}

export async function runOcr(imageUri: string) {
  // { text, blocks, ... }
  return await textRecognition.recognize(imageUri);
}

export function parseCouponBasics(fullText: string) {
  const text = fullText.replace(/\s+/g, ' ').trim();

  const percent = text.match(/(\d{1,2})\s*%/)?.[1];
  const amount  = text.match(/\$?\s*(\d{1,3})(?:\.\d{1,2})?\s*(?:off|discount)/i)?.[1];

  const expires =
    text.match(/\b(?:exp(?:ires|\.?)?|valid\s*until)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)?.[1] ??
    text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/)?.[1] ?? null;

  const brand = (() => {
    const lines = fullText.split(/\n+/).map(s => s.trim()).filter(Boolean);
    for (const ln of lines.slice(0, 6)) {
      const lower = ln.toLowerCase();
      if (/\b(valid|terms|conditions|only|expires|coupon|code)\b/.test(lower)) continue;
      if (ln.length >= 3 && ln.split(/\s+/).length >= 2) return ln.slice(0, 60);
    }
    return null;
  })();

  let discount_kind: 'percent'|'amount'|'other'|null = null;
  let discount_value: number|null = null;
  if (percent) { discount_kind = 'percent'; discount_value = Number(percent); }
  else if (amount) { discount_kind = 'amount'; discount_value = Number(amount); }

  return { storeGuess: brand, discount_kind, discount_value, expires_guess: expires };
}
