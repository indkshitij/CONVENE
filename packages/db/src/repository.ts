import type { Database } from "./client";

type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer Tx,
  ...rest: never[]
) => unknown
  ? Tx
  : never;

/**
 * Base class for every repository. The transaction boundary lives here, in
 * the service/repository layer — never in a handler (PRD §16, CLAUDE.md
 * rule: "the transaction boundary is always in the service layer").
 */
export abstract class Repository {
  protected constructor(protected readonly db: Database) {}

  protected async withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
}
