// SPDX-License-Identifier: MIT
// Copyright (c) 2018-present Raman Marozau

export type {
  PrMode,
  PR_Options,
  PR_Result,
  Branch_Protection_Rule,
  SCM_Provider,
  SCM_ProviderConfig,
} from './scm.provider';

export { createSCMRegistry } from './scm.registry';
export type { ProviderFactory, SCM_Registry } from './scm.registry';

export { resolveAuth, maskToken } from './auth.resolver';
export type { AuthResolverDeps, AuthResult } from './auth.resolver';

export { createHttpClient } from './http.client';
export type { FetchFn, HttpClientOpts, HttpResponse, HttpClient } from './http.client';

export { createUrlParser } from './url.parser';
export type {
  ParsedGitHubUrl,
  ParsedGitLabUrl,
  ParsedBitbucketCloudUrl,
  ParsedBitbucketServerUrl,
  ParsedAzureDevOpsUrl,
  ParsedUrl,
  UrlParser,
} from './url.parser';

export { createPR } from './pr.creator';
export type { PrCreatorDeps } from './pr.creator';

export {
  parseTemplate,
  formatTemplate,
  renderTemplate,
  TEMPLATE_VARIABLES,
  INVALID_BRANCH_CHARS,
} from './template.renderer';
export type { TemplatePart, TemplateContext } from './template.renderer';

export {
  createAzureDevOpsProvider,
  createBitbucketCloudProvider,
  createBitbucketServerProvider,
  createGitHubProvider,
  createGitLabProvider,
} from './providers';
