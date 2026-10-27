/**
 * Optional remote seed helper — prefer POST /admin/seed against a running Worker.
 * Usage: EDGE_URL=https://… SEED_TOKEN=… npx tsx scripts/seed.ts
 */

const edge = (process.env.EDGE_URL ?? "http://127.0.0.1:8787").replace(
	/\/$/,
	"",
);
const token = process.env.SEED_TOKEN ?? "dev-seed-token";

const res = await fetch(`${edge}/admin/seed`, {
	method: "POST",
	headers: { "x-seed-token": token },
});
console.log(res.status, await res.text());

export {};
