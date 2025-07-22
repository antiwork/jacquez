import { NextRequest, NextResponse } from "next/server";
import { App } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import { parseAIResponse } from "../../../utils/jsonParser";

// Configuration
const config = {
  maxTokens: parseInt(process.env.MAX_TOKENS!) || 300,
  cacheTimeout: parseInt(process.env.CACHE_TIMEOUT!) || 300000, // 5 minutes
  minCommentLength: parseInt(process.env.MIN_COMMENT_LENGTH!) || 3,
  enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === "true",
  enableCaching: process.env.ENABLE_CACHING !== "false",
  aiModel: process.env.AI_MODEL || "claude-3-5-sonnet-20241022",
};

// In-memory cache for contributing guidelines
const cache = new Map<string, { content: string; timestamp: number }>();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Create GitHub App instance (with fallback for build-time compatibility)
const app = new App({
  appId: process.env.GH_APP_ID || process.env.APP_ID || "placeholder",
  privateKey: process.env.GH_PRIVATE_KEY || process.env.PRIVATE_KEY || "placeholder",
  webhooks: {
    secret: process.env.GH_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || "placeholder",
  },
});

// Logging utility
function log(level: string, message: string, data: any = null) {
  const timestamp = new Date().toISOString();

  if (config.enableDetailedLogging || level === "ERROR") {
    console.log(
      `[${timestamp}] ${level}: ${message}`,
      data ? JSON.stringify(data, null, 2) : ""
    );
  } else {
    console.log(`[${timestamp}] ${level}: ${message}`);
  }
}

// Helper function to check if content contains "aside" keyword
function containsAsideKeyword(content: string): boolean {
  return content.toLowerCase().includes("aside");
}

// Helper function to load contributing.md from repository with caching
async function loadContributingGuidelines(
  octokit: any,
  owner: string,
  repo: string
): Promise<string | null> {
  const cacheKey = `${owner}/${repo}`;

  // Check cache first
  if (config.enableCaching && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < config.cacheTimeout) {
      log("INFO", `Contributing guidelines loaded from cache for ${cacheKey}`);
      return cached.content;
    } else {
      cache.delete(cacheKey); // Remove expired cache
    }
  }

  log("INFO", `Loading contributing guidelines for ${cacheKey}`);

  const altPaths = [
    "CONTRIBUTING.md",
    "contributing.md",
    ".github/CONTRIBUTING.md",
    "docs/CONTRIBUTING.md",
  ];

  for (const path of altPaths) {
    try {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: owner,
          repo: repo,
          path: path,
        }
      );

      if (response.data.content) {
        const content = Buffer.from(response.data.content, "base64").toString(
          "utf-8"
        );

        // Cache the result
        if (config.enableCaching) {
          cache.set(cacheKey, {
            content,
            timestamp: Date.now(),
          });
        }

        log("INFO", `Contributing guidelines found at ${path} for ${cacheKey}`);
        return content;
      }
    } catch (error: any) {
      log("DEBUG", `Failed to load contributing guidelines from ${path}`, {
        error: error.message,
      });
      // Continue to next path
    }
  }

  log("WARN", `No contributing guidelines found for ${cacheKey}`);
  return null;
}

