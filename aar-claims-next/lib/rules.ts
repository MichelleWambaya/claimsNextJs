// Forensic rule engine — ported from the original Python rules/ package.
// Business logic kept identical: only the language changed.

export type ClaimRow = {
  id: string;
  member_id: string | null;
  claim_status: string | null;
  provider: string | null;
  category: string | null;
  diagnosis_type: string | null;
  diagnosis_name: string | null;
  product_name: string | null;
  visit_date: string | null; // ISO date string
  amount: number | null;
  approved_amount: number | null;
  denial_code: string | null;
};

export type Flag = {
  claim_row_id: string;
  flag_type:
    | "item_duplicate"
    | "non_payable"
    | "pricing_anomaly"
    | "invalid_member_policy"
    | "diagnosis_gap";
  group_id?: string;
  reason: string;
  detail: Record<string, unknown>;
};

export const DEFAULT_NON_PAYABLE_KEYWORDS = [
  "cosmetic",
  "plastic surgery",
  "liposuction",
  "beauty treatment",
  "spa",
  "supplement",
  "multivitamin",
  "herbal",
  "traditional medicine",
  "contact lens",
  "laser eye",
  "hormone replacement",
  "hrt",
  "orthodont",
  "braces",
  "pandemic",
  "epidemic",
];

export type RuleConfig = {
  duplicateDayWindow: number; // default 5
  duplicateSimilarityThreshold: number; // default 0.72
  pricingIqrMultiplier: number; // default 1.5
  nonPayableKeywords: string[];
  memberIdPattern: string; // regex source, default AAR-style ^[A-Za-z]{2}\d{7,9}$
};

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  duplicateDayWindow: 5,
  duplicateSimilarityThreshold: 0.72,
  pricingIqrMultiplier: 1.5,
  nonPayableKeywords: DEFAULT_NON_PAYABLE_KEYWORDS,
  memberIdPattern: "^[A-Za-z]{2}\\d{7,9}$",
};

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86400000;
}

// Hybrid similarity = max(Levenshtein ratio, Jaccard token overlap) — same
// definition as the Python rules/similarity.py.
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

function jaccardTokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersection = new Set([...ta].filter((t) => tb.has(t)));
  const union = new Set([...ta, ...tb]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function hybridSimilarity(a: string, b: string): number {
  return Math.max(levenshteinRatio(a.toLowerCase(), b.toLowerCase()), jaccardTokenSimilarity(a, b));
}

// --- Duplicate detection: member repeats + similar product name within N
// days of the FIRST visit date in the cluster, Approved status only. ---
export function detectDuplicates(rows: ClaimRow[], config: RuleConfig): Flag[] {
  const approved = rows.filter((r) => (r.claim_status || "").toUpperCase() === "APPROVED");
  const byMember = new Map<string, ClaimRow[]>();
  for (const r of approved) {
    if (!r.member_id) continue;
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }

  const flags: Flag[] = [];
  for (const [memberId, memberRows] of byMember) {
    const sorted = [...memberRows].sort(
      (a, b) => new Date(a.visit_date ?? 0).getTime() - new Date(b.visit_date ?? 0).getTime()
    );
    const clustered = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      if (clustered.has(sorted[i].id)) continue;
      const anchor = sorted[i];
      const cluster: ClaimRow[] = [anchor];
      for (let j = i + 1; j < sorted.length; j++) {
        const candidate = sorted[j];
        if (clustered.has(candidate.id)) continue;
        if (daysBetween(anchor.visit_date ?? "", candidate.visit_date ?? "") > config.duplicateDayWindow) break;
        const sim = hybridSimilarity(anchor.product_name || "", candidate.product_name || "");
        if (sim >= config.duplicateSimilarityThreshold) {
          cluster.push(candidate);
          clustered.add(candidate.id);
        }
      }
      if (cluster.length > 1) {
        // Real cluster found via similarity + date window — flag every
        // member of it, anchor included.
        const groupId = `dup-${memberId}-${anchor.id}`;
        for (const c of cluster) {
          flags.push({
            claim_row_id: c.id,
            flag_type: "item_duplicate",
            group_id: groupId,
            reason: `Same member (${memberId}) + similar product within ${config.duplicateDayWindow} days of ${anchor.visit_date}`,
            detail: { member_id: memberId, days_from_first_visit: daysBetween(anchor.visit_date ?? "", c.visit_date ?? "") },
          });
        }
        clustered.add(anchor.id);
      } else if (anchor.denial_code?.toUpperCase().startsWith("CP-I-DUP")) {
        // No cluster match found by our own similarity check, but the
        // source system already flagged this row as a duplicate — honor
        // that rather than silently dropping it.
        flags.push({
          claim_row_id: anchor.id,
          flag_type: "item_duplicate",
          reason: `System-flagged duplicate: ${anchor.denial_code}`,
          detail: { member_id: memberId },
        });
        clustered.add(anchor.id);
      }
    }
  }
  return flags;
}

