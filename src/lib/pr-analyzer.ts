import { Octokit } from 'octokit'
import Anthropic from '@anthropic-ai/sdk'
import { parseAIResponse } from './json-parser'

interface PRAnalysisConfig {
  aiModel: string
  maxTokens: number
  enableDetailedLogging: boolean
}

interface PRAnalysisParams {
  octokit: Octokit
  anthropic: Anthropic
  owner: string
  repo: string
  prNumber: number
  prBody: string
  contributingContent: string
  config: PRAnalysisConfig
}

interface AnalysisResult {
  violationsFound: boolean
  violationCount: number
  summary: string
  details: Array<{
    file: string
    line: number
    message: string
    severity: 'error' | 'warning'
  }>
}

export async function analyzePullRequest(params: PRAnalysisParams): Promise<AnalysisResult> {
  const { octokit, anthropic, owner, repo, prNumber, prBody, contributingContent, config } = params

  const result: AnalysisResult = {
    violationsFound: false,
    violationCount: 0,
    summary: '',
    details: []
  }

  try {
    const descriptionAnalysis = await analyzePRDescription({
      prBody,
      contributingContent,
      anthropic,
      config
    })

    if (descriptionAnalysis.comment_needed) {
      result.violationsFound = true
      result.violationCount++
      result.details.push({
        file: 'PR Description',
        line: 0,
        message: descriptionAnalysis.comment,
        severity: 'error'
      })
    }

    const codeAnalysis = await analyzePRCode({
      octokit,
      owner,
      repo,
      prNumber,
      contributingContent,
      anthropic,
      config
    })

    result.violationCount += codeAnalysis.violationCount
    if (codeAnalysis.violationCount > 0) {
      result.violationsFound = true
      result.details.push(...codeAnalysis.details)
    }

    if (result.violationsFound) {
      result.summary = `Found ${result.violationCount} violation(s) in this PR`
    } else {
      result.summary = 'No contributing guideline violations found'
    }

    return result

  } catch (error: any) {
    console.error('Error analyzing pull request:', error.message)
    result.summary = 'Error occurred during analysis'
    return result
  }
}

