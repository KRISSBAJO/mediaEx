# Review a replacement cover

Upload the proposed image as a separate MediaEX asset. Keep the existing cover attached to the event while the organizer and reviewer work on the candidate.

1. Read `GET /api/v1/assets/{candidateId}/review` with a server-side workspace key. Save the candidate ID, returned `revisionId`, and latest event ID. A new revision has `latest: null`.
2. Submit to `POST /api/v1/assets/{candidateId}/review` with an upload or full-access key. Include the last observed event ID so a late request cannot overwrite another decision.

   ```json
   {
     "action": "submit",
     "revisionId": "<revision UUID from GET>",
     "expectedEvent": null,
     "comment": "Proposed cover for the Nashville event"
   }
   ```

3. A different workspace owner or administrator opens the candidate's **File review** panel and approves it or requests changes. Requested changes require a comment. The organizer can resubmit the same file after addressing feedback or submit a fresh upload. Each new file revision has its own review history. A server-side key can submit a candidate and read the decision. Decisions require a reviewer session.
4. Before publication, Omoshow checks its own organizer permissions and event approval. Approval in MediaEX records the decision on the file. It does not change the event.
5. For a cover asset dedicated to this event, publish through `POST /api/v1/assets/{coverAssetId}/revisions` with a full-access key and the body below. Obtain `expectedCurrent` from `GET /api/v1/assets/{coverAssetId}/revisions`. Use the exact candidate revision Omoshow authorized. The publication transaction rechecks the review and both versions. A conflict returns HTTP 409 and preserves the current cover.

   ```json
   {
     "expectedCurrent": "<current cover revision>",
     "replacementId": "<candidate asset ID>",
     "expectedReplacementRevision": "<approved candidate revision>",
     "requireApproved": true
   }
   ```

The existing version-switch operation consumes the candidate asset and retains its revision under the stable cover asset ID. Every consumer of that cover ID sees the switch. Use this operation only when intending to update all its consumers. For event-specific publication, use the application reference endpoint below.

Once a reviewed replacement has been published, later replacements on that stable asset require approval. Existing callers can continue their legacy replacement flow on assets that have never published a reviewed replacement. Owners and administrators retain the existing version-restore operation. Read the live revision and its review activity after a switch using the stable cover asset ID.

## Publish a version to an Omoshow event

Create a server-side publication key scoped to the Omoshow application. In Omoshow set MEDIAEX_PUBLICATION_KEY and keep the existing upload credential in MEDIAEX_API_KEY. Apply integrations/omoshow/phase2.patch to the API and integrations/omoshow/admin-dashboard.patch to the web project. Include the API patch's database migration before enabling the publication key.

Use GET /api/v1/references with application=omoshow, resource=event:<id> and slot=cover to read the current asset, revision and generation. PUT the approved assetId, revisionId, expectedGeneration and reason to that URL. DELETE with expectedGeneration and reason detaches the cover. Refresh on HTTP 409 before deciding whether to retry. The event's own approval controls publication. The API patch keeps historical version pins for rollback and retries synchronization of the current event reference after commit. Older event records may require resubmission to establish a reviewed revision.

Use examples/omoshow-publication.mjs for a runnable server-side client and scripts/test-omoshow-publication.mjs for its two-event example. GET /api/v1/assets/<id>/references returns registered uses. External embeds and applications that have never registered their uses are outside this inventory.

## Workspace administration

Configure enterprise sign-in with ENTERPRISE_OIDC_DISCOVERY, ENTERPRISE_OIDC_CLIENT_ID, ENTERPRISE_OIDC_CLIENT_SECRET and ENTERPRISE_OIDC_DOMAINS. This deployment supports a single configured enterprise issuer. The directory endpoint /api/v1/scim/Users supports user provisioning, listing, username equality filters and activation changes. Set MEDIAEX_DIRECTORY_KEYS to a JSON object mapping workspace IDs to SHA-256 hex digests of distinct high-entropy directory tokens. The identity provider sends the corresponding token as a bearer credential. Provisioned members start with read-only access. Directory removal affects the target workspace membership.

The workspace usage page reports stored media and derivatives, reservations, worker time, player delivery, bytes streamed by MediaEX and storage redirects. Redirect counts do not measure bytes delivered directly by the storage provider. Administrators can export audit history using /api/assets/audit?format=ndjson.

## Measure upload to delivery

Run the benchmark against a dedicated test workspace with MEDIAEX_URL and MEDIAEX_BENCHMARK_KEY set. Supply an image, a device label, a region label and a sample count. The labels describe the machine running the command.

    node examples/benchmark-upload.mjs photo.jpg desktop us-east 10

Record the emitted results alongside the release and the date. Verify phone timings on the device itself.
