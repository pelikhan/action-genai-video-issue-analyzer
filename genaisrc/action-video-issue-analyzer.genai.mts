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
    videoUrl: {
      type: "string",
      description: "Direct video URL to analyze (alternative to extracting from issue body)",
    },
    localFiles: {
      type: "string",
      description: "Local directory path to scan for *.mp4 files, or specific file path to a *.mp4 file",
    },
  },
});

import * as fs from "fs";
import * as path from "path";

const { dbg, output, vars } = env;
const { instructions, videoUrl, localFiles } = vars as { instructions?: string; videoUrl?: string; localFiles?: string };

// Use default instructions if not provided
const finalInstructions = instructions || 
  "Analyze the video and provide a summary of its content. Extract list of followup subissues if any. The transcript is your primary source of text information, ignore text in images.";

// Process local files if provided
if (localFiles) {
  dbg(`Processing local files: ${localFiles}`);
  await processLocalFiles(localFiles);
} else if (videoUrl) {
  dbg(`Processing direct video URL: ${videoUrl}`);
  await processDirectVideoUrl(videoUrl);
} else {
  // Fallback to extracting from issue body
  const issue = await github.getIssue();
  if (!issue)
    throw new Error(
      "No issue found in the context and no videoUrl or localFiles provided. This action requires either an issue to be present, a videoUrl parameter, or localFiles parameter.",
    );

  const RX = /^https:\/\/github.com\/user-attachments\/assets\/.+$/gim;
  const assetLinks = Array.from(
    new Set(Array.from(issue.body.matchAll(RX), (m) => m[0])),
  );
  if (assetLinks.length === 0)
    cancel("No video assets found in the issue body, nothing to do.");

  dbg(`issue: %s`, issue.title);

  for (const assetLink of assetLinks) await processAssetLink(assetLink);
}

async function processAssetLink(assetLink: string) {
  output.heading(4, assetLink);
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

async function processVideo(filename: string, saveToFile?: string): Promise<string | void> {
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
  const { text, error } = await runPrompt(
    (ctx) => {
      ctx.def("TRANSCRIPT", transcript?.srt, { ignoreEmpty: true }); // ignore silent videos
      ctx.defImages(frames, { detail: "low", sliceSample: 40 }); // low detail for better performance
      ctx.$`${finalInstructions}
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
    return;
  }

  if (saveToFile) {
    // Save to file instead of appending to output
    await workspace.writeText(saveToFile, text);
    dbg(`Analysis saved to: ${saveToFile}`);
    return text;
  } else {
    // Original behavior - append to output
    output.appendContent(text);
  }
}

async function processDirectVideoUrl(videoUrl: string) {
  output.heading(4, videoUrl);
  dbg(`Processing direct video URL: ${videoUrl}`);
  
  // Download video from direct URL
  const res = await fetch(videoUrl, { method: "GET" });
  const contentType = res.headers.get("content-type") || "";
  dbg(`download url: %s`, videoUrl);
  dbg(`headers: %O`, res.headers);
  
  if (!res.ok)
    throw new Error(
      `Failed to download video from ${videoUrl}: ${res.status} ${res.statusText}`,
    );
  
  if (!/^video\//.test(contentType)) {
    output.p(`URL does not point to a video file, skipping`);
    return;
  }

  // save and cache
  const buffer = await res.arrayBuffer();
  dbg(`size`, `${(buffer.byteLength / 1e6) | 0}Mb`);
  const filename = await workspace.writeCached(buffer, { scope: "run" });
  dbg(`filename`, filename);

  await processVideo(filename);
}

async function processLocalFiles(localFilesPath: string) {
  output.heading(4, `Local files: ${localFilesPath}`);
  dbg(`Processing local files: ${localFilesPath}`);
  
  // Check if it's a specific file or directory
  const stat = await fs.promises.stat(localFilesPath);
  
  if (stat.isFile()) {
    // Single file - check if it's an mp4
    if (localFilesPath.toLowerCase().endsWith('.mp4')) {
      await processLocalVideoFile(localFilesPath);
    } else {
      output.p(`File ${localFilesPath} is not an MP4 file, skipping`);
    }
  } else if (stat.isDirectory()) {
    // Directory - scan for mp4 files
    const files = await fs.promises.readdir(localFilesPath);
    const mp4Files = files.filter(file => file.toLowerCase().endsWith('.mp4'));
    
    if (mp4Files.length === 0) {
      output.p(`No MP4 files found in directory ${localFilesPath}`);
      return;
    }
    
    dbg(`Found ${mp4Files.length} MP4 files in ${localFilesPath}`);
    
    for (const mp4File of mp4Files) {
      const fullPath = path.join(localFilesPath, mp4File);
      await processLocalVideoFile(fullPath);
    }
  } else {
    throw new Error(`Local files path ${localFilesPath} is neither a file nor a directory`);
  }
}

async function processLocalVideoFile(videoPath: string) {
  output.heading(5, `Processing: ${videoPath}`);
  dbg(`Processing local video file: ${videoPath}`);
  
  // Check if file exists and is accessible
  try {
    await fs.promises.access(videoPath, fs.constants.R_OK);
  } catch (error) {
    output.error(`Cannot access video file: ${videoPath}`);
    return;
  }
  
  // Generate output path (change .mp4 to .md)
  const outputPath = videoPath.replace(/\.mp4$/i, '.md');
  dbg(`Output will be saved to: ${outputPath}`);
  
  // Process the video and save result
  const result = await processVideo(videoPath, outputPath);
  
  if (result) {
    output.p(`✅ Analysis completed and saved to: ${outputPath}`);
  }
}