// Helper function to generate friendly response using Claude
async function generateFriendlyResponse(
  contributingContent: string,
  submissionContent: string,
  submissionType: string,
  repoInfo: any = null
): Promise<{ comment_needed: boolean; comment: string; reasoning: string }> {
  try {
    log("INFO", `Generating AI response for ${submissionType}`);

    const prompt = `You are a conservative GitHub bot that helps contributors follow project guidelines. You should ONLY comment when there are clear, obvious violations of the contributing guidelines that would prevent proper review or processing.

Contributing guidelines:
${contributingContent}

Submission type: ${submissionType}
Submission content:
${submissionContent}

Analyze the submission against the contributing guidelines. You should ONLY provide a response if there are clear, obvious violations of the guidelines that would prevent proper review or processing.

CRITICAL: Only comment if you can identify SPECIFIC, CLEAR violations such as:
- Missing required template sections that are explicitly mentioned in guidelines
- Missing required information that is clearly stated as mandatory
- Clear format violations (e.g., not using required issue templates)
- Missing required screenshots/documentation when explicitly required
- Obviously incomplete submissions that lack essential information

DO NOT comment for minor style issues such as:
- Single question marks or exclamation points (only flag if there are 2+ consecutive: ??, !!!, etc.)
- Minor grammatical errors or typos unless they make the content incomprehensible
- Casual language that is still professional and clear
- Minor formatting preferences that don't affect readability

DO NOT comment if:
- The submission mostly follows guidelines with minor omissions
- You're unsure whether something is truly required
- The guidelines are vague or open to interpretation
- The submission appears to be a reasonable attempt at following guidelines
- Communication style issues that don't prevent understanding

Respond with a JSON object containing:
- comment_needed: boolean (true only if there are clear violations)
- comment: string (1-2 sentence comment if needed, empty string if not needed)
- reasoning: string (brief explanation of why comment is or isn't needed)

If you determine there ARE clear violations, the comment should:
- Thank them for their contribution
- Be SPECIFIC about what's clearly missing or violating guidelines
- Quote the exact guideline requirements that aren't met
- Explain why those requirements are necessary
- Provide clear, actionable next steps
- Maintain an encouraging tone

Keep comments concise (1-2 sentences) and only comment on clear violations.`;

    const response = await anthropic.messages.create({
      model: config.aiModel,
      max_tokens: config.maxTokens,
      messages: [
        {
          role: "user",
          content: prompt,
        },
        {
          role: "assistant",
          content: "{",
        },
      ],
    });

    const aiResponse =
      response.content[0].type === "text" ? response.content[0].text : "";
    
    const result = parseAIResponse(aiResponse);
    
    log("INFO", `AI response generated successfully`, {
      comment_needed: result.comment_needed,
      submissionType,
      repoInfo,
    });

    return result;
  } catch (error: any) {
    log("ERROR", `Error generating AI response for ${submissionType}`, {
      error: error.message,
      stack: error.stack,
      repoInfo,
    });

    return {
      comment_needed: false,
      comment: "",
      reasoning: "Error occurred during AI analysis, skipping comment to avoid spam",
    };
  }
}

// Handle pull request opened events
async function handlePullRequestOpened({ octokit, payload }: any) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const prBody = payload.pull_request.body || "";
  const repoInfo = { owner, repo, prNumber };

  log("INFO", `Pull request opened`, {
    url: payload.pull_request.html_url,
    author: payload.pull_request.user.login,
    ...repoInfo,
  });

  try {
    // Load contributing guidelines
    const contributingContent = await loadContributingGuidelines(
      octokit,
      owner,
      repo
    );

    if (contributingContent) {
      if (containsAsideKeyword(prBody)) {
        log("INFO", `Skipping PR analysis due to "aside" keyword`, repoInfo);
        return;
      }

      // Generate response using Claude to check against guidelines
      const response = await generateFriendlyResponse(
        contributingContent,
        prBody,
        "pull request",
        repoInfo
      );

      // Only post comment if there are clear violations
      if (response.comment_needed) {
        await octokit.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner: owner,
            repo: repo,
            issue_number: prNumber,
            body: response.comment,
          }
        );

        log("INFO", `Comment posted successfully for PR`, { ...repoInfo, reasoning: response.reasoning });
      } else {
        log(
          "INFO",
          `No clear violations found, skipping comment for PR`,
          { ...repoInfo, reasoning: response.reasoning }
        );
      }
    } else {
      // No contributing guidelines found, send generic welcome
      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: owner,
          repo: repo,
          issue_number: prNumber,
          body: "Hello! Thanks for opening this pull request. 🤖",
        }
      );

      log("INFO", `Generic welcome comment posted for PR`, repoInfo);
    }
  } catch (error: any) {
    log("ERROR", `Error handling pull request opened event`, {
      error: error.message,
      stack: error.stack,
      ...repoInfo,
    });
  }
}

