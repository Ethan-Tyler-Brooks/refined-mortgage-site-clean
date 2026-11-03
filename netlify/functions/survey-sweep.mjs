// Hourly sweep: finds loans that hit Clear to Close (Encompass-synced
// Clear_to_Close_Date__c) and texts the borrower a one-time survey link.
// Only sends 9am-7pm Central. Idempotent: a loan with a token is never re-sent.
// Env (besides Salesforce/RingCentral): SURVEY_START_DATE (YYYY-MM-DD, nothing
// with an earlier CTC date is ever texted), SURVEY_ENABLED ("true" to send).
import crypto from "node:crypto";
import { query, updateLoan, createTask, LOAN } from "../lib/salesforce.mjs";
import { sendSms, toE164 } from "../lib/ringcentral.mjs";

export const config = { schedule: "7 * * * *" };

const SITE = "https://www.ethanbrooks.mortgage";
const MAX_PER_RUN = 10;

function centralHour() {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }).format(new Date()));
}

function smsText(firstName, token) {
  const hi = firstName ? `Hi ${firstName}, ` : "Hi, ";
  return `${hi}it's Ethan Brooks and the Refined Mortgage Group team. You're clear to close! Would you take 60 seconds to tell us how we did? ${SITE}/feedback/?t=${token} Reply STOP to opt out.`;
}

export default async () => {
  if (process.env.SURVEY_ENABLED !== "true") return new Response("disabled");
  const h = centralHour();
  if (h < 9 || h >= 19) return new Response("outside sending hours");

  const start = process.env.SURVEY_START_DATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")) return new Response("SURVEY_START_DATE not set", { status: 500 });

  const loans = await query(
    `SELECT Id, OwnerId, Name, Borrower_Cell_LOS__c, Borrower_First_Name__c, MtgPlanner_CRM__Borrower_First_Name__c
     FROM ${LOAN}
     WHERE Clear_to_Close_Date__c >= ${start}
       AND Clear_to_Close_Date__c = LAST_N_DAYS:14
       AND Survey_Token__c = null
       AND Borrower_added_to_GatherUp__c = false
       AND Survey_Opt_Out_Reason__c = null
       AND MtgPlanner_CRM__Status__c NOT IN ('Cancelled','Suspended')
     ORDER BY Clear_to_Close_Date__c ASC LIMIT ${MAX_PER_RUN}`
  );

  let sent = 0, skipped = 0;
  for (const loan of loans) {
    const to = toE164(loan.Borrower_Cell_LOS__c);
    if (!to) {
      // Mark so we don't retry every hour, and tell the loan owner.
      await updateLoan(loan.Id, { Survey_Token__c: `NOCELL-${loan.Id}`, Survey_Review_Status__c: "Survey incomplete" });
      await createTask({
        WhatId: loan.Id, OwnerId: loan.OwnerId, Priority: "Normal", Status: "Not Started",
        Subject: "Survey not sent: no valid borrower cell",
        Description: "The clear-to-close survey text could not be sent because Borrower Cell (LOS) is blank or invalid. Fix the number in Encompass, then clear Survey Token on this loan to resend.",
        ActivityDate: new Date().toISOString().slice(0, 10),
      });
      skipped++;
      continue;
    }
    const token = crypto.randomBytes(24).toString("base64url");
    // Reserve first so a retry can never double-text.
    await updateLoan(loan.Id, { Survey_Token__c: token, Survey_Review_Status__c: "Survey incomplete" });
    try {
      const first = (loan.Borrower_First_Name__c || loan.MtgPlanner_CRM__Borrower_First_Name__c || "").trim().split(/\s+/)[0];
      await sendSms(to, smsText(first, token));
      sent++;
    } catch (e) {
      await updateLoan(loan.Id, { Survey_Token__c: null, Survey_Review_Status__c: null });
      await createTask({
        WhatId: loan.Id, OwnerId: loan.OwnerId, Priority: "Normal", Status: "Not Started",
        Subject: "Survey text failed to send",
        Description: "RingCentral rejected the clear-to-close survey text. It will retry next hour; if this keeps happening, check the RingCentral app and sending number.",
        ActivityDate: new Date().toISOString().slice(0, 10),
      });
      skipped++;
    }
  }
  return new Response(JSON.stringify({ found: loans.length, sent, skipped }));
};
