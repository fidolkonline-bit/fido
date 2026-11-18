-- GRN lots are now supplier code + date (MTCP-181126); the per-supplier counter is no longer used.
ALTER TABLE "Contact" DROP COLUMN "lotSeq";
