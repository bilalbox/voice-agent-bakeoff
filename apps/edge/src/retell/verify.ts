/**
 * Retell X-Retell-Signature verification (HMAC-SHA256).
 * Header format: v={timestamp_ms},d={hex_digest}
 * Digest = HMAC-SHA256(raw_body + timestamp, api_key)
 * @see https://docs.retellai.com/features/secure-webhook
 */

export async function verifyRetellSignature(
	rawBody: string,
	apiKey: string,
	signatureHeader: string | null,
	opts?: { maxSkewMs?: number; nowMs?: number },
): Promise<boolean> {
	if (!signatureHeader) return false;
	const match = /v=(\d+),d=([0-9a-fA-F]+)/.exec(signatureHeader);
	if (!match || !match[1] || !match[2]) return false;

	const timestamp = match[1];
	const digest = match[2].toLowerCase();
	const now = opts?.nowMs ?? Date.now();
	const maxSkew = opts?.maxSkewMs ?? 5 * 60 * 1000;
	const tsNum = Number(timestamp);
	if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > maxSkew) return false;

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(apiKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		enc.encode(rawBody + timestamp),
	);
	const computed = [...new Uint8Array(sig)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	return timingSafeEqual(computed, digest);
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let out = 0;
	for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return out === 0;
}
