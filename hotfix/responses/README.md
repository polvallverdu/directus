# Directus 12.4.1 Responses hotfix

Image: `ghcr.io/polvallverdu/directus:12.4.1-responses-hotfix`.

This derived image patches the custom OpenAI provider to use Responses and preserves the existing settings UI and
license requirements. All custom OpenAI models use Responses. Built-in providers retain their current transport.

The base image is pinned to the Directus 12.4.1 manifest digest. The patch guards the API version and source layout.
Publication runs mocked transport verification against the SDK installed in the image, including auth, tools, encrypted
reasoning replay and streaming. It does not use production credentials.

The upstream per-model selector is proposed separately in https://github.com/directus/directus/pull/28329.

## Cloud Run

Publish with the `Publish Responses hotfix` workflow on branch `hotfix/cloudrun-responses`. GHCR package visibility must
be Public for direct Cloud Run pulls; public repository visibility does not automatically make a new container package
public.

Create a revision without production traffic, using the published image digest:

```sh
gcloud run services update directuscloud \
  --project=nexihealth --region=europe-southwest1 \
  --image=ghcr.io/polvallverdu/directus@sha256:IMAGE_DIGEST \
  --no-traffic
```

This updates only the image and preserves the existing port 8080, database, secrets, VPC, ingress and service settings.
Confirm startup before moving traffic. The service has restricted ingress and its default URL disabled, so a revision
tag URL alone does not provide an external test endpoint.

After verifying the revision, route traffic to its exact revision name:

```sh
gcloud run services update-traffic directuscloud \
  --project=nexihealth --region=europe-southwest1 \
  --to-revisions=NEW_REVISION=100
```

Rollback to the currently serving revision:

```sh
gcloud run services update-traffic directuscloud \
  --project=nexihealth --region=europe-southwest1 \
  --to-revisions=directuscloud-00012-jt7=100
```

Keep the Azure v1 base URL, deployment name, and reasoning flag configured in Directus. Provider Options uses SDK
camelCase, such as `{"reasoningEffort":"medium"}`. The patch sets `store: false` and carries encrypted reasoning for
models marked as reasoning.

Set `DIRECTUS_CUSTOM_OPENAI_API=chat-completions` to restore the original adapter inside this hotfix image, or roll back
to the previous image/revision. This environment toggle is specific to the hotfix, not stock Directus.
