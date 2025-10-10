# Contributing to Jacquez

Thanks for your interest in contributing! For setup instructions, please refer to our [README](README.md).

For general Antiwork contributing guidelines including AI disclosure requirements, please see the [main Antiwork Contributing Guidelines](https://github.com/antiwork/.github/blob/main/CONTRIBUTING.md).

## Issue Requirements

All issues must include both a **"what"** and a **"why"** section:

- **What**: Clearly describe what you want to happen, what's broken, or what feature you're requesting
- **Why**: Explain the reasoning, business case, or problem this solves

Example:
```markdown
## What
Add validation to ensure pull requests have linked issues before allowing merge.

## Why
Currently PRs can be merged without addressing any tracked work, making it difficult to maintain project roadmap and ensure all changes are properly documented and reviewed.
```

## Pull Request Requirements

All pull requests must meet these requirements:

1. **Include visual documentation**: For any UI changes or new features, provide:
   - **Before screenshots/video**: Show the current state
   - **After screenshots/video**: Show your changes
2. **Test suite must pass**: All tests must pass before merge
   - If CI fails due to missing keys or environment issues, run tests locally and include a screenshot of the **complete test suite passing** in your PR description
