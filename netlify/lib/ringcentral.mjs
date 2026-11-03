// RingCentral SMS helper (JWT auth).
// Env: RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT (JWT credential of the user who
//      owns the sending number), RC_FROM (sending number, e.g. +16089214943)
// Optional: RC_SERVER (defaults to production)

let cached = null;

async function rcAuth() {
  if (cached && cached.exp > Date.now()) return cached.token;
  const { RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT } = process.env;
  if (!RC_CLIENT_ID || !RC_CLIENT_SECRET || !RC_JWT) throw new Error("RingCentral env vars missing");
  const server = process.env.RC_SERVER || "https://platform.ringcentral.com";
  const res = await fetch(`${server}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: RC_JWT }),
  });
  if (!res.ok) throw new Error(`RingCentral auth failed (${res.status})`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return cached.token;
}

// Returns +1XXXXXXXXXX or null for anything that isn't a 10-digit US number.
export function toE164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function sendSms(to, text, from = process.env.RC_FROM) {
  const token = await rcAuth();
  const server = process.env.RC_SERVER || "https://platform.ringcentral.com";
  const res = await fetch(`${server}/restapi/v1.0/account/~/extension/~/sms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: { phoneNumber: from }, to: [{ phoneNumber: to }], text }),
  });
  if (!res.ok) throw new Error(`RingCentral SMS failed (${res.status})`);
  return res.json();
}
