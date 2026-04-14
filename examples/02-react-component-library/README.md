# 02-react-component-library

React UI component library with a trunk-based workflow, conventional commits, and automatic changelog generation via versionings.

## Components

The library ships three React components:

- **Button** — supports variants (`primary`, `secondary`, `danger`), sizes (`sm`, `md`, `lg`), and a `disabled` state
- **Card** — renders a title, children content, and an optional footer
- **Modal** — overlay dialog with a close button and Escape key handling

A `classnames` utility merges strings and `{ className: boolean }` objects into a single CSS class string.

```js
const { Button, Card, Modal } = require('02-react-component-library');
```

## Branching Strategy: Trunk-Based

The project follows a **trunk-based** strategy — all commits land directly on `main`. Release versions are recorded as tags; dedicated release branches are not used.

This model suits libraries with frequent releases: every merge to `main` can automatically produce a new version based on conventional commits.

## SCM Platform: GitHub

The repository is hosted on GitHub. The CI pipeline uses GitHub Actions to trigger an automatic release on every push to `main`.

## Conventional Commits

The project uses [Conventional Commits](https://www.conventionalcommits.org/) to determine the version bump level automatically (`--semver=auto`).

### Message Format

```
<type>(<scope>): <description>

[body]

[footer]
```

### Commit Type to Bump Level Mapping

| Commit Type | Bump Level | Description                |
|-------------|------------|----------------------------|
| `feat`      | minor      | New feature                |
| `fix`       | patch      | Bug fix                    |
| `perf`      | patch      | Performance improvement    |
| `revert`    | patch      | Revert a previous change   |
| `refactor`  | patch      | Code refactoring           |
| `deps`      | patch      | Dependency update          |

If a commit type is not found in the mapping, `fallbackBump: "patch"` is applied.

### Commit Examples

```bash
git commit -m "feat(button): add ghost variant"
# → minor bump: 1.0.0 → 1.1.0

git commit -m "fix(modal): fix close on Escape"
# → patch bump: 1.1.0 → 1.1.1

git commit -m "deps: update react to 18.3.1"
# → patch bump: 1.1.1 → 1.1.2
```

## Automatic Changelog

On every release, versionings automatically updates `CHANGELOG.md`.

### Section Grouping (groupTitles)

Commits are grouped by type with custom section headings:

| Type       | Changelog Heading    |
|------------|----------------------|
| `feat`     | ✨ Features          |
| `fix`      | 🐛 Bug Fixes        |
| `perf`     | ⚡ Performance       |
| `refactor` | ♻️ Refactoring       |
| `deps`     | 📦 Dependencies      |

### Excluded Types (excludeTypes)

The following commit types are omitted from the changelog: `chore`, `ci`, `test`, `build`, `style`, `docs`.

## Auto-Bump Workflow

The `--semver=auto` flag analyzes conventional commits since the last tag and determines the bump level:

1. If at least one `feat` commit exists → **minor**
2. If `fix`, `perf`, `refactor`, `revert`, or `deps` commits exist → **patch**
3. If no conventional commits are found → `fallbackBump` is used (patch)

### Release Workflow

```bash
# 1. Validate configuration
npm run validate

# 2. Preview the plan (dry-run)
npm run plan

# 3. Execute the release and push
npm run release
```

Scripts from `package.json`:

```json
{
  "validate": "versionings validate",
  "plan": "versionings plan --semver=auto --branch=release",
  "release": "versionings release --semver=auto --branch=release --push"
}
```

## version.json Configuration

```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/your-org/02-react-component-library.git",
    "branching": {
      "strategy": "trunk-based",
      "mainBranch": "main"
    }
  },
  "conventionalCommits": {
    "enabled": true,
    "types": { ... },
    "fallbackBump": "patch"
  },
  "changelog": {
    "file": "CHANGELOG.md",
    "groupTitles": { ... },
    "excludeTypes": ["chore", "ci", "test", "build", "style", "docs"]
  }
}
```

### Field Descriptions

| Field                            | Description                                          |
|----------------------------------|------------------------------------------------------|
| `git.platform`                   | SCM platform — `github`                              |
| `git.url`                        | Repository URL                                       |
| `git.branching.strategy`         | Branching strategy — `trunk-based`                   |
| `git.branching.mainBranch`       | Primary branch — `main`                              |
| `conventionalCommits.enabled`    | Enable conventional commit analysis                  |
| `conventionalCommits.types`      | Map of commit types to version bump levels           |
| `conventionalCommits.fallbackBump` | Default bump level when the type is unrecognized   |
| `changelog.file`                 | Path to the changelog file                           |
| `changelog.groupTitles`          | Custom section headings for the changelog            |
| `changelog.excludeTypes`         | Commit types excluded from the changelog             |

## CI Pipeline: Auto-Release

A GitHub Actions workflow (`.github/workflows/release.yml`) runs an automatic release on every push to `main`:

1. **Checkout** with full history (`fetch-depth: 0`) — required for commit analysis
2. **Setup Node.js 18**
3. **Install dependencies**
4. **Validate** — verify the versionings configuration
5. **Auto Release** — `--semver=auto` determines the bump level from commits; `--ci --json` enables non-interactive mode with machine-readable output

The `GITHUB_TOKEN` is provided through the GitHub Actions secrets mechanism.

## Project Structure

```
02-react-component-library/
├── package.json              # npm package with react in dependencies
├── version.json              # versionings configuration
├── CHANGELOG.md              # Automatically updated on release
├── .gitignore
├── README.md
├── src/
│   ├── index.js              # Barrel export: { Button, Card, Modal }
│   ├── components/
│   │   ├── Button.jsx        # Button with variant, size, disabled
│   │   ├── Card.jsx          # Card with title, children, footer
│   │   └── Modal.jsx         # Modal dialog with overlay and Escape
│   └── utils/
│       └── classnames.js     # CSS class merging utility
└── .github/
    └── workflows/
        └── release.yml       # GitHub Actions auto-release
```
