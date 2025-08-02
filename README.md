# GitHub Action Video Issue Analyzer

This GitHub Action runs all video assets in an issue body through a LLM model to analyze the content, or can analyze a direct video URL when triggered via workflow_dispatch, or can process local MP4 files and save analysis results to adjacent markdown files.
The default behavior is to summarize and extract task items but this can be customized through the `instructions` input.

The action outputs the analysis results to the GitHub Step Summary for easy viewing in the Actions tab.

## Inputs

|name|description|required|default|
|----|-----------|--------|-------|
| `instructions` | Custom prompting instructions for each video. | false | Analyze the video and provide a summary of its content. Extract list of followup subissues if any. The transcript is your primary source of text information, ignore text in images. |
| `debug` | Enable debug logging (https://microsoft.github.io/genaiscript/reference/scripts/logging/). | false |  |
| `model_alias` | A YAML-like list of model aliases and model id: `translation: github:openai/gpt-4o` | false |  |
| `openai_api_key` | OpenAI API key | false |  |
| `openai_api_base` | OpenAI API base URL | false |  |
| `azure_openai_api_endpoint` | Azure OpenAI endpoint. In the Azure Portal, open your Azure OpenAI resource, Keys and Endpoints, copy Endpoint. | false |  |
| `azure_openai_api_key` | Azure OpenAI API key. **You do NOT need this if you are using Microsoft Entra ID. | false |  |
| `azure_openai_subscription_id` | Azure OpenAI subscription ID to list available deployments (Microsoft Entra only). | false |  |
| `azure_openai_api_version` | Azure OpenAI API version. | false |  |
| `azure_openai_api_credentials` | Azure OpenAI API credentials type. Leave as 'default' unless you have a special Azure setup. | false |  |
| `azure_ai_inference_api_key` | Azure AI Inference key | false |  |
| `azure_ai_inference_api_endpoint` | Azure Serverless OpenAI endpoint | false |  |
| `azure_ai_inference_api_version` | Azure Serverless OpenAI API version | false |  |
| `azure_ai_inference_api_credentials` | Azure Serverless OpenAI API credentials type | false |  |
| `github_token` | GitHub token with `models: read` permission at least (https://microsoft.github.io/genaiscript/reference/github-actions/#github-models-permissions). | false |  |
| `video_url` | Direct video URL to analyze (alternative to extracting from issue body). Used when triggered via workflow_dispatch. | false |  |
| `local_files` | Local directory path to scan for *.mp4 files, or specific file path to a *.mp4 file. When provided, analysis results are saved to adjacent .md files instead of GitHub Step Summary. | false |  |

## Outputs

|name|description|
|----|-----------|

| `text` | The generated text output. |

**Note**: The action also outputs the analysis results to the GitHub Step Summary (`$GITHUB_STEP_SUMMARY`) for easy viewing in the Actions tab.

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

### For Issue-based Analysis (automatic trigger)

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
      - uses: actions/cache@v4
        with:
          path: .genaiscript/cache/**
          key: genaiscript-${{ github.run_id }}
          restore-keys: |
            genaiscript-
      - uses: pelikhan/action-genai-video-issue-analyzer@v0 # update to the major version you want to use
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### For Direct Video URL Analysis (manual trigger)

```yaml
name: genai video issue analyzer
on:
  workflow_dispatch:
    inputs:
      video_url:
        description: 'Direct video URL to analyze'
        required: true
        type: string
      instructions:
        description: 'Custom prompting instructions for the video'
        required: false
        default: 'Analyze the video and provide a summary of its content. Extract list of followup subissues if any. The transcript is your primary source of text information, ignore text in images.'
        type: string
permissions:
    contents: read
    models: read
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
      - uses: actions/cache@v4
        with:
          path: .genaiscript/cache/**
          key: genaiscript-${{ github.run_id }}
          restore-keys: |
            genaiscript-
      - uses: pelikhan/action-genai-video-issue-analyzer@v0 # update to the major version you want to use
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          video_url: ${{ github.event.inputs.video_url }}
          instructions: ${{ github.event.inputs.instructions }}
```

### Combined Workflow (both triggers)

```yaml
name: genai video issue analyzer
on:
  issues:
    types: [opened, edited]
  workflow_dispatch:
    inputs:
      video_url:
        description: 'Direct video URL to analyze'
        required: true
        type: string
      instructions:
        description: 'Custom prompting instructions for the video'
        required: false
        default: 'Analyze the video and provide a summary of its content. Extract list of followup subissues if any. The transcript is your primary source of text information, ignore text in images.'
        type: string
permissions:
    contents: read
    issues: write
    models: read
concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
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
      - uses: actions/cache@v4
        with:
          path: .genaiscript/cache/**
          key: genaiscript-${{ github.run_id }}
          restore-keys: |
            genaiscript-
      - uses: pelikhan/action-genai-video-issue-analyzer@v0 # update to the major version you want to use
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          video_url: ${{ github.event.inputs.video_url }}
          instructions: ${{ github.event.inputs.instructions }}
```

### Local Files Processing

For processing local MP4 files and saving analysis results to adjacent markdown files, you can use the `local_files` parameter:

```yaml
name: process local videos
on: 
  push:
    paths:
      - '**.mp4'
  workflow_dispatch:
    inputs:
      local_files:
        description: 'Directory path to scan for MP4 files or specific MP4 file path'
        required: true
        type: string
permissions:
    contents: write
    models: read
jobs:
  process-videos:
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
      - uses: actions/cache@v4
        with:
          path: .genaiscript/cache/**
          key: genaiscript-${{ github.run_id }}
          restore-keys: |
            genaiscript-
      - uses: pelikhan/action-genai-video-issue-analyzer@v0 # update to the major version you want to use
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          local_files: ${{ github.event.inputs.local_files || './videos' }}
          instructions: 'Analyze the video and provide a detailed summary with key points and action items.'
      - name: Commit generated markdown files
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add "*.md"
          git diff --staged --quiet || git commit -m "Add video analysis results"
          git push
```

**Local Files Behavior:**
- If you provide a directory path, it will scan for all `*.mp4` files in that directory
- If you provide a specific file path, it will process only that MP4 file
- Analysis results are saved to adjacent `.md` files (e.g., `video.mp4` → `video.md`)
- The action will skip non-MP4 files and provide appropriate error messages for inaccessible files

## Development

This action was automatically generated by [GenAIScript](https://microsoft.github.io/genaiscript/reference/github-actions) from the script metadata.
We recommend updating the script metadata instead of editing the action files directly.

- the action inputs are inferred from the script parameters
- the action outputs are inferred from the script output schema
- the action description is the script description
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

## Upgrade

The GenAIScript version is pinned in the `package.json` file. To upgrade it, run:

```bash
npm run upgrade
```

## Release

To release a new version of this action, run the release script on a clean working directory.

```bash
npm run release
```
