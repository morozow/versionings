# Versionings

### Overview
Implementation of [versioning automation](https://www.reddit.com/r/opensource/comments/aaewcn/versioning_automation_management_tool/).\
Versioning schema: **Semantic Versioning**

### Install
```npm install --global versionings```

### Setup
- Create ```./version.json``` file in **root** project directory.
- Set _required_ versioning configuration settings
    - ```git.platform```
        - The VCS platform. Supports: ```github```, ```bitbucket```
    - ```git.url```
        - The VCS platform repository URL.
- Set versioning configuration settings
    - ```git.pr.target```
        - The VCS Pull Request target branch: Default: ```master```
        
##### ```version.json``` example
```json
{
  "git": {
    "platform": "github",
    "url": "https://github.com/morozow/versionings.git"
  }
}
```

### Usage
#### CLI command:
```versionings --semver=[<semantic-version> | patch | prepatch | minor | preminor | premajor | prerelease | major] --branch=[<version-branch-name> | any-hyphen-case-less-100-characters-string] [--push]```

#### Parameters
- **semver**: any semantic version degree
    - major, minor, patch, premajor, preminor, prepatch, prerelease
    - ```./config.js``` contains available levels: ```config.package.semver```
- **branch**: version branch name comment
    - any hyphen case less 100 characters string
    - example: version/minor/v4.9.0-provider-service, "provider-service" is a branch name comment
- **push**: is responsible for new version repository push. Boolean parameter. 
