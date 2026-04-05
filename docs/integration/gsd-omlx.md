# GSD to oMLX Integration

## Minimal integration

1. Start oMLX on `127.0.0.1:8000`.
2. Start the runtime gateway on `127.0.0.1:8787`.
3. Write `~/.gsd/agent/models.json` from `configs/gsd/models.omlx.gateway.example.json`.
4. In GSD select one of the configured local models.

## Non-invasive strategy

Do not fork GSD just to add a direct import of oMLX internals. Use its existing custom-provider path through `models.json`. That keeps updates tractable.

## Where to patch next if you want deeper integration

- surface `/v1/capabilities` into GSD model-health UI
- make gateway model allowlists user-configurable from GSD settings
- add gateway-side model alias negotiation using oMLX `/v1/models`
- add explicit upstream health events into GSD auto loops
