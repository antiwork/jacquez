import Anthropic from "@anthropic-ai/sdk";

export async function createCheckRun(
  octokit: any,
  owner: string,
  repo: string,
  headSha: string,
  prNumber: number
): Promise<number> {
  try {
    const response = await octokit.request(
      "POST /repos/{owner}/{repo}/check-runs",
      {
        owner,
        repo,
        name: "Jacquez Guidelines Review",
        head_sha: headSha,
        status: "in_progress",
        details_url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        output: {
          title: "Reviewing contributing guidelines compliance",
          summary: "Jacquez is analyzing your PR against the repository's contributing guidelines..."
        }
      }
    );
    return response.data.id;
  } catch (error: any) {
    console.error("Error creating check run", { error: error.message, owner, repo, headSha });
    throw error;
  }
}

export async function updateCheckRun(
  octokit: any,
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: "success" | "failure",
  violations: string[]
): Promise<void> {
  try {
    const isSuccess = conclusion === "success";
    await octokit.request(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
      {
        owner,
        repo,
        check_run_id: checkRunId,
        status: "completed",
        conclusion,
        output: {
          title: isSuccess ? "✅ No guideline violations found" : "❌ Contributing guidelines violations detected",
          summary: isSuccess 
            ? "Your PR follows all contributing guidelines. Great work!" 
            : `Found ${violations.length} guideline violation${violations.length > 1 ? 's' : ''}. Please address the issues below.`,
          text: isSuccess ? "" : violations.map(v => `• ${v}`).join('\n')
        }
      }
    );
  } catch (error: any) {
    console.error("Error updating check run", { error: error.message, owner, repo, checkRunId });
    throw error;
  }
}

export async function fetchPRFiles(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number
): Promise<any[]> {
  try {
    console.log(`Fetching PR files for ${owner}/${repo}#${prNumber}`);
    
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
  } catch (error: any) {
    console.error(`Error fetching PR files for ${owner}/${repo}#${prNumber}`, {
      error: error.message,
    });
    return [];
  }
}

export function parseDiffForChangedLines(patch: string): Array<{line: string, position: number, lineNumber: number}> {
  if (!patch) return [];
  
  const lines = patch.split('\n');
  const changedLines: Array<{line: string, position: number, lineNumber: number}> = [];
  let position = 0;
  let lineNumber = 0;
  
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      if (match) {
        lineNumber = parseInt(match[1]) - 1;
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      lineNumber++;
      changedLines.push({
        line: line.substring(1),
        position: position,
        lineNumber: lineNumber
      });
    } else if (line.startsWith(' ')) {
      lineNumber++;
    }
    position++;
  }
  
  return changedLines;
}

export async function generateCodeAnalysisResponse(
  contributingContent: string,
  fileName: string,
  changedLines: Array<{line: string, position: number, lineNumber: number}>,
  repoInfo: any = null,
  anthropic: any,
  config: any
): Promise<Array<{position: number, comment: string}>> {
  try {
    console.log(`Generating code analysis for ${fileName}`);

    const codeContext = changedLines
      .map(cl => `Line ${cl.lineNumber}: ${cl.line}`)
      .join('\n');

    const systemPrompt = `You are a GitHub bot that reviews code changes against contributing guidelines. Analyze the provided code changes and identify specific lines that violate the contributing guidelines.

For each violation, provide:
- The exact position in the diff where the violation occurs
- A brief, actionable comment (1-2 sentences max)

Only comment on clear, specific violations. Do not comment on:
- Minor style issues
- Subjective preferences
- Code that mostly follows guidelines

Response format (JSON array):
[
  {
    "position": number,
    "comment": "Brief explanation of the violation and how to fix it"
  }
]

If no violations are found, return an empty array: []`;

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
            text: `File: ${fileName}
            
Code changes:
${codeContext}`,
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
  } catch (error: any) {
    console.error(`Error generating code analysis for ${fileName}`, {
      error: error.message,
      repoInfo,
    });
    return [];
  }
}

