import { Octokit } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

async function fetchPRFiles(octokit, owner, repo, prNumber) {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }
    );
    return response.data || [];
  } catch (error) {
    console.error(`Error fetching PR files for ${owner}/${repo}#${prNumber}`, {
      error: error.message,
    });
    return [];
  }
}

function parseDiffForChangedLines(patch) {
  if (!patch) return [];

  const lines = patch.split("\n");
  const changedLines = [];
  let position = 0;
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      if (match) {
        lineNumber = parseInt(match[1]) - 1;
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      changedLines.push({
        line: line.substring(1),
        position: position,
        lineNumber: lineNumber,
      });
    } else if (line.startsWith(" ")) {
      lineNumber++;
    }
    position++;
  }

  return changedLines;
}

async function generateCodeAnalysisResponse(contributingContent, fileName, changedLines, anthropic, config) {
  try {
    const codeContext = changedLines
      .map((cl) => `Line ${cl.lineNumber}: ${cl.line}`)
      .join("\n");

    const systemPrompt = `You are a GitHub bot that reviews code changes against contributing guidelines. Analyze the provided code changes and identify specific lines that violate the contributing guidelines.\n\nFor each violation, provide:\n- The exact position in the diff where the violation occurs\n- A brief, actionable comment (1-2 sentences max)\n\nOnly comment on clear, specific violations. Do not comment on:\n- Minor style issues\n- Subjective preferences\n- Code that mostly follows guidelines\n\nResponse format (JSON array):\n[\n  {\n    \"position\": number,\n    \"comment\": \"Brief explanation of the violation and how to fix it\"\n  }\n]\n\nIf no violations are found, return an empty array: []`;

    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Contributing guidelines:\n${contributingContent}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `File: ${fileName}\n\nCode changes:\n${codeContext}`,
          },
        ],
      },
      {
        role: "assistant",
        content: "[",
      },
    ];

    const response = await anthropic.messages.create({
      model: config.aiModel,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: messages,
    });

    const aiResponse =
      response.content[0].type === "text" ? response.content[0].text : "";
    try {
      const result = JSON.parse(`[${aiResponse}`);
      return Array.isArray(result) ? result : [];
    } catch (parseError) {
      console.error("Failed to parse AI response for code analysis", { aiResponse });
      return [];
    }
  } catch (error) {
    console.error(`Error generating code analysis for ${fileName}`, {
      error: error.message,
    });
    return [];
  }
}

async function loadContributingGuidelines(octokit, owner, repo) {
  const paths = [
    "CONTRIBUTING.md",
    "contributing.md",
    ".github/CONTRIBUTING.md",
    "docs/CONTRIBUTING.md",
  ];
  for (const path of paths) {
    try {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner,
          repo,
          path,
        }
      );
      if (response.data.content) {
        return Buffer.from(response.data.content, "base64").toString("utf-8");
      }
    } catch (error) {
      // ignore and try next path
    }
  }
  return null;
}

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!token || !anthropicKey) {
    console.error("Missing GITHUB_TOKEN or ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;

  const octokit = new Octokit({ auth: token });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const config = {
    maxTokens: parseInt(process.env.MAX_TOKENS || "300", 10),
    aiModel: process.env.AI_MODEL || "claude-sonnet-4-20250514",
  };

  const contributingContent = await loadContributingGuidelines(octokit, owner, repo);
  if (!contributingContent) {
    console.log("No contributing guidelines found, skipping Jacquez check");
    return;
  }

  const prFiles = await fetchPRFiles(octokit, owner, repo, prNumber);
  const reviewComments = [];

  for (const file of prFiles) {
    if (!file.patch) continue;
    const changedLines = parseDiffForChangedLines(file.patch);
    if (changedLines.length === 0) continue;

    const codeAnalysis = await generateCodeAnalysisResponse(
      contributingContent,
      file.filename,
      changedLines,
      anthropic,
      config
    );

    for (const analysis of codeAnalysis) {
      if (analysis.position !== undefined && analysis.comment) {
        reviewComments.push({
          path: file.filename,
          position: analysis.position,
          body: analysis.comment,
        });
      }
    }
  }

  if (reviewComments.length > 0) {
    await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      owner,
      repo,
      pull_number: prNumber,
      event: "COMMENT",
      comments: reviewComments,
    });
    console.error(`Jacquez found ${reviewComments.length} guideline violations.`);
    process.exit(1);
  } else {
    console.log("Jacquez found no guideline violations.");
  }
}

run().catch((error) => {
  console.error("Jacquez check failed", error);
  process.exit(1);
});

