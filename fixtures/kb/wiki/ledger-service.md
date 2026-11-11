# Ledger service

> Synthetic wiki page. Derived from immutable sources under `fixtures/kb/sources/`; every claim cites a
> source and line.

The Ledger service stores transactional data in one engine and caches reads in another. These two
claims share a predicate that allows several values, so they are compatible, not contradictory.

## Claims

> The Ledger service uses PostgreSQL for transactional data.

```claim
id: CLM-LEDGER-001
subject: service:ledger
predicate: uses_datastore
value: string:postgresql
source: SRC-001
line: 22
confidence: 0.90
status: active
```

> The Ledger service uses Redis for caching.

```claim
id: CLM-LEDGER-002
subject: service:ledger
predicate: uses_datastore
value: string:redis
source: SRC-001
line: 23
confidence: 0.90
status: active
```

## Related pages

- [[acme-project]]
