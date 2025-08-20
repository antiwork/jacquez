import { NextRequest, NextResponse } from "next/server";
import { App } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import { parseAIResponse } from "../../../utils/jsonParser";
import { 
  fetchPRFiles, 
  parseDiffForChangedLines, 
  generateCodeAnalysisResponse, 
  handlePullRequestCodeReview,
  handlePullRequestCodeReviewWithViolations,
  createCheckRun,
  updateCheckRun
} from "../../../utils/prCodeReview";

// Configuration
const config = {
  maxTokens: parseInt(process.env.MAX_TOKENS!) || 300,
  cacheTimeout: parseInt(process.env.CACHE_TIMEOUT!) || 300000, // 5 minutes
  minCommentLength: parseInt(process.env.MIN_COMMENT_LENGTH!) || 3,
  enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === "true",
  enableCaching: process.env.ENABLE_CACHING !== "false",
  aiModel: process.env.AI_MODEL || "claude-sonnet-4-20250514",
};

// In-memory cache for contributing guidelines
const cache = new Map<string, { content: string; timestamp: number }>();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Create GitHub App instance
const app = new App({
  appId: process.env.GH_APP_ID!,
  privateKey: process.env.GH_PRIVATE_KEY!,
  webhooks: {
    secret: process.env.GH_WEBHOOK_SECRET!,
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

// Helper function to fetch comment thread for issues and PRs
async function fetchCommentThread(
  octokit: any,
  owner: string,
  repo: string,
  issueNumber: number,
  maxComments: number = 20
): Promise<string> {
  try {
    log("INFO", `Fetching comment thread for ${owner}/${repo}#${issueNumber}`);
    
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner,
        repo,
        issue_number: issueNumber,
        per_page: maxComments,
        sort: "created",
        direction: "asc"
      }
    );

    if (response.data.length === 0) {
      return "No previous comments in this thread.";
    }

    const commentThread = response.data
      .map((comment: any, index: number) => {
        const author = comment.user.login;
        const createdAt = new Date(comment.created_at).toLocaleString();
        const body = comment.body || "";
        return `Comment ${index + 1} by @${author} (${createdAt}):\n${body}`;
      })
      .join("\n\n---\n\n");

    return `Previous comments in this thread:\n\n${commentThread}`;
  } catch (error: any) {
    log("ERROR", `Error fetching comment thread for ${owner}/${repo}#${issueNumber}`, {
      error: error.message,
    });
    return "Unable to fetch previous comments.";
  }
}


// Helper function to extract markdown links from content
function extractMarkdownLinks(content: string): Array<{text: string, url: string}> {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: Array<{text: string, url: string}> = [];
  let match;
  
  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2]
    });
  }
  
  return links;
}