// --- Non-payable category matching, product + diagnosis name, Approved only ---
export function detectNonPayable(rows: ClaimRow[], config: RuleConfig): Flag[] {
  const flags: Flag[] = [];
  for (const r of rows) {
    if ((r.claim_status || "").toUpperCase() !== "APPROVED") continue;
    const text = `${r.product_name || ""} ${r.diagnosis_name || ""}`.toLowerCase();
    const hit = config.nonPayableKeywords.find((k) => text.includes(k));
    if (hit) {
      flags.push({
        claim_row_id: r.id,
        flag_type: "non_payable",
        reason: `Matched non-payable keyword: "${hit}"`,
        detail: { matched_keyword: hit },
      });
    }
  }
  return flags;
}

// --- Pricing anomalies: IQR outlier per category, Q3 + multiplier*IQR ---
export function detectPricingAnomalies(rows: ClaimRow[], config: RuleConfig): Flag[] {
  const approved = rows.filter((r) => (r.claim_status || "").toUpperCase() === "APPROVED");
  const byCategory = new Map<string, number[]>();
  for (const r of approved) {
    const cat = r.category || "Uncategorized";
    const amt = Number(r.approved_amount ?? r.amount ?? 0);
    const list = byCategory.get(cat) ?? [];
    list.push(amt);
    byCategory.set(cat, list);
  }
  const thresholds = new Map<string, number>();
  for (const [cat, vals] of byCategory) {
    if (vals.length < 4) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    thresholds.set(cat, q3 + config.pricingIqrMultiplier * iqr);
  }

  const flags: Flag[] = [];
  for (const r of approved) {
    const cat = r.category || "Uncategorized";
    const threshold = thresholds.get(cat);
    if (threshold === undefined) continue;
    const amt = Number(r.approved_amount ?? r.amount ?? 0);
    if (amt > threshold) {
      flags.push({
        claim_row_id: r.id,
        flag_type: "pricing_anomaly",
        reason: `Above IQR threshold (${Math.round(threshold).toLocaleString()}) for ${cat}`,
        detail: { category: cat, threshold, amount: amt },
      });
    }
  }
  return flags;
}

// --- Invalid member/policy number format ---
export function detectInvalidMemberPolicy(rows: ClaimRow[], config: RuleConfig): Flag[] {
  const re = new RegExp(config.memberIdPattern);
  const flags: Flag[] = [];
  for (const r of rows) {
    if (!r.member_id || !re.test(r.member_id)) {
      flags.push({
        claim_row_id: r.id,
        flag_type: "invalid_member_policy",
        reason: `Member ID doesn't match expected format: ${r.member_id || "(missing)"}`,
        detail: { member_id: r.member_id },
      });
    }
  }
  return flags;
}

// --- Diagnosis gaps: missing diagnosis name or type ---
export function detectDiagnosisGaps(rows: ClaimRow[]): Flag[] {
  const flags: Flag[] = [];
  for (const r of rows) {
    if (!r.diagnosis_name || !r.diagnosis_type) {
      flags.push({
        claim_row_id: r.id,
        flag_type: "diagnosis_gap",
        reason: "Missing diagnosis name or type",
        detail: {},
      });
    }
  }
  return flags;
}

export function runAllRules(rows: ClaimRow[], config: RuleConfig = DEFAULT_RULE_CONFIG): Flag[] {
  return [
    ...detectDuplicates(rows, config),
    ...detectNonPayable(rows, config),
    ...detectPricingAnomalies(rows, config),
    ...detectInvalidMemberPolicy(rows, config),
    ...detectDiagnosisGaps(rows),
  ];
}
