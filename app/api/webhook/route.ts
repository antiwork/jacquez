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

// Helper function to fetch PR file changes
async function fetchPRFiles(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number
): Promise<any[]> {
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      {
        owner,
        repo,
        pull_number: prNumber,
      }
    );
    return response.data || [];
  } catch (error: any) {
    log("ERROR", `Failed to fetch PR files`, {
      error: error.message,
      owner,
      repo,
      prNumber,
    });
    return [];
  }
}

// Helper function to detect new controller methods in file changes
function detectNewControllerMethods(files: any[]): Array<{file: string, methods: string[]}> {
  const controllerMethods: Array<{file: string, methods: string[]}> = [];
  
  const patterns = {
    rails: {
      filePattern: /_controller\.rb$/,
      methodPattern: /^\+.*def\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
    },
    express: {
      filePattern: /\.(js|ts)$/,
      methodPattern: /^\+.*router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gm
    },
    django: {
      filePattern: /views\.py$/,
      methodPattern: /^\+.*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*request/gm
    },
    aspnet: {
      filePattern: /Controller\.cs$/,
      methodPattern: /^\+.*\[Http(Get|Post|Put|Delete|Patch)\][\s\S]*?public.*?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm
    }
  };

  for (const file of files) {
    if (file.status !== 'added' && file.status !== 'modified') continue;
    if (!file.patch) continue;

    const methods: string[] = [];
    
    for (const [framework, config] of Object.entries(patterns)) {
      if (config.filePattern.test(file.filename)) {
        let match;
        while ((match = config.methodPattern.exec(file.patch)) !== null) {
          if (framework === 'express') {
            methods.push(`${match[1].toUpperCase()} ${match[2]}`);
          } else if (framework === 'aspnet') {
            methods.push(`${match[1]} ${match[2]}`);
          } else {
            methods.push(match[1]);
          }
        }
        break;
      }
    }

    if (methods.length > 0) {
      controllerMethods.push({
        file: file.filename,
        methods
      });
    }
  }

  return controllerMethods;
}

// Helper function to check for existing specs
async function checkForSpecs(
  octokit: any,
  owner: string,
  repo: string,
  controllerFile: string,
  methods: string[]
): Promise<{existing: string[], missing: string[]}> {
  const testPaths = generateTestPaths(controllerFile);
  const existing: string[] = [];
  const missing: string[] = [...methods];

  for (const testPath of testPaths) {
    try {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner,
          repo,
          path: testPath,
        }
      );

      if (response.data.content) {
        const testContent = Buffer.from(response.data.content, "base64").toString("utf-8");
        
        for (let i = missing.length - 1; i >= 0; i--) {
          const method = missing[i];
          if (hasSpecForMethod(testContent, method, controllerFile)) {
            existing.push(method);
            missing.splice(i, 1);
          }
        }
      }
    } catch (error) {
      continue;
    }
  }

  return { existing, missing };
}

// Helper function to generate possible test file paths
function generateTestPaths(controllerFile: string): string[] {
  const paths: string[] = [];
  const baseName = controllerFile.replace(/\.(rb|js|ts|py|cs)$/, '');
  const fileName = baseName.split('/').pop() || baseName;

  if (controllerFile.endsWith('_controller.rb')) {
    const specName = fileName.replace('_controller', '_controller_spec');
    paths.push(`spec/controllers/${specName}.rb`);
    paths.push(`spec/${specName}.rb`);
    paths.push(`test/controllers/${fileName}_test.rb`);
  } else if (controllerFile.endsWith('.js') || controllerFile.endsWith('.ts')) {
    const ext = controllerFile.endsWith('.ts') ? 'ts' : 'js';
    paths.push(`${baseName}.test.${ext}`);
    paths.push(`${baseName}.spec.${ext}`);
    paths.push(`__tests__/${fileName}.test.${ext}`);
    paths.push(`test/${fileName}.test.${ext}`);
  } else if (controllerFile.endsWith('views.py')) {
    paths.push(`test_${fileName}.py`);
    paths.push(`tests/test_${fileName}.py`);
    paths.push(`${baseName}_test.py`);
  } else if (controllerFile.endsWith('Controller.cs')) {
    const testName = fileName.replace('Controller', 'ControllerTests');
    paths.push(`${baseName}Tests.cs`);
    paths.push(`Tests/${testName}.cs`);
  }

  return paths;
}

// Helper function to check if test content has spec for method
function hasSpecForMethod(testContent: string, method: string, controllerFile: string): boolean {
  const lowerContent = testContent.toLowerCase();
  const lowerMethod = method.toLowerCase();
  
  const patterns = [
    `describe.*${lowerMethod}`,
    `it.*${lowerMethod}`,
    `test.*${lowerMethod}`,
    `def.*test.*${lowerMethod}`,
    `"${lowerMethod}"`,
    `'${lowerMethod}'`,
    `\`${lowerMethod}\``,
  ];

  return patterns.some(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(lowerContent);
  });
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
  repoInfo: any = null,
  commentThreadContext: string = "",
  codebaseAnalysis: string = ""
): Promise<{ comment_needed: boolean; comment: string; reasoning: string }> {
  try {
    log("INFO", `Generating AI response for ${submissionType}`);

    const systemPrompt = `You are a GitHub bot that enforces contributing guidelines. Only comment when there are clear, specific violations that prevent proper review.

ONLY comment for these specific violations:
- Issues missing required "What" and "Why" sections
- Pull requests without "Closes #123" or "Fixes #456" references to existing issues  
- Pull requests with UI changes missing before/after screenshots/videos
- New controller methods missing required specs (when guidelines specify spec requirements)
- Submissions that are clearly incomplete or unreadable

DO NOT comment for:
- Minor style, grammar, or formatting issues
- Casual but professional language
- Single punctuation marks (?, !, etc.)
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
            }${
              codebaseAnalysis ? `\n${codebaseAnalysis}\n` : ""
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

      const commentThreadContext = await fetchCommentThread(
        octokit,
        owner,
        repo,
        prNumber
      );

      let codebaseAnalysis = "";
      
      // Check if contributing guidelines mention spec requirements
      const requiresSpecs = contributingContent.toLowerCase().includes('spec') || 
                           contributingContent.toLowerCase().includes('test');
      
      if (requiresSpecs) {
        log("INFO", `Contributing guidelines require specs, analyzing codebase`, repoInfo);
        
        const prFiles = await fetchPRFiles(octokit, owner, repo, prNumber);
        const newMethods = detectNewControllerMethods(prFiles);
        
        if (newMethods.length > 0) {
          log("INFO", `Detected ${newMethods.length} files with new controller methods`, {
            ...repoInfo,
            methods: newMethods
          });
          
          const missingSpecs = [];
          for (const {file, methods} of newMethods) {
            const specs = await checkForSpecs(octokit, owner, repo, file, methods);
            if (specs.missing.length > 0) {
              missingSpecs.push({file, methods: specs.missing});
            }
          }
          
          if (missingSpecs.length > 0) {
            codebaseAnalysis = `Codebase Analysis: New controller methods detected without corresponding specs:\n${missingSpecs.map(item => `- ${item.file}: ${item.methods.join(', ')}`).join('\n')}`;
            log("INFO", `Found controller methods missing specs`, {
              ...repoInfo,
              missingSpecs
            });
          }
        }
      }

      // Generate response using Claude to check against guidelines
      const response = await generateFriendlyResponse(
        contributingContent,
        prBody,
        "pull request",
        repoInfo,
        commentThreadContext,
        codebaseAnalysis
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