// Helper function to resolve relative URLs to raw GitHub URLs
function resolveGitHubUrl(url: string, owner: string, repo: string): string | null {
  if (url.startsWith('http')) {
    if (url.includes('github.com') && url.includes(owner) && url.includes(repo)) {
      return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/').replace('/tree/', '/');
    }
    return null; // Skip non-GitHub URLs
  }
  
  // Handle relative URLs - convert to raw GitHub URL
  const cleanUrl = url.startsWith('./') ? url.substring(2) : url;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/${cleanUrl}`;
}

// Helper function to fetch content from URL
async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.text();
    }
  } catch (error: any) {
    log("DEBUG", `Failed to fetch URL content: ${url}`, { error: error.message });
  }
  return null;
}

// Helper function to process linked content for additional links
async function processLinkedContent(
  content: string,
  owner: string, 
  repo: string,
  depth: number,
  visitedUrls: Set<string>
): Promise<string> {
  if (depth >= 3) return content;
  
  const links = extractMarkdownLinks(content);
  let processedContent = content;
  
  for (const link of links) {
    const resolvedUrl = resolveGitHubUrl(link.url, owner, repo);
    if (!resolvedUrl || visitedUrls.has(resolvedUrl)) {
      continue;
    }
    
    visitedUrls.add(resolvedUrl);
    const linkedContent = await fetchUrlContent(resolvedUrl);
    if (linkedContent) {
      const nestedContent = await processLinkedContent(linkedContent, owner, repo, depth + 1, visitedUrls);
      processedContent += `\n\n--- Content from ${link.text} (${link.url}) ---\n${nestedContent}`;
    }
  }
  
  return processedContent;
}

async function loadContributingGuidelines(
  octokit: any,
  owner: string,
  repo: string,
  depth: number = 0,
  visitedUrls: Set<string> = new Set()
): Promise<string | null> {
  const maxDepth = 3;
  if (depth >= maxDepth) {
    log("DEBUG", `Maximum recursion depth reached for ${owner}/${repo}`);
    return null;
  }

  const cacheKey = `${owner}/${repo}:${depth}`;
  
  // Check cache first
  if (config.enableCaching && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < config.cacheTimeout) {
      log("INFO", `Contributing guidelines loaded from cache for ${cacheKey}`);
      return cached.content;
    } else {
      cache.delete(cacheKey);
    }
  }

  log("INFO", `Loading contributing guidelines for ${cacheKey}`);

  const altPaths = [
    "CONTRIBUTING.md",
    "contributing.md", 
    ".github/CONTRIBUTING.md",
    "docs/CONTRIBUTING.md",
  ];

  let mainContent = "";
  let foundPath = "";

  // First, get the main contributing guidelines
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
        mainContent = Buffer.from(response.data.content, "base64").toString("utf-8");
        foundPath = path;
        log("INFO", `Contributing guidelines found at ${path} for ${owner}/${repo}`);
        break;
      }
    } catch (error: any) {
      log("DEBUG", `Failed to load contributing guidelines from ${path}`, {
        error: error.message,
      });
    }
  }

  if (!mainContent) {
    log("WARN", `No contributing guidelines found for ${owner}/${repo}`);
    return null;
  }

  let aggregatedContent = mainContent;
  
  if (depth < maxDepth - 1) {
    const links = extractMarkdownLinks(mainContent);
    log("DEBUG", `Found ${links.length} markdown links in ${foundPath}`, { links: links.map(l => l.url) });
    
    for (const link of links) {
      const resolvedUrl = resolveGitHubUrl(link.url, owner, repo);
      if (!resolvedUrl || visitedUrls.has(resolvedUrl)) {
        continue;
      }
      
      visitedUrls.add(resolvedUrl);
      log("DEBUG", `Following link: ${link.text} -> ${resolvedUrl}`);
      
      const linkedContent = await fetchUrlContent(resolvedUrl);
      if (linkedContent) {
        const processedLinkedContent = await processLinkedContent(
          linkedContent, 
          owner, 
          repo, 
          depth + 1, 
          visitedUrls
        );
        
        aggregatedContent += `\n\n--- Content from ${link.text} (${link.url}) ---\n${processedLinkedContent}`;
        log("INFO", `Successfully aggregated content from ${resolvedUrl}`);
      }
    }
  }

  // Cache the aggregated result
  if (config.enableCaching) {
    cache.set(cacheKey, {
      content: aggregatedContent,
      timestamp: Date.now(),
    });
  }

  return aggregatedContent;
}

// Helper function to generate friendly response using Claude
async function generateFriendlyResponse(
  contributingContent: string,
  submissionContent: string,
  submissionType: string,
  repoInfo: any = null,
  commentThreadContext: string = ""
): Promise<{ comment_needed: boolean; comment: string; reasoning: string }> {
  try {
    log("INFO", `Generating AI response for ${submissionType}`);

    const systemPrompt = `You are a GitHub bot that enforces contributing guidelines. Only comment when there are clear, specific violations of the contributing guidelines.

The contributing guidelines may include content from multiple linked documents that have been automatically aggregated to provide comprehensive context.

DO NOT comment for:
- Minor style, grammar, or formatting issues
- Casual but professional language
- Submissions that mostly follow guidelines

Response format (JSON):
- comment_needed: boolean (true only for clear violations)
- comment: string (1-2 sentences max, direct and actionable)
- reasoning: string (brief explanation)

If commenting, be direct and specific about what's missing without patronizing language.`;

    const messages: Anthropic.Messages.MessageParam[] = [
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
            text: `${
              commentThreadContext ? `\n${commentThreadContext}\n` : ""
            }

Submission type: ${submissionType}
Submission content:
${submissionContent}`,
          },
        ],
      },
      {
        role: "assistant",
        content: "{",
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

    const result = parseAIResponse(aiResponse);

    log("INFO", `AI response generated successfully`, {
      comment_needed: result.comment_needed,
      submissionType,
      repoInfo,
      usage: response.usage,
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
  const headSha = payload.pull_request.head.sha;
  const repoInfo = { owner, repo, prNumber };

  log("INFO", `Pull request opened`, {
    url: payload.pull_request.html_url,
    author: payload.pull_request.user.login,
    ...repoInfo,
  });

  // Skip if pull request is from a bot
  if (payload.pull_request.user.type === "Bot") {
    log("INFO", "Skipping bot pull request", repoInfo);
    return;
  }

  // Skip if pull request is a draft
  if (payload.pull_request.draft) {
    log("INFO", `Skipping draft PR analysis`, repoInfo);
    return;
  }

  let checkRunId: number | null = null;
  const violations: string[] = [];

  try {
    // Create check run at the start
    checkRunId = await createCheckRun(octokit, owner, repo, headSha, prNumber);
    log("INFO", `Created check run ${checkRunId}`, repoInfo);

    // Load contributing guidelines
    const contributingContent = await loadContributingGuidelines(
      octokit,
      owner,
      repo
    );

    if (contributingContent) {
      if (containsAsideKeyword(prBody)) {
        log("INFO", `Skipping PR analysis due to "aside" keyword`, repoInfo);
        await updateCheckRun(octokit, owner, repo, checkRunId, "success", []);
        return;
      }

      const commentThreadContext = await fetchCommentThread(
        octokit,
        owner,
        repo,
        prNumber
      );

      // Generate response using Claude to check against guidelines
      const response = await generateFriendlyResponse(
        contributingContent,
        prBody,
        "pull request",
        repoInfo,
        commentThreadContext
      );

      // Track PR description violations
      if (response.comment_needed) {
        violations.push(`PR Description: ${response.reasoning}`);
        
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
        
        try {
          await octokit.request(
            "POST /repos/{owner}/{repo}/issues/{issue_number}/assignees",
            {
              owner: owner,
              repo: repo,
              issue_number: prNumber,
              assignees: [payload.pull_request.user.login],
            }
          );
          
          log("INFO", `PR assigned back to creator for addressing violations`, { 
            ...repoInfo, 
            assignee: payload.pull_request.user.login 
          });
        } catch (assignmentError: any) {
          log("ERROR", `Failed to assign PR back to creator`, {
            error: assignmentError.message,
            assignee: payload.pull_request.user.login,
            ...repoInfo,
          });
        }
      } else {
        log(
          "INFO",
          `No clear violations found, skipping comment for PR`,
          { ...repoInfo, reasoning: response.reasoning }
        );
      }
    }

    // Handle code review and track violations
    const codeViolations = await handlePullRequestCodeReviewWithViolations({ 
      octokit, 
      payload, 
      loadContributingGuidelines, 
      anthropic, 
      config 
    });
    
    violations.push(...codeViolations);

    // Update check run based on violations
    const hasViolations = violations.length > 0;
    await updateCheckRun(
      octokit, 
      owner, 
      repo, 
      checkRunId, 
      hasViolations ? "failure" : "success", 
      violations
    );

    // Post summary comment if there are violations
    if (hasViolations) {
      const summaryComment = `## 🚫 Contributing Guidelines Violations

The following issues were found in your PR:

${violations.map(v => `• ${v}`).join('\n')}

**To rerun this check:** Leave a new comment mentioning @jacquez and ask it to review your changes again.

Please address these issues and update your PR. The check will automatically re-run when you push new commits.`;

      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: owner,
          repo: repo,
          issue_number: prNumber,
          body: summaryComment,
        }
      );

      log("INFO", `Posted summary comment for ${violations.length} violations`, repoInfo);
    }

  } catch (error: any) {
    log("ERROR", `Error handling pull request opened event`, {
      error: error.message,
      stack: error.stack,
      ...repoInfo,
    });

    if (checkRunId) {
      try {
        await updateCheckRun(octokit, owner, repo, checkRunId, "failure", ["Internal error during review"]);
      } catch (updateError: any) {
        log("ERROR", `Failed to update check run after error`, { updateError: updateError.message, ...repoInfo });
      }
    }
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

  // Skip if issue is from a bot
  if (payload.issue.user.type === "Bot") {
    log("INFO", "Skipping bot issue", repoInfo);
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
      if (containsAsideKeyword(issueBody)) {
        log("INFO", `Skipping issue analysis due to "aside" keyword`, repoInfo);
        return;
      }

      const commentThreadContext = await fetchCommentThread(
        octokit,
        owner,
        repo,
        issueNumber
      );

      // Generate response using Claude to check against guidelines
      const response = await generateFriendlyResponse(
        contributingContent,
        issueBody,
        "issue",
        repoInfo,
        commentThreadContext
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

        const commentThreadContext = await fetchCommentThread(
          octokit,
          owner,
          repo,
          issueNumber
        );

        // Generate response using Claude to check against guidelines
        const response = await generateFriendlyResponse(
          contributingContent,
          commentBody,
          "comment",
          repoInfo,
          commentThreadContext
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
// app.webhooks.on("issues.opened", handleIssueOpened);
// app.webhooks.on("issue_comment.created", handleIssueCommentCreated);

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
