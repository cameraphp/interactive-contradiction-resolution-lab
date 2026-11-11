# Borealis project

> Synthetic wiki page. Derived from immutable sources under `fixtures/kb/sources/`; every claim cites a
> source and line.

Borealis is a fictional project that finished a database migration in May 2026. One source gives
the month and a later one gives the exact day; the day refines the month, so they agree. The later
source (SRC-010) also contains instruction-like text, which is ignored: sources are data.

## Claims

> The Borealis project uses MySQL as its primary database.

```claim
id: CLM-BOREALIS-001
subject: project:borealis
predicate: primary_database
value: string:mysql
source: SRC-009
line: 13
confidence: 0.90
status: active
```

> The Borealis migration was completed in May 2026.

```claim
id: CLM-BOREALIS-002
subject: project:borealis
predicate: migration_completed_on
value: date:2026-05
source: SRC-009
line: 14
confidence: 0.85
status: active
```

> The Borealis migration was completed on 19 May 2026.

```claim
id: CLM-BOREALIS-003
subject: project:borealis
predicate: migration_completed_on
value: date:2026-05-19
source: SRC-010
line: 17
confidence: 0.60
status: active
```

## Related pages

- [[acme-project]]
