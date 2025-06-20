# GitHub Action Video Issue Analyzer

This GitHub Action runs all video assets in an issue body through a LLM model to analyze the content.
The default behavior is to summarize and extract task items but this can be customized through the `prompt` input.

## Inputs

- `github_token`: GitHub token with `models: read` permission at least. **(required)**
- `instructions`: Custom prompt to use for the LLM model. If not provided, a default prompt will be used.
- `github_issue`: The issue number to analyze. Typically this variable is inferred from the event context.
- `debug`: Enable debug logging.

## Usage

Add the following to your step in your workflow file.
It will launch a whisper service in a container that can be used by genaiscript.

```yaml
    runs-on: ubuntu-latest
    services:
      whisper:
        image: onerahmet/openai-whisper-asr-webservice:latest
        env:
          ASR_MODEL: base
          ASR_ENGINE: openai_whisper
        ports:
          - 9000:9000
        options: >-
          --health-cmd "curl -f http://localhost:9000/docs || exit 1"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
          --health-start-period 20s
    steps:
      - uses: actions/checkout@v4
      - uses: pelikhan/action-genai-video-issue-analyzer@v0
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Example

Save the following in `.github/workflows/genai-video-issue-analyzer.yml` file:

```yaml
name: genai video issue analyzer
on:
  issues:
    types: [opened, edited]
permissions:
    contents: read
    issues: write
    models: read
concurrency:
    group: ${{ github.workflow }}-${{ github.event.issue.number }}
    cancel-in-progress: true
jobs:
  genai-video-analyze:
    runs-on: ubuntu-latest
    services:
      whisper:
        image: onerahmet/openai-whisper-asr-webservice:latest
        env:
          ASR_MODEL: base
          ASR_ENGINE: openai_whisper
        ports:
          - 9000:9000
        options: >-
          --health-cmd "curl -f http://localhost:9000/docs || exit 1"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
          --health-start-period 20s
    steps:
      - uses: actions/checkout@v4
      - uses: pelikhan/action-genai-video-issue-analyzer@v0
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Development

This action was automatically generated by GenAIScript from the script metadata.
We recommend updating the script metadata instead of editing the action files directly.

- the action inputs are inferred from the script parameters
- the action outputs are inferred from the script output schema
- the action description is the script title
- the readme description is the script description
- the action branding is the script branding

To **regenerate** the action files (`action.yml`), run:

```bash
npm run configure
```

To lint script files, run:

```bash
npm run lint
```

To typecheck the scripts, run:
```bash
npm run typecheck
```

To build the Docker image locally, run:
```bash
npm run docker:build
```

To run the action locally in Docker (build it first), use:
```bash
npm run docker:start
```

To run the action using [act](https://nektosact.com/), first install the act CLI:

```bash
npm run act:install
```

Then, you can run the action with:

```bash
npm run act
```

## Upgrade

The GenAIScript version is pinned in the `package.json` file. To upgrade it, run:

```bash
npm run upgrade
```