export async function handlePullRequestCodeReview({ 
  octokit, 
  payload, 
  loadContributingGuidelines, 
  anthropic, 
  config 
}: any) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const repoInfo = { owner, repo, prNumber };

  console.log(`Analyzing PR code for review`, {
    url: payload.pull_request.html_url,
    author: payload.pull_request.user.login,
    ...repoInfo,
  });

  if (payload.pull_request.user.type === "Bot") {
    console.log("Skipping bot pull request code review", repoInfo);
    return;
  }

  if (payload.pull_request.draft) {
    console.log(`Skipping draft PR code review`, repoInfo);
    return;
  }

  try {
    const contributingContent = await loadContributingGuidelines(
      octokit,
      owner,
      repo
    );

    if (!contributingContent) {
      console.log("No contributing guidelines found, skipping code review", repoInfo);
      return;
    }

    const prFiles = await fetchPRFiles(octokit, owner, repo, prNumber);
    const reviewComments: Array<{path: string, position: number, body: string}> = [];

    for (const file of prFiles) {
      if (!file.patch) continue;
      
      const changedLines = parseDiffForChangedLines(file.patch);
      if (changedLines.length === 0) continue;

      const codeAnalysis = await generateCodeAnalysisResponse(
        contributingContent,
        file.filename,
        changedLines,
        repoInfo,
        anthropic,
        config
      );

      for (const analysis of codeAnalysis) {
        if (analysis.position !== undefined && analysis.comment) {
          reviewComments.push({
            path: file.filename,
            position: analysis.position,
            body: analysis.comment
          });
        }
      }
    }

    if (reviewComments.length > 0) {
      await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        {
          owner,
          repo,
          pull_number: prNumber,
          event: "COMMENT",
          comments: reviewComments,
        }
      );

      console.log(`Posted code review with ${reviewComments.length} line-specific comments`, repoInfo);
    } else {
      console.log("No code violations found, skipping review", repoInfo);
    }
  } catch (error: any) {
    console.error(`Error handling PR code review`, {
      error: error.message,
      stack: error.stack,
      ...repoInfo,
    });
  }
}

export async function handlePullRequestCodeReviewWithViolations({ 
  octokit, 
  payload, 
  loadContributingGuidelines, 
  anthropic, 
  config 
}: any): Promise<string[]> {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const repoInfo = { owner, repo, prNumber };
  const violations: string[] = [];

  console.log(`Analyzing PR code for review`, {
    url: payload.pull_request.html_url,
    author: payload.pull_request.user.login,
    ...repoInfo,
  });

  if (payload.pull_request.user.type === "Bot") {
    console.log("Skipping bot pull request code review", repoInfo);
    return violations;
  }

  if (payload.pull_request.draft) {
    console.log(`Skipping draft PR code review`, repoInfo);
    return violations;
  }

  try {
    const contributingContent = await loadContributingGuidelines(
      octokit,
      owner,
      repo
    );

    if (!contributingContent) {
      console.log("No contributing guidelines found, skipping code review", repoInfo);
      return violations;
    }

    const prFiles = await fetchPRFiles(octokit, owner, repo, prNumber);
    const reviewComments: Array<{path: string, position: number, body: string}> = [];

    for (const file of prFiles) {
      if (!file.patch) continue;
      
      const changedLines = parseDiffForChangedLines(file.patch);
      if (changedLines.length === 0) continue;

      const codeAnalysis = await generateCodeAnalysisResponse(
        contributingContent,
        file.filename,
        changedLines,
        repoInfo,
        anthropic,
        config
      );

      for (const analysis of codeAnalysis) {
        if (analysis.position !== undefined && analysis.comment) {
          reviewComments.push({
            path: file.filename,
            position: analysis.position,
            body: analysis.comment
          });
          violations.push(`${file.filename}: ${analysis.comment}`);
        }
      }
    }

    if (reviewComments.length > 0) {
      await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        {
          owner,
          repo,
          pull_number: prNumber,
          event: "COMMENT",
          comments: reviewComments,
        }
      );

      console.log(`Posted code review with ${reviewComments.length} line-specific comments`, repoInfo);
    } else {
      console.log("No code violations found, skipping review", repoInfo);
    }

    return violations;
  } catch (error: any) {
    console.error(`Error handling PR code review`, {
      error: error.message,
      stack: error.stack,
      ...repoInfo,
    });
    return violations;
  }
}
