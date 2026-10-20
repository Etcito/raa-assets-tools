# raa-assets-tools

Format, validator and CLI for Royal Fiesta/RAA primitive assets, plus the content-addressed asset store client. MIT licence.

## Purpose

`raa-assets-tools` defines and validates the `raa.prims` format, provides a canonical writer, and includes the asset-store client and command-line tools.

## The brick rule

This package works without RAA, Royal Fiesta, or SDF Modeler. It is a standalone TypeScript package for defining, checking, and storing primitive assets.

## Requirements

- Node.js >= 22.18.
- Zero runtime dependencies.
- Tools run directly from TypeScript sources with plain `node`; no build step is needed for local use.

## Quick start

```sh
node src/cli/main.ts validate fixtures/valid/*.raa.prims.json
node --test test/
node proof/m1.ts
```

The CLI arrives in M2; these commands describe the package interface as the milestones add their files.

## Documentation

- [Format reference](docs/format.md)
- [Asset store](docs/store.md) (written by a later milestone)
- [Private assets](docs/private-assets.md) (written by a later milestone)

## Secrets rule

`ASSET_STORE_SSH` and `ASSET_STORE_KEY` are read from the environment only. Their values never appear in files or logs.
