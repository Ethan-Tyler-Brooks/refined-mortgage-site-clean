// /api/survey
//   GET  ?t=TOKEN               -> { ok, firstName, completed }
//   POST { t, score, comment }  -> writes score/comment to the Loan in Jungo
// Low scores (0-8) create a High-priority Task for the loan owner and,
// if ALERT_SMS_TO is set, text an alert (no client details in the text).
import { query, updateLoan, createTask, LOAN } from "../lib/salesforce.mjs";
import { sendSms } from "../lib/ringcentral.mjs";

export const config = { path: "/api/survey" };

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function findLoan(t) {
  if (!TOKEN_RE.test(t || "")) return null;
  const rows = await query(
    `SELECT Id, OwnerId, Survey_Score__c, Borrower_First_Name__c, MtgPlanner_CRM__Borrower_First_Name__c
     FROM ${LOAN} WHERE Survey_Token__c = '${t}' LIMIT 1`
  );
  return rows[0] || null;
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      const loan = await findLoan(new URL(req.url).searchParams.get("t"));
      if (!loan) return json({ ok: false }, 404);
      const first = (loan.Borrower_First_Name__c || loan.MtgPlanner_CRM__Borrower_First_Name__c || "").trim().split(/\s+/)[0];
      return json({ ok: true, firstName: first || null, completed: loan.Survey_Score__c != null });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.website) return json({ ok: true }); // honeypot
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 0 || score > 10) return json({ ok: false, error: "score" }, 400);
      const comment = String(body.comment || "").slice(0, 5000);

      const loan = await findLoan(body.t);
      if (!loan) return json({ ok: false }, 404);
      if (loan.Survey_Score__c != null) return json({ ok: false, error: "completed" }, 409);

      await updateLoan(loan.Id, {
        Survey_Score__c: score,
        Survey_Comment__c: comment,
        Survey_Review_Status__c: "Survey complete; review not yet added",
      });

      if (score <= 8) {
        await createTask({
          WhatId: loan.Id, OwnerId: loan.OwnerId, Priority: "High", Status: "Not Started",
          Subject: `Survey alert: ${score}/10, follow up`,
          Description: comment || "(no comment left)",
          ActivityDate: new Date().toISOString().slice(0, 10),
        });
        if (process.env.ALERT_SMS_TO) {
          await sendSms(process.env.ALERT_SMS_TO, `Client survey alert: a client scored us ${score}/10. Check your Jungo tasks to follow up.`).catch(() => {});
        }
      }
      return json({ ok: true });
    }
    return json({ ok: false }, 405);
  } catch {
    return json({ ok: false, error: "server" }, 500);
  }
};
