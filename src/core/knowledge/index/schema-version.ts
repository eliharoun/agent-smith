/** Single source of truth for the index schema version. Bumping this triggers
 *  the DROP-and-rebuild migration in KnowledgeStore.reconcileHeader on the next
 *  writable open. Bumped to 2 for the per-chunk embedder_id column. */
export const SCHEMA_VERSION = 2;
