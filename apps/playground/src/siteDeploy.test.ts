import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

// injoffice.com deploys itself from main. These are the properties that make that safe: the
// tested commit is what ships, nothing is ever deleted, the stack change may only move the
// release, and only this repository's `site` environment can assume the deploy role.
describe('injoffice.com automatic deploy', () => {
  it('publishes the tested commit, only from the site environment', () => {
    const workflow = read('.github/workflows/site-deploy.yml')
    expect(workflow).toContain('workflows: [Test]')
    // It checks out main itself, never an event-supplied ref, and deploys only the tested tip.
    expect(workflow).not.toMatch(/ref: \$\{\{ github\.event/)
    expect(workflow).toContain('[ "$(git rev-parse HEAD)" != "$TESTED_SHA" ]')
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain('npm run build -w apps/playground -- --base=/')
    expect(workflow).toMatch(/environment:\n\s+name: site/)
    expect(workflow).toContain('cancel-in-progress: false')
    // The build job holds no OIDC permission; only the deploy job can ask for AWS credentials.
    expect(workflow.slice(0, workflow.indexOf('  deploy:'))).not.toContain('id-token: write')
  })

  it('never deletes, publishes index.html last, and executes only a release-only change set', () => {
    const script = read('scripts/deploy-site.sh')
    expect(script).not.toMatch(/--delete|\brm\b|s3 rm|delete-object/)
    expect(script).not.toContain('s3 sync')
    expect(script.lastIndexOf('/index.html"')).toBeGreaterThan(script.indexOf("--exclude index.html"))
    expect(script).toContain("public,max-age=31536000,immutable")
    expect(script).toContain('--content-type application/wasm')
    expect(script).toContain("printf 'Modify\\tDistribution\\tFalse'")
    expect(script).toContain('--use-previous-template')
  })

  it('scopes the deploy role to one environment and grants no delete', () => {
    const role = read('infra/site-deploy-role.yaml')
    expect(role).toContain("token.actions.githubusercontent.com:sub: !Sub 'repo:${GitHubRepository}:environment:${GitHubEnvironment}'")
    expect(role).toContain('token.actions.githubusercontent.com:aud: sts.amazonaws.com')
    for (const action of ['s3:DeleteObject', 's3:PutBucketPolicy', 'cloudformation:UpdateStack', 'cloudformation:DeleteStack', 'route53:', 'iam:PassRole', 'iam:Create']) {
      expect(role).not.toContain(action)
    }
    expect(role).not.toMatch(/Action:\s*['"]?\*/)
    // The one stack action that deletes anything only discards an unexecuted change set.
    expect(role.match(/\w+:Delete\w+/g)).toEqual(['cloudformation:DeleteChangeSet'])
  })
})
