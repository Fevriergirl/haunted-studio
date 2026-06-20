# Security policy

## Supported status

Haunted Studio is a local research prototype, not a production service. The
latest `main` branch is the only supported version during the 0.x series.

## Boundaries

- The observation mailbox binds to `127.0.0.1` by default and has no
  authentication. Do not expose it publicly without authentication,
  authorization, TLS, rate limiting, and a production queue.
- Model responses, observations, reviews, paths, and image inputs are untrusted
  data. The project does not execute model-supplied code.
- Store API keys in environment variables or an approved secret manager. Never
  commit `.env`, credentials, tokens, private observations, raw reviews, or
  confidential images.
- CLI output may include observation text and local paths. Review logs before
  sharing them.
- Human reviews require explicit consent. Use pseudonymous reviewer IDs unless
  identification is necessary and approved.
- Generated images are not published automatically. Confirm rights and consent
  for observations, references, training material, and output before use.
- Runtime directories may contain sensitive material. They are ignored by Git,
  but filesystem access controls and backups remain the operator's
  responsibility.

See [docs/DATA-AND-PROVENANCE.md](docs/DATA-AND-PROVENANCE.md) for publication
and licensing guidance.

## Reporting

Report vulnerabilities through a private GitHub security advisory for
`Fevriergirl/haunted-studio`. Do not include live credentials in an issue.
