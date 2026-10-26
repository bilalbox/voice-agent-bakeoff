/** Map spoken digit words (and plain digits) into a digit string. */
const WORD_DIGITS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/**
 * Extract digits from ASR text like "one zero eight eight" or "555-010-8800".
 */
export function digitsFromSpoken(input: string): string {
  const raw = input.trim();
  if (!raw) return "";

  const compactDigits = raw.replace(/\D/g, "");
  if (compactDigits.length >= 3) return compactDigits;

  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let out = "";
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      out += t;
      continue;
    }
    const mapped = WORD_DIGITS[t];
    if (mapped) out += mapped;
  }
  return out;
}

/** Normalize job ids from speech: "job one zero eight eight" → "1088". */
export function normalizeJobId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const bookMatch = trimmed.match(/\b(book-[a-z0-9-]+)\b/i);
  if (bookMatch && bookMatch[1]) return bookMatch[1];
  const digits = digitsFromSpoken(trimmed);
  if (digits) return digits;
  return trimmed;
}
