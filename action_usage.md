# Using Jacquez as a GitHub Action

Jacquez can now be used as a GitHub Action that runs on Pull Requests to enforce contributing guidelines. This provides a more integrated experience with red/green build status instead of just comments.

## Quick Setup

Add this workflow to your repository at `.github/workflows/jacquez.yml`:

```yaml
name: Contributing Guidelines Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  jacquez-check:
    name: Check Contributing Guidelines
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run Jacquez Contributing Guidelines Check
        uses: antiwork/jacquez@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          fail-on-violations: true
          skip-drafts: true
```

## Required Setup

1. **Anthropic API Key**: Add `ANTHROPIC_API_KEY` to your repository secrets
2. **Contributing Guidelines**: Ensure you have a `CONTRIBUTING.md` file in your repository root, `.github/`, or `docs/` directory

## Configuration Options

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `github-token` | GitHub token for API access | `${{ github.token }}` | Yes |
| `anthropic-api-key` | Anthropic API key for AI analysis | - | Yes |
| `ai-model` | AI model to use | `claude-sonnet-4-20250514` | No |
| `max-tokens` | Maximum tokens for AI response | `300` | No |
| `fail-on-violations` | Fail the action when violations found | `true` | No |
| `skip-drafts` | Skip analysis for draft PRs | `true` | No |
| `enable-detailed-logging` | Enable detailed logging | `false` | No |

## Outputs

| Output | Description |
|--------|-------------|
| `violations-found` | Whether any violations were found (true/false) |
| `violation-count` | Number of violations found |
| `analysis-summary` | Summary of the analysis results |

## How It Works

1. **PR Analysis**: When a PR is opened or updated, Jacquez analyzes:
   - PR description against contributing guidelines
   - Code changes for guideline violations

2. **Check Run**: Creates a GitHub check run with:
   - Success status if no violations found
   - Failure status if violations found
   - Detailed annotations on specific lines
   - Summary with actionable feedback

3. **Build Status**: The action will:
   - Pass (green) if no violations found
   - Fail (red) if violations found (when `fail-on-violations: true`)
   - Show as warning if violations found but not failing

## Benefits Over Webhook Mode

- **Integrated Build Status**: Shows red/green status in PR checks
- **Less Notification Noise**: No additional comments, just check results
- **Inline Annotations**: Code violations highlighted directly on changed lines

## Example Output

When violations are found, you'll see:
- Failed check run with detailed summary
- Inline annotations on problematic code lines
- Clear actionable feedback for fixes

When no violations are found:
- Successful check run
- Clean PR status indicating compliance

## Migration from Webhook Mode

If you're currently using Jacquez as a webhook/app, you can:

1. **Run Both**: Keep the webhook for comments and add the action for build status
2. **Action Only**: Use just the action for a cleaner experience
3. **Hybrid**: Use action for PRs and webhook for issues

The action provides the same AI-powered analysis as the webhook but integrates better with GitHub's PR workflow.
