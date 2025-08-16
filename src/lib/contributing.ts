import { Octokit } from 'octokit'

const cache = new Map<string, { content: string; timestamp: number }>()
const CACHE_TIMEOUT = 300000

export async function loadContributingGuidelines(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string | null> {
  const cacheKey = `${owner}/${repo}`

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)!
    if (Date.now() - cached.timestamp < CACHE_TIMEOUT) {
      console.log(`Contributing guidelines loaded from cache for ${cacheKey}`)
      return cached.content
    } else {
      cache.delete(cacheKey) 
    }
  }

  console.log(`Loading contributing guidelines for ${cacheKey}`)

  const altPaths = [
    'CONTRIBUTING.md',
    'contributing.md',
    '.github/CONTRIBUTING.md',
    'docs/CONTRIBUTING.md',
  ]

  for (const path of altPaths) {
    try {
      const response = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner,
          repo,
          path,
        }
      )

      if (response.data && 'content' in response.data && response.data.content) {
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8')

        cache.set(cacheKey, {
          content,
          timestamp: Date.now(),
        })

        console.log(`Contributing guidelines found at ${path} for ${cacheKey}`)
        return content
      }
    } catch (error: any) {
      console.log(`Failed to load contributing guidelines from ${path}: ${error.message}`)
    }
  }

  console.log(`No contributing guidelines found for ${cacheKey}`)
  return null
}
