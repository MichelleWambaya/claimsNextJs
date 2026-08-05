// Maps by header ALIAS, not exact column name — so files from different
// payers/exports with slightly different column names still parse
// correctly, and a genuinely missing required column is reported per
// file rather than silently skipped.

export const DEFAULT_ALIASES: Record<string, string[]> = {
  member_id: ["insurance_member_id", "member_id", "membership_number", "member_no"],
  policy_number: ["policy_number", "policy_no"],
  claim_code: ["claim_code", "claim_id"],
  claim_status: ["claim_status", "item_status", "status"],
  provider: ["provider_name", "provider"],
  provider_affiliation: ["provider_affiliation"],
  category: ["item_benefit", "benefit_type", "category", "plan"],
  diagnosis_type: ["diagnosis_type", "dx_type"],
  diagnosis_name: ["diagnosis_name", "diagnosis", "dx_name", "dx", "primary_diagnosis_name"],
  invoice_number: ["external_invoice_number", "invoice_number", "tax_invoice_number"],
  product_name: ["medical_product_name", "product_name", "item_name"],
  visit_date: ["date_item_added", "date_visit_started", "visit_date", "date_claim_created"],
  amount: ["item_requested_amount", "requested_amount", "amount_requested", "amount"],
  approved_amount: ["item_approved_amount", "approved_amount", "amount_approved"],
  denial_code: ["claim_denial_code", "denial_code"],
};

const REQUIRED_FIELDS = ["member_id", "product_name", "visit_date"];

function normalize(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function mapHeaders(headers: string[]): { mapping: Record<string, string>; missingRequired: string[] } {
  const normalizedToOriginal = new Map(headers.map((h) => [normalize(h), h]));
  const mapping: Record<string, string> = {};

  for (const [canonical, aliases] of Object.entries(DEFAULT_ALIASES)) {
    for (const alias of aliases) {
      const original = normalizedToOriginal.get(normalize(alias));
      if (original) {
        mapping[original] = canonical;
        break;
      }
    }
  }

  const mappedCanonicals = new Set(Object.values(mapping));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedCanonicals.has(f));

  return { mapping, missingRequired };
}

export function mapRow(row: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [originalHeader, value] of Object.entries(row)) {
    const canonical = mapping[originalHeader];
    if (canonical) out[canonical] = value;
  }
  return out;
}
