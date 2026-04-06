# Event Model

Events are stored locally at `storage/runs/<runId>/events.jsonl`.

Each line is one JSON object with a `type`, `runId`, append-time UTC timestamp, and event-specific fields. The file is append-only for a given run.

Core lifecycle events in the current implementation include:

- `run_created`
- `intent_validated`
- `execution_started`
- `intent_received`
- `execution_finished`
- `state_transition`
- `artifact_written`
- `validator_executed`
- `promotion_evaluated`
- `approval_recorded`
- `artifact_apply_requested`
- `artifact_applied`
- `run_completed`
- `run_failed`
- `sandbox_capability_report`

Replay in `packages/agent-kernel/src/events/replay.ts` is event-based. It reconstructs current state, intent type, artifact references, approval history, apply status, failure reason, and completion metadata from the event stream instead of trusting the latest run-record snapshot.

Two boundaries matter:

- Raw JSON syntax corruption still surfaces as corruption when `EventLog.readAll()` parses the file.
- Parsed but partial records are ignored by replay and run reconciliation so one malformed event object does not take down status reconstruction.

This event log is a local durability mechanism. It is not a distributed queue, message bus, or tamper-proof audit ledger.