async function analyzePRDescription({
  prBody,
  contributingContent,
  anthropic,
  config
}: {
  prBody: string
  contributingContent: string
  anthropic: Anthropic
  config: PRAnalysisConfig
}): Promise<{ comment_needed: boolean; comment: string; reasoning: string }> {
  
  if (!prBody.trim()) {
    return {
      comment_needed: true,
      comment: 'This PR is missing a description. Please add a description explaining what changes were made and why.',
      reasoning: 'Empty PR description'
    }
  }

  if (prBody.toLowerCase().includes('aside')) {
    return {
      comment_needed: false,
      comment: '',
      reasoning: 'Skipped due to aside keyword'
    }
  }

  try {
    const systemPrompt = `You are a GitHub bot that enforces contributing guidelines. Only comment when there are clear, specific violations of the contributing guidelines.

DO NOT comment for:
- Minor style, grammar, or formatting issues
- Casual but professional language
- Submissions that mostly follow guidelines

Response format (JSON):
- comment_needed: boolean (true only for clear violations)
- comment: string (1-2 sentences max, direct and actionable)
- reasoning: string (brief explanation)

If commenting, be direct and specific about what's missing without patronizing language.`

    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Contributing guidelines:\n${contributingContent}`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `Submission type: pull request
Submission content:
${prBody}`,
          },
        ],
      },
      {
        role: 'assistant',
        content: '{',
      },
    ]

    const response = await anthropic.messages.create({
      model: config.aiModel,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: messages,
    })

    const aiResponse = response.content[0].type === 'text' ? response.content[0].text : ''
    return parseAIResponse(aiResponse)

  } catch (error: any) {
    console.error('Error analyzing PR description:', error.message)
    return {
      comment_needed: false,
      comment: '',
      reasoning: 'Error occurred during AI analysis'
    }
  }
}

async function analyzePRCode({
  octokit,
  owner,
  repo,
  prNumber,
  contributingContent,
  anthropic,
  config
}: {
  octokit: Octokit
  owner: string
  repo: string
  prNumber: number
  contributingContent: string
  anthropic: Anthropic
  config: PRAnalysisConfig
}): Promise<{ violationCount: number; details: Array<{ file: string; line: number; message: string; severity: 'error' | 'warning' }> }> {
  
  const result = {
    violationCount: 0,
    details: [] as Array<{ file: string; line: number; message: string; severity: 'error' | 'warning' }>
  }

  try {
    const filesResponse = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
      {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100
      }
    )

    for (const file of filesResponse.data) {
      if (!file.patch) continue

      const changedLines = parseDiffForChangedLines(file.patch)
      if (changedLines.length === 0) continue

      const fileAnalysis = await analyzeFileChanges({
        filename: file.filename,
        changedLines,
        contributingContent,
        anthropic,
        config
      })

      for (const violation of fileAnalysis) {
        if (violation.comment && violation.position !== undefined) {
          result.violationCount++
          result.details.push({
            file: file.filename,
            line: violation.lineNumber || violation.position,
            message: violation.comment,
            severity: 'error'
          })
        }
      }
    }

  } catch (error: any) {
    console.error('Error analyzing PR code:', error.message)
  }

  return result
}

function parseDiffForChangedLines(patch: string): Array<{ line: string; position: number; lineNumber: number }> {
  const lines = patch.split('\n')
  const changedLines: Array<{ line: string; position: number; lineNumber: number }> = []
  
  let position = 0
  let newLineNumber = 0
  
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        newLineNumber = parseInt(match[1]) - 1
      }
      continue
    }
    
    position++
    
    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineNumber++
      changedLines.push({
        line: line.substring(1),
        position,
        lineNumber: newLineNumber
      })
    } else if (!line.startsWith('-')) {
      newLineNumber++
    }
  }
  
  return changedLines
}

async function analyzeFileChanges({
  filename,
  changedLines,
  contributingContent,
  anthropic,
  config
}: {
  filename: string
  changedLines: Array<{ line: string; position: number; lineNumber: number }>
  contributingContent: string
  anthropic: Anthropic
  config: PRAnalysisConfig
}): Promise<Array<{ position?: number; lineNumber?: number; comment?: string }>> {
  
  if (changedLines.length === 0) {
    return []
  }

  try {
    const systemPrompt = `You are a code reviewer that enforces contributing guidelines. Analyze the changed code lines and identify violations of the contributing guidelines.

Only flag clear violations such as:
- Missing required documentation
- Violating naming conventions
- Missing tests when required
- Security issues mentioned in guidelines
- Code style violations explicitly mentioned in guidelines

Return a JSON array where each element has:
- position: number (the diff position for inline comments)
- comment: string (brief explanation of the violation)

If no violations found, return an empty array.`

    const codeContent = changedLines
      .map(line => `Line ${line.lineNumber}: ${line.line}`)
      .join('\n')

    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Contributing guidelines:\n${contributingContent}`,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `File: ${filename}
Changed lines:
${codeContent}`,
          },
        ],
      },
      {
        role: 'assistant',
        content: '[',
      },
    ]

    const response = await anthropic.messages.create({
      model: config.aiModel,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: messages,
    })

    const aiResponse = response.content[0].type === 'text' ? response.content[0].text : ''
    
    try {
      const fullResponse = `[${aiResponse}`
      const violations = JSON.parse(fullResponse)
      
      return violations.map((violation: any) => ({
        position: changedLines[violation.position]?.position,
        lineNumber: changedLines[violation.position]?.lineNumber,
        comment: violation.comment
      })).filter((v: any) => v.position !== undefined)
      
    } catch (parseError) {
      console.error('Error parsing AI response for file analysis:', parseError)
      return []
    }

  } catch (error: any) {
    console.error(`Error analyzing file ${filename}:`, error.message)
    return []
  }
}
