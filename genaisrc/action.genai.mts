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

output.heading(3, `issue`)
output.itemValue(`title`, issue.title)
output.fence(issue.body, "markdown")

// collect asset links
// https://github.com/user-attachments/assets/299a67a1-7259-422e-9ecb-7beb306da3bb
output.heading(3, `asset links`)
for (const assetLink of assetLinks) {
    output.itemLink(assetLink)
}

output.heading(3, `processing assets`)
for (const assetLink of assetLinks) {
    await processAssetLink(assetLink)
}

async function processAssetLink(assetLink: string) {
    output.heading(4, assetLink)
    const downloadUrl = await github.resolveAssetUrl(assetLink)
    const res = await fetch(downloadUrl, { method: "GET" })
    const contentType = res.headers.get("content-type") || ""
    dbg(`download url: %s`, downloadUrl)
    output.itemValue(`status`, res.statusText)
    dbg(`headers: %O`, res.headers)
    output.itemValue(`content-type`, contentType)
    if (!res.ok)
        throw new Error(`Failed to download asset from ${downloadUrl}: ${res.status} ${res.statusText}`)
    if (!/^video\//.test(contentType)) {
        output.p(`Asset is not a video file, skipping`)
        return;
    }

    // save and cache
    const buffer = await res.arrayBuffer()
    output.itemValue(`size`, `${(buffer.byteLength / 1e6) | 0}Mb`)
    const filename = await workspace.writeCached(buffer, { scope: "run" })
    output.itemValue(`filename`, filename)

    await processVideo(filename)
}

async function processVideo(filename: string) {
    const transcript = await transcribe(filename, { model: "whisperasr:default", cache: true })
    const frames = await ffmpeg.extractFrames(filename, {
        transcript,
        cache: true,
    })
    const res = await runPrompt(ctx => {
        def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }) // ignore silent videos
        defImages(frames, { detail: "low" }) // low detail for better performance
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
}