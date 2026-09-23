#!/usr/bin/env bash
# Publish a built apps/playground/dist to injoffice.com, following infra/README.md:
#   1. hashed assets/ to the shared assets/ prefix, immutable, never deleted;
#   2. every other file to releases/<RELEASE_ID>/, revalidated, index.html last;
#   3. a change set that moves only ReleaseId, executed once it is confirmed to touch only
#      the distribution; 4. a /* invalidation; 5. a check that the live page is this build.
# Nothing is deleted, and an already-uploaded release is reused rather than overwritten.
#
# Required: SITE_BUCKET, SITE_DISTRIBUTION, SITE_STACK, RELEASE_ID (a full 40-hex commit).
# Optional: SITE_DIST (default apps/playground/dist), SITE_URL (default https://injoffice.com),
#           AWS_REGION (default us-east-1), DRY_RUN=1 to upload nothing and change nothing.
set -euo pipefail

: "${SITE_BUCKET:?set SITE_BUCKET}" "${SITE_DISTRIBUTION:?set SITE_DISTRIBUTION}"
: "${SITE_STACK:?set SITE_STACK}" "${RELEASE_ID:?set RELEASE_ID}"
DIST=${SITE_DIST:-apps/playground/dist}
URL=${SITE_URL:-https://injoffice.com}
REGION=${AWS_REGION:-us-east-1}
PREFIX="releases/$RELEASE_ID"
DRY=()
[ "${DRY_RUN:-}" = 1 ] && DRY=(--dryrun)

log() { echo "[deploy-site] $*"; }
RUNNER_TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$RUNNER_TEMP_DIR"' EXIT

# True only for a pure release switch; the rule lives in site-release-change-set.jq.
release_only_change_set() { jq -e -f "$(dirname "$0")/site-release-change-set.jq" "$1" >/dev/null; }
fail() { echo "::error::$*" >&2; exit 1; }

[[ $RELEASE_ID =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_ID must be a full 40-character commit, got '$RELEASE_ID'"
[ -f "$DIST/index.html" ] && [ -d "$DIST/assets" ] || fail "$DIST is not a playground build (index.html and assets/ are required)"
[ -z "$(find "$DIST" -name '*.map' -print -quit)" ] || fail "$DIST contains source maps; refusing to publish them"

# aws s3 cp guesses types from the extension; these are the ones the README requires exactly.
upload() { # upload <source dir> <destination prefix> <cache-control> [extra aws s3 cp args...]
  local src=$1 dest=$2 cache=$3; shift 3
  local typed=(--exclude '*.wasm' --exclude '*.js' --exclude '*.mjs' --exclude '*.css')
  aws s3 cp "$src" "s3://$SITE_BUCKET/$dest" --recursive --only-show-errors --no-progress "${DRY[@]}" \
    --cache-control "$cache" --exclude '*' --include '*.wasm' --content-type application/wasm "$@"
  aws s3 cp "$src" "s3://$SITE_BUCKET/$dest" --recursive --only-show-errors --no-progress "${DRY[@]}" \
    --cache-control "$cache" --exclude '*' --include '*.js' --include '*.mjs' --content-type text/javascript "$@"
  aws s3 cp "$src" "s3://$SITE_BUCKET/$dest" --recursive --only-show-errors --no-progress "${DRY[@]}" \
    --cache-control "$cache" --exclude '*' --include '*.css' --content-type 'text/css; charset=utf-8' "$@"
  aws s3 cp "$src" "s3://$SITE_BUCKET/$dest" --recursive --only-show-errors --no-progress "${DRY[@]}" \
    --cache-control "$cache" "${typed[@]}" "$@"
}

if aws s3api head-object --bucket "$SITE_BUCKET" --key "$PREFIX/index.html" >/dev/null 2>&1; then
  # A rerun of the same commit. Its files are already published; overwriting them with a
  # rebuild could change bytes that open tabs or caches already hold.
  log "$PREFIX is already uploaded; reusing it"
else
  log "1/5 hashed assets -> assets/ (immutable)"
  upload "$DIST/assets" assets/ 'public,max-age=31536000,immutable'
  log "2/5 release files -> $PREFIX/ (index.html last)"
  upload "$DIST" "$PREFIX/" 'public,max-age=0,must-revalidate' --exclude 'assets/*' --exclude index.html
  aws s3 cp "$DIST/index.html" "s3://$SITE_BUCKET/$PREFIX/index.html" --only-show-errors --no-progress "${DRY[@]}" \
    --cache-control 'public,max-age=0,must-revalidate' --content-type 'text/html; charset=utf-8'
fi
if [ ${#DRY[@]} -gt 0 ]; then log "dry run: stopping before the stack change"; exit 0; fi
aws s3api head-object --bucket "$SITE_BUCKET" --key "$PREFIX/index.html" >/dev/null || fail "upload incomplete: $PREFIX/index.html is missing"

current=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$SITE_STACK" \
  --query "Stacks[0].Parameters[?ParameterKey=='ReleaseId'].ParameterValue" --output text)
if [ "$current" = "$RELEASE_ID" ]; then
  log "3/5 ReleaseId is already $RELEASE_ID"
else
  log "3/5 change set: ReleaseId $current -> $RELEASE_ID"
  cs="release-${RELEASE_ID:0:12}-$(date -u +%Y%m%d%H%M%S)"
  aws cloudformation create-change-set --region "$REGION" --stack-name "$SITE_STACK" --change-set-name "$cs" \
    --use-previous-template --capabilities CAPABILITY_IAM \
    --parameters ParameterKey=ReleaseId,ParameterValue="$RELEASE_ID" \
                 ParameterKey=DomainName,UsePreviousValue=true \
                 ParameterKey=HostedZoneId,UsePreviousValue=true \
                 ParameterKey=PublishDns,UsePreviousValue=true >/dev/null
  aws cloudformation wait change-set-create-complete --region "$REGION" --stack-name "$SITE_STACK" --change-set-name "$cs"
  # Moving ReleaseId must only modify the distribution, in place, because of ReleaseId. The
  # apex A/AAAA aliases point at the distribution's domain name, so CloudFormation lists them
  # as a runtime re-check whenever the distribution changes; that name never changes, and
  # past release switches never updated them. Anything else is refused.
  aws cloudformation describe-change-set --region "$REGION" --stack-name "$SITE_STACK" --change-set-name "$cs" \
    --query 'Changes[].ResourceChange.{Action:Action,Id:LogicalResourceId,Replacement:Replacement,Details:Details[].{Source:ChangeSource,Evaluation:Evaluation,Cause:CausingEntity,Name:Target.Name}}' \
    --output json > "$RUNNER_TEMP_DIR/change-set.json"
  log "change set: $(jq -c '[.[] | "\(.Action) \(.Id)"]' "$RUNNER_TEMP_DIR/change-set.json")"
  if ! release_only_change_set "$RUNNER_TEMP_DIR/change-set.json"; then
    aws cloudformation delete-change-set --region "$REGION" --stack-name "$SITE_STACK" --change-set-name "$cs" || true
    fail "the change set does more than move the release; deleted it without executing: $(jq -c . "$RUNNER_TEMP_DIR/change-set.json")"
  fi
  aws cloudformation execute-change-set --region "$REGION" --stack-name "$SITE_STACK" --change-set-name "$cs"
  aws cloudformation wait stack-update-complete --region "$REGION" --stack-name "$SITE_STACK"
fi

log "4/5 invalidating /*"
inv=$(aws cloudfront create-invalidation --distribution-id "$SITE_DISTRIBUTION" --paths '/*' --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed --distribution-id "$SITE_DISTRIBUTION" --id "$inv"

log "5/5 verifying $URL serves this build"
want=$(shasum -a 256 < "$DIST/index.html" | cut -d' ' -f1)
for attempt in 1 2 3 4 5 6; do
  got=$(curl -fsS "$URL/?deploy=$RELEASE_ID" | shasum -a 256 | cut -d' ' -f1) || got=''
  [ "$got" = "$want" ] && { log "live: $URL is release $RELEASE_ID"; exit 0; }
  sleep 10
done
fail "$URL does not serve the uploaded index.html (want sha256 $want, got ${got:-no response})"
