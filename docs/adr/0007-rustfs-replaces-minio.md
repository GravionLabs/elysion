# ADR 0007: RustFS replaces MinIO as the S3-compatible dev store

- Status: accepted
- Date: 2026-10-04
- Issues: #154, #155
- Pull requests: #156
- Builds on: [ADR 0006](0006-shared-local-infrastructure.md)

## Context

Elysion needs an S3-compatible object store for exports and uploads. Its compose file used
`minio/minio:latest`. On 2026-10-04 `pnpm dev:infra` failed with `pull access denied for minio/minio`:
the community images are gone from Docker Hub, and `quay.io/minio/minio` answers 401 as well. No
application code used MinIO yet; it appeared only in the compose file and the docs.

## Decision

Use **RustFS** (`rustfs/rustfs`, Apache-2.0), pinned to `1.0.1`. It serves the S3 API on 9000 and a web
console on 9001 inside the container, takes `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`, and keeps its
data in a named volume. Host ports follow [ADR 0006](0006-shared-local-infrastructure.md). The
credentials stay the dev values `elysion` / `elysion123`.

Checked before adopting it: the container starts, `/health` answers, and a signed `ListBuckets`
request with the dev credentials returns 200.

Alternatives with a pullable image were Garage (`dxflrs/garage`) and SeaweedFS
(`chrislusf/seaweedfs`); they were not tried.

## Consequences

- RustFS is a young project, so the version is pinned. Only `ListBuckets` was exercised; presigned URLs,
  multipart uploads and bucket policies need checking when the business backend first uses them.
- If the business backend needs behavior RustFS lacks, this ADR is the place to revisit Garage or
  SeaweedFS. The application should talk plain S3 and keep the endpoint and credentials in
  configuration so the store stays replaceable.
- Production object storage is a separate decision; this one only covers local development.

## Update (#702): the first use

The business backend now keeps the files of boards (images) in RustFS, through `AWSSDK.S3` with path-style addressing and `S3_*` settings, so the store is still replaceable. RustFS moved from `docker-compose.dev.yml` into `docker-compose.yml` (every stack needs it); the dev file only publishes its host ports. What was checked on 1.0.1: creating a bucket, put, get, listing with a prefix, server-side copy and deleting many objects (`S3FileStoreTests`). The AWS SDK's default checksums and its signed-stream upload are switched off (`WHEN_REQUIRED`, no chunk encoding), because S3 clones do not all take them. **Not used:** presigned URLs and multipart upload. Files are streamed through the backend (checked for type and size, authorized per request) and are at most 10 MiB, so a browser never talks to the store.
