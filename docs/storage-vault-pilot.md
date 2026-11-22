# Studio storage credential pilot

On an isolated MediaEX stack, enroll one test workspace in S3 storage using the existing `MEDIAEX_S3_WORKSPACE_IDS` setting. Keep the endpoint and bucket bound to the database. Set `MEDIAEX_VAULT_WORKSPACE` to that workspace ID. Set `MEDIAEX_VAULT_ADDR` to the HTTPS origin of OpenBao and mount its trusted CA as needed. The same settings belong on every API process and encoder. MediaEX reads the active credential for that studio on each signing operation. Existing studios use the existing storage configuration. Test the pilot on an isolated bucket first.

## Provision the pilot

Enable an OpenBao KV v2 mount named `mediaex` and require check-and-set writes. Enable an audit device with default value hashing before issuing pilot tokens. The runtime identity needs only `read` on `mediaex/data/workspaces/WORKSPACE_ID/storage`. Each operator needs a named identity with `read`, `create` and `update` on that exact path and permission to look up its own token. Give other workspaces distinct policies. Mount a renewable token sink from OpenBao Agent at `MEDIAEX_VAULT_TOKEN_FILE` for runtime use. Set `MEDIAEX_VAULT_OPERATOR_TOKEN_FILE` only in the operator environment.

Create the candidate at the storage provider with read, write, delete and multipart access limited to objects under `WORKSPACE_ID/*` in the bound private bucket. Limit bucket listing to that prefix. Deny public reads. Keep platform infrastructure, backups and authentication credentials separate. The media proof uses a random fixture prefix inside the workspace and cleans up its objects. A failed cleanup reports the fixture prefix for inspection.

## Rotate

From the backend directory run `node --experimental-strip-types rotate-storage.mts status`. Pipe the candidate JSON from a protected secret source to `node --experimental-strip-types rotate-storage.mts rotate EXPECTED_VERSION`. Use version 0 for the initial key. The JSON accepts `accessKeyId`, `secretAccessKey` and optional `sessionToken`. Use two simultaneously valid provider credentials during a planned rotation.

The command uploads a generated video, reads it back through the worker storage adapter, encodes it to HLS, publishes the output, fetches the signed playback segment and decodes it. A compare-and-set write promotes only the verified candidate. Concurrent changes require a fresh status check. A failed probe keeps the prior version active. After a timeout, read the active version before retrying. Owners and admins see the latest proof in **Usage and errors**. OpenBao records operations under the operator identity in its audit log.

Keep the preceding provider key active for at least 24 hours and five minutes after the last writer switches. Check all writers, open uploads and jobs before retiring it at the provider. Temporary credentials can expire sooner than a signed link. For rollback, prove the still-valid previous provider credential and activate it as a new version. Use emergency revocation immediately for a compromised key and reissue affected media links.

## Admin screen

Site admins can open **Admin → Workspaces → the pilot studio → Storage credential**. Enter the replacement provider key, choose **Verify replacement**, and then **Activate credential**. Verification writes and deletes test media. Activation repeats the proof, checks the displayed version, and records the signed-in admin and verification time with the credential. The workspace audit log records the actions and versions. A timeout during activation can leave the client uncertain. Refresh the workspace to read the active version before retrying.

Run the storage operator as a separate process from the same backend image using `MEDIAEX_PROCESS_ROLE=storage-operator` and `node --experimental-strip-types server.mts` in the backend directory. Use the existing MediaEX auth database, auth secret and frontend origin so the operator can validate the actual site-admin session. Give it a dedicated `MEDIAEX_API_TOKEN`, the bound pilot settings, and the scoped operator token file. Serve the process through a trusted HTTPS origin to the frontend. It accepts the pilot credential route and health probes. The ordinary API and encoders use their read identity. Mount the operator token only in the operator process.

Set `MEDIAEX_STORAGE_OPERATOR_WORKSPACE` on the frontend to the pilot studio ID. Set `MEDIAEX_STORAGE_OPERATOR_URL` and `MEDIAEX_STORAGE_OPERATOR_SERVICE_TOKEN` to the operator origin and its dedicated transport token. The normal API token must be different. A site admin can now read the initial status and activate the first credential through the operator while existing API and encoder processes continue using their current storage settings. Confirm the active version before enrolling those processes in vault signing. Keep request-body capture disabled for this route throughout your proxy and monitoring systems. A vault outage blocks new signing operations for an enrolled studio.

## Exercise recovery

For a local check without Docker, run `node --experimental-strip-types scripts/test-storage-vault-offline.mts` after installing backend dependencies. FFmpeg runs normally. The test supplies in-memory OpenBao and S3 responses and checks both directions of workspace isolation, failed rotation, an outage and preservation of an old playback URL.

On a disposable Linux host with Docker, Git, Go 1.24 or newer, FFmpeg, Node 22 and Python 3, install backend dependencies with `npm ci --prefix backend` and run `python3 scripts/test-storage-vault.py`. The exercise builds its MinIO server and client from pinned upstream commits and creates a private MinIO bucket, two restricted keys and a Raft-backed OpenBao instance. It tests the storage adapter and access policies, checks the audit file for exposed values, stops the source vault, and restores its snapshot into a fresh vault with the source unseal shares held outside the snapshot. All identities, shares, fixtures and container names are generated for that run.

In production, keep encrypted snapshots and independently held unseal material off the vault hosts. A snapshot restores the vault's record of a provider key. Restoring a revoked or expired key at the provider requires a separate credential rotation.
