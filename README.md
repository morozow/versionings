# CLI Versioning

### Overview
Implementation of versioning automation.\
Versioning schema: **Semantic Versioning**

### Install
```npm install --global versionings```

#### CLI command:
```versionings --semver=[<semantic-version> | patch | minor | premajor | prerelease | major ] --branch=[<version-branch-name> | any-hyphen-case-less-100-characters-string] [--push]```

#### Parameters
- **semver**: any semantic version degree
    - major, minor, patch, premajor, preminor, prepatch, prerelease
    - ```./config.js``` contains available levels: ```config.package.semver```
- **branch**: version branch name comment
    - any hyphen case less 100 characters string
    - example: version/minor/v4.9.0-provider-service, "provider-service" is a branch name comment
- **push**: is responsible for new version repository push. Boolean parameter. 
