# OBS safety model

The library exclusively owns resources whose names begin with `vignette::<projectId>::`. Each
project has a registry scene, managed scenes, and managed source inputs. The planner never schedules
an operation against an unmanaged UUID or name.

Manual edits to managed transforms are treated as drift and overwritten on the next convergence
pass. Duplicate same-source placements are ambiguous in V1; they raise a diagnostic and suppress
destructive work. Reconnects and scene collection changes invalidate cached UUIDs and numeric item
IDs, force a fresh observation, and replan from OBS truth.

OBS passwords are runtime secrets. The library accepts them as constructor data and never reads
environment variables, logs settings, or persists credentials. Do not embed credentials in browser
bundles for remote deployment. A production remote control plane should use a trusted local service.

The real-OBS probe requires `VIGNETTE_ALLOW_INTEGRATION=1` and an exact expected disposable
collection name. Project cleanup must match the full managed prefix; never switch or delete a user's
collection as part of a test.

The probe creates one plainly named unmanaged sentinel scene and verifies that convergence and
managed cleanup leave it intact. The harness removes only that sentinel explicitly in its own final
cleanup. Static parity captures are diagnostic artifacts under ignored `test-results/parity/` and
contain no credentials, host paths, or connection URLs.
