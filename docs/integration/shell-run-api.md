
# Shell to Run API integration

V5 keeps the shell thin.

## Responsibilities

The shell can:

- inspect runtime status
- inspect run-api health
- submit a bounded intent
- inspect state, events, and artifacts
- record approval or rejection
- trigger apply and complete

The shell does not:

- call oMLX directly for bounded runs
- apply patches directly
- perform hidden promotion or completion steps
