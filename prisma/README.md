# Prisma

## Layout

- `schema.prisma` — the data model
- `migrations/0_init/` — the initial migration, covering every table
- `seed.ts` — five datasets with contributors, licences and payouts

## A fresh database

```bash
npm run db:migrate        # prisma migrate dev
npm run db:seed
```

## An existing database — baselining

Four tables predate Prisma and are created by `src/db/schema.sql` when the
indexer starts: `quality_attestations`, `curators`, `dataset_quality` and
`indexer_cursors`.

They are declared in `schema.prisma` so that Prisma has a complete picture of
the database. Without them it would treat those tables as drift and generate a
migration that drops them.

The consequence is that `0_init` contains `CREATE TABLE` statements for tables
that already exist on a deployed database, so applying it there would fail.
Mark it as already applied instead:

```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy   # applies anything after 0_init as normal
```

Run this once per existing environment. A database created from scratch does
not need it — `migrate deploy` applies `0_init` normally.

## Two data layers, for now

`src/db/client.ts` still holds a `pg` pool, and the quality and commission
indexers read and write through it. That path is untouched here; Prisma covers
the dataset, contributor, licence, royalty and audit models added by this
change. Moving the older queries across is a separate piece of work — doing it
in the same change as introducing Prisma would make both harder to review.

While both exist, the rule is: **`schema.prisma` and `src/db/schema.sql` must
agree.** If you change one of the four shared tables, change it in both.
