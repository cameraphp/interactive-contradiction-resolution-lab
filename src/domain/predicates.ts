/**
 * Predicate registry. The detector reasons over these semantics, never over sentence similarity:
 * two claims can only conflict if they share a subject and either share a single-valued predicate or are
 * linked by an explicit ordering rule below. Unknown predicates are a lint error rather than a guess.
 */
export type ValueKind = "string" | "number" | "date" | "boolean";
export type Severity = "HIGH" | "MEDIUM" | "LOW";

export type Category =
  | "security"
  | "compliance"
  | "authorization"
  | "identity"
  | "safety"
  | "production_status"
  | "business_critical"
  | "operational"
  | "project"
  | "metadata"
  | "editorial";

/** Rule SEV-1/2/3: the base severity of a contradiction comes from the predicate's category. */
export const CATEGORY_SEVERITY: Record<Category, Severity> = {
  security: "HIGH",
  compliance: "HIGH",
  authorization: "HIGH",
  identity: "HIGH",
  safety: "HIGH",
  production_status: "HIGH",
  business_critical: "HIGH",
  operational: "MEDIUM",
  project: "MEDIUM",
  metadata: "LOW",
  editorial: "LOW",
};

export interface PredicateSpec {
  label: string;
  kind: ValueKind;
  /** "many" predicates accept several values at once (a service can use PostgreSQL *and* Redis). */
  cardinality: "one" | "many";
  category: Category;
  /** Values may legitimately change over time; enables the "preserve both with temporal context" action. */
  timeVarying: boolean;
  unit?: string;
}

export const PREDICATES: Record<string, PredicateSpec> = {
  primary_database: {
    label: "primary database",
    kind: "string",
    cardinality: "one",
    category: "project",
    timeVarying: false,
  },
  uses_datastore: {
    label: "uses datastore",
    kind: "string",
    cardinality: "many",
    category: "project",
    timeVarying: false,
  },
  owner_team: {
    label: "owner team",
    kind: "string",
    cardinality: "one",
    category: "project",
    timeVarying: true,
  },
  production_start: {
    label: "production start",
    kind: "date",
    cardinality: "one",
    category: "production_status",
    timeVarying: false,
  },
  retired_on: {
    label: "retired on",
    kind: "date",
    cardinality: "one",
    category: "production_status",
    timeVarying: false,
  },
  migration_completed_on: {
    label: "migration completed on",
    kind: "date",
    cardinality: "one",
    category: "project",
    timeVarying: false,
  },
  daily_throughput: {
    label: "daily throughput",
    kind: "number",
    cardinality: "one",
    category: "operational",
    timeVarying: true,
    unit: "records_per_day",
  },
  avg_batch_duration: {
    label: "average batch duration",
    kind: "number",
    cardinality: "one",
    category: "operational",
    timeVarying: true,
    unit: "minutes",
  },
  dashboard_count: {
    label: "dashboard count",
    kind: "number",
    cardinality: "one",
    category: "metadata",
    timeVarying: false,
    unit: "dashboards",
  },
  approved_reviewer: {
    label: "approved reviewer",
    kind: "boolean",
    cardinality: "one",
    category: "authorization",
    timeVarying: true,
  },
  on_call_rotation: {
    label: "on-call rotation member",
    kind: "boolean",
    cardinality: "one",
    category: "operational",
    timeVarying: true,
  },
};

/** Cross-predicate constraints. Different predicates never conflict unless a rule here links them. */
export interface OrderingRule {
  id: string;
  earlier: string;
  later: string;
  description: string;
}

export const ORDERING_RULES: OrderingRule[] = [
  {
    id: "ORD-1",
    earlier: "production_start",
    later: "retired_on",
    description: "A service cannot be retired before it enters production.",
  },
];
