import { corsHeaders, json } from "../../_lib/kv.js";

const REJECT_REASONS = [
  { id: "location", label: "Location" },
  { id: "wrong_role", label: "Wrong role" },
  { id: "seniority", label: "Seniority" },
  { id: "missing_requirement", label: "Missing requirement" },
  { id: "company_industry", label: "Company / industry" },
  { id: "other", label: "Other" },
];

const REJECT_GROUPS = [{ id: "not_relevant", label: "Not relevant", reasons: REJECT_REASONS }];
const ACCEPT_REASONS = [];
const ACCEPT_GROUPS = [];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet() {
  return json({
    reject: REJECT_REASONS,
    accept: ACCEPT_REASONS,
    rejectGroups: REJECT_GROUPS,
    acceptGroups: ACCEPT_GROUPS,
    noteOptional: true,
    relevantNeedsReasons: false,
  });
}