// Handle issues opened events
async function handleIssueOpened({ octokit, payload }: any) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const issueBody = payload.issue.body || "";
  const repoInfo = { owner, repo, issueNumber };

  log("INFO", `Issue opened`, {
    url: payload.issue.html_url,
    author: payload.issue.user.login,
    title: payload.issue.title,
    ...repoInfo,
  });

  try {
    // Load contributing guidelines
    const contributingContent = await loadContributingGuidelines(
      octokit,
      owner,
      repo
    );

    if (contributingContent) {
      if (containsAsideKeyword(issueBody)) {
        log("INFO", `Skipping issue analysis due to "aside" keyword`, repoInfo);
        return;
      }

      // Generate response using Claude to check against guidelines
      const response = await generateFriendlyResponse(
        contributingContent,
        issueBody,
        "issue",
        repoInfo
      );

      // Only post comment if there are clear violations
      if (response.comment_needed) {
        await octokit.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner: owner,
            repo: repo,
            issue_number: issueNumber,
            body: response.comment,
          }
        );

        log("INFO", `Comment posted successfully for issue`, { ...repoInfo, reasoning: response.reasoning });
      } else {
        log(
          "INFO",
          `No clear violations found, skipping comment for issue`,
          { ...repoInfo, reasoning: response.reasoning }
        );
      }
    } else {
      // No contributing guidelines found, send generic welcome
      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: owner,
          repo: repo,
          issue_number: issueNumber,
          body: "Hello! Thanks for opening this issue. We'll take a look at it soon. 🤖",
        }
      );

      log("INFO", `Generic welcome comment posted for issue`, repoInfo);
    }
  } catch (error: any) {
    log("ERROR", `Error handling issue opened event`, {
      error: error.message,
      stack: error.stack,
      ...repoInfo,
    });
  }
}

// Handle issue comment events
async function handleIssueCommentCreated({ octokit, payload }: any) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const issueNumber = payload.issue.number;
  const commentBody = payload.comment.body || "";
  const repoInfo = { owner, repo, issueNumber };

  log("INFO", `Issue comment created`, {
    url: payload.comment.html_url,
    author: payload.comment.user.login,
    userType: payload.comment.user.type,
    commentLength: commentBody.length,
    ...repoInfo,
  });

  // Skip if comment is from the bot itself
  if (payload.comment.user.type === "Bot") {
    log("INFO", "Skipping bot comment", repoInfo);
    return;
  }

  try {
    // Load contributing guidelines
    const contributingContent = await loadContributingGuidelines(
      octokit,
      owner,
      repo
    );

    if (contributingContent) {
      // Check if comment meets minimum length requirement
      if (commentBody.length > config.minCommentLength) {
        if (containsAsideKeyword(commentBody)) {
          log("INFO", `Skipping comment analysis due to "aside" keyword`, repoInfo);
          return;
        }

        log("INFO", "Generating response for comment", repoInfo);

        // Generate response using Claude to check against guidelines
        const response = await generateFriendlyResponse(
          contributingContent,
          commentBody,
          "comment",
          repoInfo
        );

        // Only post comment if there are clear violations
        if (response.comment_needed) {
          await octokit.request(
            "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
            {
              owner: owner,
              repo: repo,
              issue_number: issueNumber,
              body: response.comment,
            }
          );

          log("INFO", "Comment posted successfully", { ...repoInfo, reasoning: response.reasoning });
        } else {
          log("INFO", "No clear violations found, skipping comment", { ...repoInfo, reasoning: response.reasoning });
        }
      } else {
        log(
          "INFO",
          `Comment too short (${commentBody.length} chars), skipping`,
          repoInfo
        );
      }
    } else {
      log(
        "INFO",
        "No contributing guidelines found, skipping comment analysis",
        repoInfo
      );
    }
  } catch (error: any) {
    log("ERROR", `Error handling issue comment created event`, {
      error: error.message,
      stack: error.stack,
      ...repoInfo,
    });
  }
}

// Register event listeners
app.webhooks.on("pull_request.opened", handlePullRequestOpened);
app.webhooks.on("issues.opened", handleIssueOpened);
app.webhooks.on("issue_comment.created", handleIssueCommentCreated);

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    const id = request.headers.get("x-github-delivery");
    const event = request.headers.get("x-github-event");

    if (!signature || !id || !event) {
      return NextResponse.json(
        { error: "Missing required headers" },
        { status: 400 }
      );
    }

    // Process the webhook with the Octokit App
    await app.webhooks.verifyAndReceive({
      id,
      name: event as any,
      signature,
      payload: body,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    log("ERROR", "Webhook processing failed", {
      error: error.message,
      stack: error.stack,
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
