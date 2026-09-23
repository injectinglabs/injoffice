import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    // The docs are published under /docs/ inside the same release.
    expect(workflow).toContain('npm run build -w apps/docs')
    expect(workflow).toContain('cp -R apps/docs/.vitepress/dist apps/playground/dist/docs')
    expect(workflow.indexOf('cp -R apps/docs/.vitepress/dist')).toBeLessThan(workflow.indexOf('name: site-dist'))
    expect(workflow).toMatch(/environment:\n\s+name: site/)
    expect(workflow).toContain('cancel-in-progress: false')
    // The build job holds no OIDC permission; only the deploy job can ask for AWS credentials.
    expect(workflow.slice(0, workflow.indexOf('  deploy:'))).not.toContain('id-token: write')
  })

  it('never deletes, publishes index.html last, and executes only a release-only change set', () => {
    const script = read('scripts/deploy-site.sh')
    // Nothing published is ever removed (the only local rm is the script's own temp directory).
    expect(script).not.toMatch(/--delete|s3 rm|s3api delete|delete-object/)
    expect(script.match(/\brm\b.*/g)).toEqual([`rm -rf "$RUNNER_TEMP_DIR"' EXIT`])
    expect(script).not.toContain('s3 sync')
    expect(script.lastIndexOf('/index.html"')).toBeGreaterThan(script.indexOf("--exclude index.html"))
    expect(script).toContain("public,max-age=31536000,immutable")
    expect(script).toContain('--content-type application/wasm')
    expect(script).toContain('release_only_change_set "$RUNNER_TEMP_DIR/change-set.json"')
    expect(script).toContain('--use-previous-template')
  })

  it('scopes the deploy role to one environment and grants no delete', () => {
    const role = read('infra/site-deploy-role.yaml')
    expect(role).toContain("token.actions.githubusercontent.com:sub: !Sub '${SubjectPrefix}:environment:${GitHubEnvironment}'")
    // The repository issues immutable subjects (owner and repository IDs), so that is the default.
    expect(role).toContain("Default: 'repo:injectinglabs@260610605/injoffice@1380539575'")
    expect(role).toContain('token.actions.githubusercontent.com:aud: sts.amazonaws.com')
    // Route 53 access is one read: CloudFormation validates the HostedZoneId parameter with it.
    expect(role.match(/route53:\w+/g)).toEqual(['route53:GetHostedZone'])
    for (const action of ['s3:DeleteObject', 's3:PutBucketPolicy', 'cloudformation:UpdateStack', 'cloudformation:DeleteStack', 'iam:PassRole', 'iam:Create']) {
      expect(role).not.toContain(action)
    }
    expect(role).not.toMatch(/Action:\s*['"]?\*/)
    // The one stack action that deletes anything only discards an unexecuted change set.
    expect(role.match(/\w+:Delete\w+/g)).toEqual(['cloudformation:DeleteChangeSet'])
  })
})

// The change-set rule, run against the change set AWS produced for a real release switch.
describe('the release-only change-set rule', () => {
  const rule = fileURLToPath(new URL('../../../scripts/site-release-change-set.jq', import.meta.url))
  const alias = (id: string) => ({ Action: 'Modify', Id: id, Replacement: 'False', Details: [
    { Source: 'ResourceAttribute', Evaluation: 'Dynamic', Cause: 'Distribution.DomainName', Name: 'AliasTarget' },
  ] })
  const release = () => [
    { Action: 'Modify', Id: 'Distribution', Replacement: 'False', Details: [
      { Source: 'ParameterReference', Evaluation: 'Static', Cause: 'ReleaseId', Name: 'DistributionConfig' },
      { Source: 'DirectModification', Evaluation: 'Dynamic', Cause: null, Name: 'DistributionConfig' },
    ] },
    alias('DomainIPv4'),
    alias('DomainIPv6'),
  ]
  const accepts = (changes: unknown) => spawnSync('jq', ['-e', '-f', rule], { input: JSON.stringify(changes) }).status === 0

  it('accepts a pure release switch, with or without the alias re-checks', () => {
    expect(accepts(release())).toBe(true)
    expect(accepts(release().slice(0, 1))).toBe(true)
  })

  it('refuses anything else', () => {
    const replaced = release(); replaced[0]!.Replacement = 'True'
    const renamed = release(); renamed[0]!.Details.push({ Source: 'ParameterReference', Evaluation: 'Static', Cause: 'DomainName', Name: 'Aliases' })
    const staticAlias = release(); staticAlias[1]!.Details[0]!.Evaluation = 'Static'
    const extra = [...release(), { Action: 'Modify', Id: 'BucketPolicy', Replacement: 'False', Details: [] }]
    const removed = [...release(), { Action: 'Remove', Id: 'Certificate', Replacement: null, Details: [] }]
    for (const changes of [replaced, renamed, staticAlias, extra, removed, release().slice(1), []]) {
      expect(accepts(changes)).toBe(false)
    }
  })
})
