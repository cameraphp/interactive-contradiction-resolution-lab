# Harbor pipeline

> Synthetic wiki page. Derived from immutable sources under `fixtures/kb/sources/`; every claim cites a
> source and line.

Harbor is a fictional batch ingestion pipeline. Its throughput and batch duration were reported in
two reviews seven months apart. Atlas dashboards ([[atlas-service]]) display its metrics.

## Claims

> The Harbor pipeline processes 10,000 records per day.

```claim
id: CLM-HARBOR-001
subject: pipeline:harbor
predicate: daily_throughput
value: number:10000
unit: records_per_day
source: SRC-005
line: 15
confidence: 0.90
status: active
```

> The average Harbor batch takes 47 minutes.

```claim
id: CLM-HARBOR-002
subject: pipeline:harbor
predicate: avg_batch_duration
value: number:47
unit: minutes
source: SRC-005
line: 16
confidence: 0.85
status: active
```

> The Harbor pipeline processes 25,000 records per day.

```claim
id: CLM-HARBOR-003
subject: pipeline:harbor
predicate: daily_throughput
value: number:25000
unit: records_per_day
source: SRC-006
line: 15
confidence: 0.90
status: active
```

> The average Harbor batch takes 48 minutes.

```claim
id: CLM-HARBOR-004
subject: pipeline:harbor
predicate: avg_batch_duration
value: number:48
unit: minutes
source: SRC-006
line: 16
confidence: 0.85
status: active
```

## Related pages

- [[atlas-service]]
