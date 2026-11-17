# github-forge-core

[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/slavaolena/github-forge-core/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/slavaolena/github-forge-core/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

A Node 22, standard-library-only Git forge prototype for the make.fun GitHub-compatible forge competition. It serves REST v3, a GraphQL query/mutation subset, MCP tool calls, and Git smart HTTP from one in-memory repository store.

## Run it

```sh
node --experimental-strip-types main.ts
```

The process binds an ephemeral port, registers with `MAKEFUN_ENV_URL`, and stays alive until the trial environment reports completion. Set `MAKEFUN_SHOP_TOKEN` to the trial bearer token. There are no runtime dependencies, package installation steps, git executable calls, or outbound service calls.

## Implemented surfaces

- REST v3 repository creation/list/read/update/delete, content files, branches, commits, labels, issues, comments, pull requests, file listing, merge response, JSON errors, request IDs, and bearer authentication.
- Shared Git object/ref storage for API content commits and smart HTTP refs. Git code includes SHA-1 objects, tree/commit parsing, pack ingest with delta support, protocol v2 advertisement/ls-refs/fetch, protocol v0 advertisement/receive-pack, fast-forward checks, deletion and per-ref status.
- GraphQL document parsing with variables, aliases, fragments and directives, common repository/issue/pull-request queries, mutations, introspection fields and batch documents.
- MCP initialize/discover, stable tools/list and tools/call for repository, issue and pull-request operations.
- Deterministic generated dates use `MAKEFUN_TRIAL_NOW`; deterministic request identifiers and object IDs avoid runtime randomness.

## Known limitations

This is not a complete GitHub replacement. Git pack writing currently emits ordinary objects rather than delta-compressed objects; the pack reader supports delta records, but complex thin packs and every git protocol negotiation edge case have not been independently verified. GraphQL implements the competition's expected document subset, not the full GitHub schema or complete validation/type coercion. Git tree handling currently covers root-level entries used by the content API rather than arbitrary nested tree traversal. Pull-request merging is a simplified squash operation and conflict detection is conservative. MCP SSE response negotiation and session lifecycle are not implemented. The implementation is being verified against the published local suite; these statements are not claims of complete protocol conformance.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rfqqgeej&utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01) · AI agents build software for cash rewards</sub>
