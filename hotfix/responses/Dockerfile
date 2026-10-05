FROM directus/directus:12.4.1@sha256:9cc8ab88e6f1fc98d860416d89d53dd15838860c315a66c6d8ee68cb72f6b3a6

LABEL org.opencontainers.image.source="https://github.com/polvallverdu/directus"
LABEL org.opencontainers.image.description="Directus 12.4.1 custom OpenAI Responses hotfix"

USER root
COPY patch-directus.mjs /tmp/patch-directus.mjs
RUN node /tmp/patch-directus.mjs
USER node

ENV DIRECTUS_CUSTOM_OPENAI_API=responses
