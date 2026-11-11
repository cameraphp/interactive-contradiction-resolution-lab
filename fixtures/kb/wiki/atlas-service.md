# Atlas service

> Synthetic wiki page. Derived from immutable sources under `fixtures/kb/sources/`; every claim cites a
> source and line.

Atlas is a fictional observability service. A decommission notice and later release notes describe
incompatible lifecycles, and the two sources also give different dashboard counts.

## Claims

> The Atlas service was retired in March 2026.

```claim
id: CLM-ATLAS-001
subject: service:atlas
predicate: retired_on
value: date:2026-03
source: SRC-003
line: 13
confidence: 0.85
status: active
```

> The Atlas service has 41 dashboards.

```claim
id: CLM-ATLAS-002
subject: service:atlas
predicate: dashboard_count
value: number:41
unit: dashboards
source: SRC-003
line: 14
confidence: 0.80
status: active
```

> The Atlas service entered production in July 2026.

```claim
id: CLM-ATLAS-003
subject: service:atlas
predicate: production_start
value: date:2026-07
source: SRC-004
line: 13
confidence: 0.90
status: active
```

> The Atlas service has 42 dashboards.

```claim
id: CLM-ATLAS-004
subject: service:atlas
predicate: dashboard_count
value: number:42
unit: dashboards
source: SRC-004
line: 14
confidence: 0.80
status: active
```

> The Atlas service is owned by the observability-guild team.

```claim
id: CLM-ATLAS-005
subject: service:atlas
predicate: owner_team
value: string:observability-guild
source: SRC-004
line: 15
confidence: 0.90
status: active
```

## Related pages

- [[harbor-pipeline]]
