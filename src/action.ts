#!/usr/bin/env node

import * as core from '@actions/core'
import * as github from '@actions/github'
import { Octokit } from 'octokit'
import Anthropic from '@anthropic-ai/sdk'
import { loadContributingGuidelines } from './lib/contributing'
import { analyzePullRequest } from './lib/pr-analyzer'
import { createCheckRun } from './lib/check-run'

interface ActionConfig {
  githubToken: string
  anthropicApiKey: string
  aiModel: string
  maxTokens: number
  enableDetailedLogging: boolean
  failOnViolations: boolean
  skipDrafts: boolean
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

function getConfig(): ActionConfig {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    anthropicApiKey: core.getInput('anthropic-api-key', { required: true }),
    aiModel: core.getInput('ai-model') || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(core.getInput('max-tokens') || '300'),
    enableDetailedLogging: core.getInput('enable-detailed-logging') === 'true',
    failOnViolations: core.getInput('fail-on-violations') === 'true',
    skipDrafts: core.getInput('skip-drafts') === 'true',
  }
}

function log(level: string, message: string, data?: any) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ${level}: ${message}`
  
  if (data) {
    console.log(`${logMessage}\n${JSON.stringify(data, null, 2)}`)
  } else {
    console.log(logMessage)
  }

  switch (level) {
    case 'ERROR':
      core.error(message)
      break
    case 'WARN':
      core.warning(message)
      break
    case 'INFO':
      core.info(message)
      break
    default:
      core.debug(message)
  }
}

async function run(): Promise<void> {
  try {
    const config = getConfig()
    const context = github.context

    log('INFO', 'Starting Jacquez PR analysis', {
      repo: context.repo,
      pr: context.payload.pull_request?.number,
      action: context.eventName
    })

    if (!context.payload.pull_request) {
      core.setFailed('This action can only be run on pull_request events')
      return
    }

    const pr = context.payload.pull_request
    const { owner, repo } = context.repo

    if (config.skipDrafts && pr.draft) {
      log('INFO', 'Skipping draft PR analysis')
      core.setOutput('violations-found', 'false')
      core.setOutput('violation-count', '0')
      core.setOutput('analysis-summary', 'Skipped: Draft PR')
      return
    }

    if (pr.user.type === 'Bot') {
      log('INFO', 'Skipping bot PR analysis')
      core.setOutput('violations-found', 'false')
      core.setOutput('violation-count', '0')
      core.setOutput('analysis-summary', 'Skipped: Bot PR')
      return
    }

    const octokit = new Octokit({ auth: config.githubToken })
    const anthropic = new Anthropic({ apiKey: config.anthropicApiKey })

    const contributingContent = await loadContributingGuidelines(octokit, owner, repo)
    
    if (!contributingContent) {
      log('WARN', 'No contributing guidelines found, skipping analysis')
      core.setOutput('violations-found', 'false')
      core.setOutput('violation-count', '0')
      core.setOutput('analysis-summary', 'Skipped: No contributing guidelines found')
      return
    }

    const analysisResult: AnalysisResult = await analyzePullRequest({
      octokit,
      anthropic,
      owner,
      repo,
      prNumber: pr.number,
      prBody: pr.body || '',
      contributingContent,
      config
    })

    await createCheckRun({
      octokit,
      owner,
      repo,
      headSha: pr.head.sha,
      analysisResult
    })

    core.setOutput('violations-found', analysisResult.violationsFound.toString())
    core.setOutput('violation-count', analysisResult.violationCount.toString())
    core.setOutput('analysis-summary', analysisResult.summary)

    if (analysisResult.violationsFound && config.failOnViolations) {
      core.setFailed(
        `Found ${analysisResult.violationCount} contributing guideline violation(s). ` +
        `See the check run for details.`
      )
    } else if (analysisResult.violationsFound) {
      core.warning(
        `Found ${analysisResult.violationCount} contributing guideline violation(s), ` +
        `but not failing due to configuration.`
      )
    } else {
      log('INFO', 'No violations found, PR follows contributing guidelines!')
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined
    
    log('ERROR', 'Action failed', { error: errorMessage, stack: errorStack })
    core.setFailed(`Action failed: ${errorMessage}`)
  }
}

run()
