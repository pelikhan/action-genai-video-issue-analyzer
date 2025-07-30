script({
  title: "Analyzes videos upload as assets",
  accept: "none",
  parameters: {
    instructions: {
      type: "string",
      description: "Custom prompting instructions for each video.",
      default:
        "Analyze the video and provide a summary of its content. Extract list of followup subissues if any. The transcript is your primary source of text information, ignore text in images.",
    },
    imageDetail: {
      type: "string",
      description: "Image detail level for analysis.",
      default: "low",
      enum: ["low", "high"],
    },
    chunkSize: {
      type: "number",
      description: "Number of frames to process in each chunk.",
      default: 40,
      minimum: 1,
      maximum: 100,
    },
  },
});

const { dbg, output, vars } = env;
const issue = await github.getIssue();
if (!issue)
  throw new Error(
    "No issue found in the context. This action requires an issue to be present.",
  );
const { instructions, imageDetail, chunkSize } = vars as {
  instructions: string;
  imageDetail: string;
  chunkSize: number;
};
if (!instructions)
  throw new Error(
    "No instructions provided. Please provide instructions to process the video.",
  );

const RX = /^https:\/\/github.com\/user-attachments\/assets\/.+$/gim;
const assetLinks = Array.from(
  new Set(Array.from(issue.body.matchAll(RX), (m) => m[0])),
);
if (assetLinks.length === 0)
  cancel("No video assets found in the issue body, nothing to do.");

dbg(`issue: %s`, issue.title);

for (const assetLink of assetLinks) await processAssetLink(assetLink);

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function processFrameChunk(
  frames: string[],
  transcript: any,
  chunkIndex: number,
  totalChunks: number,
  filename: string,
): Promise<string> {
  dbg(
    `Processing chunk ${chunkIndex + 1}/${totalChunks} with ${frames.length} frames`,
  );

  const { text, error } = await runPrompt(
    (ctx) => {
      ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true });
      ctx.defImages(frames, { detail: imageDetail as "low" | "high" });
      ctx.$`${instructions}

This is chunk ${chunkIndex + 1} of ${totalChunks} from the video analysis.
Focus on analyzing the content in these specific frames while being aware this is part of a larger video.

## Output format
- Use GitHub Flavored Markdown (GFM) for markdown syntax formatting.
- If you need to list tasks, use the format \`- [ ] task description\`.
- Do not generate links.
- When possible, include a pointer to the \`[minute:second]\` location in the video using YouTube format.
- The video frames and transcript are provided for this chunk.`.role("system");
    },
    {
      systemSafety: true,
      model: "vision",
      responseType: "markdown",
      label: `analyze video chunk ${chunkIndex + 1}/${totalChunks} of ${filename}`,
    },
  );

  if (error) {
    output.error(`Error processing chunk ${chunkIndex + 1}: ${error?.message}`);
    return `## Chunk ${chunkIndex + 1} Analysis Failed\n\nError: ${error?.message}`;
  }

  return text || `## Chunk ${chunkIndex + 1} Analysis\n\nNo content generated.`;
}

async function processAssetLink(assetLink: string) {
  output.heading(3, assetLink);
  dbg(assetLink);
  const downloadUrl = await github.resolveAssetUrl(assetLink);
  const res = await fetch(downloadUrl, { method: "GET" });
  const contentType = res.headers.get("content-type") || "";
  dbg(`download url: %s`, downloadUrl);
  dbg(`headers: %O`, res.headers);
  if (!res.ok)
    throw new Error(
      `Failed to download asset from ${downloadUrl}: ${res.status} ${res.statusText}`,
    );
  if (!/^video\//.test(contentType)) {
    output.p(`Asset is not a video file, skipping`);
    return;
  }

  // save and cache
  const buffer = await res.arrayBuffer();
  dbg(`size`, `${(buffer.byteLength / 1e6) | 0}Mb`);
  const filename = await workspace.writeCached(buffer, { scope: "run" });
  dbg(`filename`, filename);

  await processVideo(filename);
}

async function processVideo(filename: string) {
  const transcript = await transcribe(filename, {
    model: "whisperasr:default",
    cache: true,
  });
  if (!transcript) {
    output.error(`no transcript found for video ${filename}.`);
  }
  const frames = await ffmpeg.extractFrames(filename, {
    transcript,
  });

  // If we have few frames or using low detail, process normally
  if (frames.length <= chunkSize || imageDetail === "low") {
    const { text, error } = await runPrompt(
      (ctx) => {
        ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }); // ignore silent videos
        ctx.defImages(frames, {
          detail: imageDetail as "low" | "high",
          sliceSample: chunkSize,
        });
        ctx.$`${instructions}
## Output format
- Use GitHub Flavored Markdown (GFM) for markdown syntax formatting.
- If you need to list tasks, use the format \`- [ ] task description\`.
- Do not generate links.
- When possible, include a pointer to the \`[minute:second]\` location in the video using YouTube format.
- The video is included as a set of <FRAMES> images and the <TRANSCRIPT>.`.role(
          "system",
        );
      },
      {
        systemSafety: true,
        model: "vision",
        responseType: "markdown",
        label: `analyze video ${filename}`,
      },
    );

    if (error) {
      output.error(error?.message);
    } else {
      output.appendContent(text);
    }
    return;
  }

  // Process in chunks for high detail or many frames
  const chunks = chunkArray(frames, chunkSize);
  const chunkResults: string[] = [];

  output.heading(
    4,
    `Processing ${frames.length} frames in ${chunks.length} chunks`,
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunkResult = await processFrameChunk(
      chunks[i],
      transcript,
      i,
      chunks.length,
      filename,
    );
    chunkResults.push(chunkResult);
  }

  // Generate final summary from all chunks
  dbg(`Generating final summary from ${chunkResults.length} chunk results`);
  const { text: finalSummary, error: summaryError } = await runPrompt(
    (ctx) => {
      ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true });
      ctx.def("CHUNK_ANALYSES", chunkResults.join("\n\n---\n\n"));
      ctx.$`${instructions}

You have been provided with analyses of individual chunks from a video, along with the full transcript.
Please create a comprehensive final summary that integrates insights from all chunks.

## Your task:
- Synthesize the information from all chunk analyses
- Provide a cohesive summary of the entire video content
- Extract any followup tasks or subissues mentioned across chunks
- Ensure the summary flows naturally and isn't just a concatenation

## Output format
- Use GitHub Flavored Markdown (GFM) for markdown syntax formatting.
- If you need to list tasks, use the format \`- [ ] task description\`.
- Do not generate links.
- When possible, include a pointer to the \`[minute:second]\` location in the video using YouTube format.
- The video transcript and individual chunk analyses are provided below.`.role(
        "system",
      );
    },
    {
      systemSafety: true,
      model: "vision",
      responseType: "markdown",
      label: `final summary for video ${filename}`,
    },
  );

  if (summaryError) {
    output.error(`Error generating final summary: ${summaryError?.message}`);
    // Fallback: output individual chunk results
    output.heading(3, "Individual Chunk Analyses");
    for (const chunkResult of chunkResults) {
      output.appendContent(chunkResult);
      output.appendContent("\n\n---\n\n");
    }
  } else {
    output.appendContent(finalSummary);
  }
}
