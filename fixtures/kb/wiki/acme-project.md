# Acme project

> Synthetic wiki page. Derived from immutable sources under `fixtures/kb/sources/`; every claim cites a
> source and line.

Acme is a fictional internal project run by the platform-enablement team. Its transactional
dependencies are described on [[ledger-service]]. The two sources below disagree about the primary
database engine; that disagreement is intentional.

## Claims

> The Acme project uses PostgreSQL as its primary database.

```claim
id: CLM-ACME-001
subject: project:acme
predicate: primary_database
value: string:postgresql
source: SRC-001
line: 17
confidence: 0.90
status: active
```

> The Acme project is owned by the platform-enablement team.

```claim
id: CLM-ACME-002
subject: project:acme
predicate: owner_team
value: string:platform-enablement
source: SRC-001
line: 18
confidence: 0.95
status: active
```

> The Acme project uses MySQL as its primary database.

```claim
id: CLM-ACME-003
subject: project:acme
predicate: primary_database
value: string:mysql
source: SRC-002
line: 14
confidence: 0.70
status: active
```

> The Acme project is owned by the platform-enablement team.

```claim
id: CLM-ACME-004
subject: project:acme
predicate: owner_team
value: string:platform-enablement
source: SRC-002
line: 17
confidence: 0.85
status: active
```

## Related pages

- [[ledger-service]]
- [[borealis-project]]
