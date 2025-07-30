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
    saveScreenshots: {
      type: "boolean",
      description:
        "Save important screenshots to a detached branch for reference.",
    },
  },
});

const { dbg, output, vars } = env;
const issue = await github.getIssue();
if (!issue)
  throw new Error(
    "No issue found in the context. This action requires an issue to be present.",
  );
const { instructions, saveScreenshots } = vars as {
  instructions: string;
  saveScreenshots: boolean;
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
dbg(`saveScreenshots: %s`, saveScreenshots);

for (const assetLink of assetLinks) await processAssetLink(assetLink);

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

  // Build instructions based on saveScreenshots setting
  let promptInstructions = instructions;
  if (saveScreenshots) {
    promptInstructions += `

## Screenshot Selection
In addition to your analysis, please provide a section at the end titled "## Screenshots to Save" with a numbered list of the most important frames/images that should be preserved for reference. Select 3-5 key images that best represent important moments, issues, or concepts from the video. 

**Important:** The frames are numbered starting from 1. Review the provided <FRAMES> and select the frame numbers accordingly.

For each selected image, provide:
- Frame number (1-based index from the available frames)
- Brief description of why this frame is important

Format this section exactly as:
## Screenshots to Save
1. Frame 5 - Important UI element shown
2. Frame 12 - Error state visible
(etc.)

Only include this section if you identify frames that would be valuable to preserve.`;
  }

  const { text, error } = await runPrompt(
    (ctx) => {
      ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }); // ignore silent videos
      ctx.defImages(frames, { detail: "low", sliceSample: 40 }); // low detail for better performance
      ctx.$`${promptInstructions}
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
    // Process screenshots if enabled
    if (saveScreenshots && text) {
      const savedImages = await processScreenshots(text, frames, filename);
      // Append image references to the output
      if (savedImages.length > 0) {
        const imageMarkdown = generateImageMarkdown(savedImages);
        output.appendContent(text + "\n\n" + imageMarkdown);
      } else {
        output.appendContent(text);
      }
    } else {
      output.appendContent(text);
    }
  }
}

interface SavedImage {
  filename: string;
  path: string;
  url: string;
  description: string;
}

async function processScreenshots(
  analysisText: string,
  frames: string[],
  videoFilename: string,
): Promise<SavedImage[]> {
  if (!saveScreenshots) return [];

  // Parse the screenshot selection from the LLM response
  const screenshotMatches = parseScreenshotSelection(analysisText);
  if (screenshotMatches.length === 0) {
    dbg("No screenshots selected by LLM");
    return [];
  }

  dbg(`Found ${screenshotMatches.length} screenshots to save`);

  // Get PR/Issue context for folder structure
  const contextId = await getContextId();
  if (!contextId) {
    dbg("No PR/Issue context found, skipping screenshot save");
    return [];
  }

  const savedImages: SavedImage[] = [];

  for (const match of screenshotMatches) {
    try {
      const frameIndex = match.frameNumber - 1; // Convert to 0-based index
      if (frameIndex >= 0 && frameIndex < frames.length) {
        const framePath = frames[frameIndex];
        const savedImage = await saveImageToDetachedBranch(
          framePath,
          match.filename,
          contextId,
          match.description,
        );
        if (savedImage) {
          savedImages.push(savedImage);
        }
      } else {
        dbg(`Frame ${match.frameNumber} is out of range (1-${frames.length})`);
      }
    } catch (error) {
      dbg(`Error saving screenshot ${match.filename}: ${error}`);
    }
  }

  return savedImages;
}

function parseScreenshotSelection(
  text: string,
): Array<{ frameNumber: number; filename: string; description: string }> {
  const screenshotSection = text.match(
    /## Screenshots to Save\s*\n([\s\S]*?)(?=\n##|\n---|\n\n#|$)/i,
  );
  if (!screenshotSection) {
    dbg("No 'Screenshots to Save' section found in LLM response");
    return [];
  }

  const lines = screenshotSection[1].split("\n");
  const results: Array<{
    frameNumber: number;
    filename: string;
    description: string;
  }> = [];

  for (const line of lines) {
    // Match patterns like:
    // "1. Frame 5 - Description text"
    // "2. Frame 12 - Another description"
    const match = line.match(/^\s*\d+\.\s*Frame\s+(\d+)\s*-\s*(.+?)\s*$/i);
    if (match) {
      const frameNumber = parseInt(match[1]);
      const description = match[2].trim();

      // Validate frame number
      if (isNaN(frameNumber) || frameNumber < 1) {
        dbg(`Invalid frame number: ${match[1]}`);
        continue;
      }

      // Generate hash-based filename
      const hash = require("crypto")
        .createHash("md5")
        .update(`${frameNumber}-${description}`)
        .digest("hex")
        .substring(0, 8);
      const filename = `frame-${frameNumber}-${hash}`;

      results.push({ frameNumber, description, filename });
      dbg(
        `Parsed screenshot: Frame ${frameNumber} - ${description} - ${filename}`,
      );
    } else if (line.trim() && line.includes("Frame")) {
      dbg(`Could not parse line: ${line.trim()}`);
    }
  }

  dbg(`Parsed ${results.length} valid screenshot selections`);
  return results;
}

async function getContextId(): Promise<string | null> {
  try {
    const issue = await github.getIssue();
    if (issue?.number) {
      return `issue-${issue.number}`;
    }

    return null;
  } catch (error) {
    dbg(`Error getting context ID: ${error}`);
    return null;
  }
}

async function saveImageToDetachedBranch(
  framePath: string,
  filename: string,
  contextId: string,
  description: string,
): Promise<SavedImage | null> {
  try {
    const branchName = "screenshots";

    // Read the frame image file
    const frameFile = await workspace.readText(framePath);
    if (!frameFile) {
      dbg(`Could not read frame file: ${framePath}`);
      return null;
    }

    // Get repository information
    const githubInfo = await github.info();
    if (!githubInfo) {
      dbg("No GitHub info available");
      return null;
    }

    // Upload the image to the screenshots branch
    // The uploadAsset method uploads to an orphaned branch and returns a URL
    const imageUrl = await github.uploadAsset(frameFile.content, {
      branchName,
    });

    dbg(`Uploaded screenshot: ${filename}.png to ${imageUrl}`);

    return {
      filename: `${filename}.png`,
      path: `${contextId}/${filename}.png`,
      url: imageUrl,
      description,
    };
  } catch (error) {
    dbg(`Error uploading screenshot ${filename}: ${error}`);
    return null;
  }
}

function generateImageMarkdown(savedImages: SavedImage[]): string {
  if (savedImages.length === 0) return "";

  let markdown = "\n## Saved Screenshots\n\n";
  markdown +=
    "The following key screenshots have been saved for reference:\n\n";

  for (const image of savedImages) {
    markdown += `### ${image.description}\n\n`;
    markdown += `![${image.description}](${image.url})\n\n`;
    markdown += `*Filename: \`${image.filename}\`*\n\n`;
  }

  markdown += `---\n\n`;
  markdown += `*Note: Screenshots are automatically saved to the \`screenshots\` branch when the \`saveScreenshots\` option is enabled.*\n`;

  return markdown;
}
