// Salesforce (Jungo) helpers for the client survey.
// Auth: OAuth 2.0 client credentials flow against an External Client App
// whose "Run As" user is a dedicated integration user.
// Env: SF_DOMAIN (My Domain URL, e.g. https://yourorg.my.salesforce.com),
//      SF_CLIENT_ID, SF_CLIENT_SECRET
// No client data is ever logged.

const API = "v62.0";
export const LOAN = "MtgPlanner_CRM__Transaction_Property__c";

let cached = null; // { token, instanceUrl, exp }

export async function sfAuth() {
  if (cached && cached.exp > Date.now()) return cached;
  const { SF_DOMAIN, SF_CLIENT_ID, SF_CLIENT_SECRET } = process.env;
  if (!SF_DOMAIN || !SF_CLIENT_ID || !SF_CLIENT_SECRET) {
    throw new Error("Salesforce env vars missing");
  }
  const res = await fetch(`${SF_DOMAIN.replace(/\/$/, "")}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: SF_CLIENT_ID,
      client_secret: SF_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Salesforce auth failed (${res.status})`);
  const j = await res.json();
  cached = { token: j.access_token, instanceUrl: j.instance_url, exp: Date.now() + 20 * 60 * 1000 };
  return cached;
}

async function sf(path, init = {}) {
  const { token, instanceUrl } = await sfAuth();
  const res = await fetch(`${instanceUrl}/services/data/${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Salesforce ${init.method || "GET"} failed (${res.status})`);
  return res.status === 204 ? null : res.json();
}

export async function query(soql) {
  const j = await sf(`/query?q=${encodeURIComponent(soql)}`);
  return j.records || [];
}

export function updateLoan(id, fields) {
  return sf(`/sobjects/${LOAN}/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export function createTask(fields) {
  return sf(`/sobjects/Task`, { method: "POST", body: JSON.stringify(fields) });
}
