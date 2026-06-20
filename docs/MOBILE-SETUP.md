# Run from a mobile browser with Codespaces

GitHub Codespaces provides a Linux development environment in the browser. Open
`Fevriergirl/haunted-studio`, select **Code**, then **Codespaces**, and create a
Codespace on the branch you intend to use.

The devcontainer uses Node.js 22 and runs `npm ci` followed by
`npm run validate` when it is created.

## Offline use

```bash
npm run demo
npm run cycle
npm run verify
```

## Optional live provider

Store `OPENAI_API_KEY` as a Codespaces secret rather than in a file. Then set
the provider and model variables in the terminal before running a cycle. API
usage is billed separately from ChatGPT subscriptions.

## Runtime data

`.haunted-studio/` and `experiments/` may contain private observations, reviews,
local paths, and generated images. They are ignored by Git. Export them only to
approved storage and review derived reports before publication.
