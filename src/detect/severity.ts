import { CATEGORY_SEVERITY, PREDICATES, type Severity } from "../domain/predicates.js";
import { SEVERITY_ORDER, type ContradictionType } from "../domain/schemas.js";

/** The rules are data so the CLI, docs and tests can print exactly what the classifier applies. */
export const SEVERITY_RULES = [
  {
    id: "SEV-1",
    text: "Predicate category security, compliance, authorization, identity, safety, production_status or business_critical => HIGH",
  },
  { id: "SEV-2", text: "Predicate category operational or project => MEDIUM" },
  { id: "SEV-3", text: "Predicate category metadata or editorial => LOW" },
  {
    id: "SEV-4",
    text: "A MEDIUM numeric conflict whose relative difference is <= 5% is downgraded to LOW (low-impact numeric difference). HIGH is never downgraded.",
  },
  {
    id: "SEV-5",
    text: "A cross-predicate conflict takes the highest severity of the predicates involved.",
  },
] as const;

export const LOW_IMPACT_NUMERIC_THRESHOLD = 0.05;

export interface SeverityDecision {
  severity: Severity;
  ruleIds: string[];
}

function baseRule(severity: Severity): string {
  return severity === "HIGH" ? "SEV-1" : severity === "MEDIUM" ? "SEV-2" : "SEV-3";
}

export function classifySeverity(input: {
  predicates: string[];
  type: ContradictionType;
  relativeDifference?: number;
}): SeverityDecision {
  const severities = input.predicates.map((p) => {
    const spec = PREDICATES[p];
    if (!spec) throw new Error(`unknown predicate ${p}`);
    return CATEGORY_SEVERITY[spec.category];
  });
  let severity = severities.reduce((a, b) => (SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b));
  const ruleIds = [baseRule(severity)];
  if (new Set(input.predicates).size > 1) ruleIds.push("SEV-5");
  if (
    input.type === "numeric" &&
    severity === "MEDIUM" &&
    input.relativeDifference !== undefined &&
    input.relativeDifference <= LOW_IMPACT_NUMERIC_THRESHOLD
  ) {
    severity = "LOW";
    ruleIds.push("SEV-4");
  }
  return { severity, ruleIds };
}
