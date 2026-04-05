# GSD Patch Strategy

## Current stance

Use GSD as-is through `models.json` first. That gives you a working path without source divergence.

## Future deep patches worth doing

- inject gateway health into the model-status UI
- propagate explicit runtime capability metadata into model routing
- add shell-visible failure states when oMLX is down or overloaded
- add a first-class local-runtime provider extension only after the non-invasive path is proven
