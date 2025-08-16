import { Octokit } from 'octokit'

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

interface CheckRunParams {
  octokit: Octokit
  owner: string
  repo: string
  headSha: string
  analysisResult: AnalysisResult
}

export async function createCheckRun({
  octokit,
  owner,
  repo,
  headSha,
  analysisResult
}: CheckRunParams): Promise<void> {
  try {
    const checkName = 'Jacquez - Contributing Guidelines'
    const conclusion = analysisResult.violationsFound ? 'failure' : 'success'
    const title = analysisResult.violationsFound 
      ? `${analysisResult.violationCount} violation(s) found`
      : 'No violations found'

    let summary = `## ${analysisResult.summary}\n\n`
    
    if (analysisResult.violationsFound) {
      summary += `Found ${analysisResult.violationCount} contributing guideline violation(s):\n\n`
      
      const violationsByFile = analysisResult.details.reduce((acc, detail) => {
        if (!acc[detail.file]) {
          acc[detail.file] = []
        }
        acc[detail.file].push(detail)
        return acc
      }, {} as Record<string, typeof analysisResult.details>)

      for (const [file, violations] of Object.entries(violationsByFile)) {
        summary += `### ${file}\n\n`
        violations.forEach((violation, index) => {
          const icon = violation.severity === 'error' ? '❌' : '⚠️'
          const lineInfo = violation.line > 0 ? `Line ${violation.line}` : ''
          summary += `${icon} **${lineInfo}**: ${violation.message}\n\n`
        })
      }

      summary += `\n---\n\n`
      summary += `Please review the violations above and update your PR to follow the contributing guidelines.`
    } else {
      summary += `✅ This PR follows all contributing guidelines. Great work!`
    }

    const annotations = analysisResult.details
      .filter(detail => detail.line > 0 && detail.file !== 'PR Description')
      .map(detail => ({
        path: detail.file,
        start_line: detail.line,
        end_line: detail.line,
        annotation_level: (detail.severity === 'error' ? 'failure' : 'warning') as 'failure' | 'warning' | 'notice',
        message: detail.message,
        title: 'Contributing Guideline Violation'
      }))

    await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
      owner,
      repo,
      name: checkName,
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title,
        summary,
        annotations: annotations.slice(0, 50) 
      }
    })

    console.log(`Check run created: ${conclusion} with ${annotations.length} annotations`)

  } catch (error: any) {
    console.error('Error creating check run:', error.message)
    throw error
  }
}
