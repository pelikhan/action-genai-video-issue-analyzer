script({
    parameters: {
        prompt: {
            type: "string",
            description: "Custom prompting instructions for each video.",
            default: "Analyze the video and provide a summary of its content. Extract list of followup subissues if any."
        }
    }
})

const { dbg, output, vars } = env
const issue = await github.getIssue()
if (!issue) throw new Error("No issue found in the context. This action requires an issue to be present.")
const { prompt } = vars
if (!prompt) throw new Error("No prompt provided. Please provide a prompt to process the video.")

const RX =
    /^https:\/\/github.com\/user-attachments\/assets\/.+$/gim;
const assetLinks = Array.from(new Set(Array.from(issue.body.matchAll(RX), m => m[0])))
if (assetLinks.length === 0) cancel("No video assets found in the issue body, nothing to do.")

dbg(`issue: %s`, issue.title)

for (const assetLink of assetLinks) {
    await processAssetLink(assetLink)
}

async function processAssetLink(assetLink: string) {
    output.heading(3, assetLink)
    dbg(assetLink)
    const downloadUrl = await github.resolveAssetUrl(assetLink)
    const res = await fetch(downloadUrl, { method: "GET" })
    const contentType = res.headers.get("content-type") || ""
    dbg(`download url: %s`, downloadUrl)
    dbg(`headers: %O`, res.headers)
    if (!res.ok)
        throw new Error(`Failed to download asset from ${downloadUrl}: ${res.status} ${res.statusText}`)
    if (!/^video\//.test(contentType)) {
        output.p(`Asset is not a video file, skipping`)
        return;
    }

    // save and cache
    const buffer = await res.arrayBuffer()
    dbg(`size`, `${(buffer.byteLength / 1e6) | 0}Mb`)
    const filename = await workspace.writeCached(buffer, { scope: "run" })
    dbg(`filename`, filename)

    await processVideo(filename)
}

async function processVideo(filename: string) {
    const transcript = await transcribe(filename, { model: "whisperasr:default", cache: true })
    const frames = await ffmpeg.extractFrames(filename, {
        transcript
    })
    const { text, error } = await runPrompt(ctx => {
        def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }) // ignore silent videos
        defImages(frames, { detail: "low", sliceSample: 40 }) // low detail for better performance
        $`${prompt}        
## Output format        
- Use GitHub Flavored Markdown (GFM) for formatting.
- If you need to list tasks, use the format \`- [ ] task description\`.        
- The video is included as a set of <FRAMES> images and the <TRANSCRIPT>.`.role("system")
    }, {
        systemSafety: true,
        model: "vision",
        responseType: "markdown"
    })

    if (error) {
        output.error(error?.message)
    } else {
        output.appendContent(text)
    }
}