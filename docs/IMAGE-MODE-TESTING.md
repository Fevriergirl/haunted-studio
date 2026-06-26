# Image-mode testing status

This note records exactly how the `image` artifact provider was verified, so the
boundary between "proven" and "still needs a real key" is explicit.

## 1. Exercised live (real, un-stubbed)

Verified end to end against a **real local HTTP image endpoint** (a small server
returning a genuine PNG as `b64_json`), through both the studio server
(`POST /api/cycle`) and the CLI one-shot (`run --seed`), in IMAGE mode:

- a **local HTTP image endpoint** received exactly one request, carrying a
  `Bearer` Authorization header and the configured model;
- **real `fetch`** (`globalThis.fetch`, real sockets) — not a stub;
- **real PNG decode** — the returned base64 decoded to genuine PNG bytes
  (signature `\x89PNG\r\n\x1a\n` verified);
- **file write** — the bytes were written and copied to
  `artifacts/cycles/<cycleId>/artifact.png` with a `metadata.json` sidecar
  (`provider: image`, ledger event ids recorded);
- **served artifact path** — the file was served over HTTP as `image/png` with
  `X-Content-Type-Options: nosniff`;
- **CLI one-shot image mode** — `node src/cli.js run --seed "…"` produced the same
  real PNG;
- **no key leakage** — the API key did not appear in any server log.

## 2. NOT exercised live

- A **real OpenAI / DALL·E / cloud provider call**. No cloud key is configured,
  and one is not requested here. The provider-specific request/response shapes
  (e.g. gpt-image vs dall-e parameters, base64 vs url responses) are covered by
  stubbed unit tests but not against the live service.
- The **live URL-response download path**. It is intentionally unreachable from a
  local server: the SSRF protection correctly blocks `localhost`/private/loopback
  download hosts, so the url path can only be exercised against a real https,
  non-private host (i.e. an actual cloud provider). It is covered by stubbed unit
  tests.

## 3. Remaining for the user to test locally

To exercise a real provider end to end, set the image API environment variables
**in your own shell** (never commit them) and run the studio or the CLI seed path:

```bash
export HAUNTED_STUDIO_ARTIFACT=image
export HAUNTED_STUDIO_IMAGE_API_KEY=sk-...        # your key, in your environment
export HAUNTED_STUDIO_IMAGE_MODEL=gpt-image-1     # a model your key can reach
# optional: HAUNTED_STUDIO_IMAGE_BASE_URL, HAUNTED_STUDIO_IMAGE_SIZE

npm run studio                                    # then drive a cycle in the browser
# or:
node src/cli.js run --seed "a doorway that opens onto the same room"
```

The key is read only from the environment, never written to `metadata.json` or
logs, and redacted from error messages. Mock mode remains the default and needs
no key.
