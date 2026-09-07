import { AgentToolsError, asAgentToolsError } from './errors'
import { canonicalJson, cloneJson, freezeJson, immutableJson, jsonBytes, stableId } from './json'
import type {
  AgentAdapterCommitResult,
  AgentArtifactAdapter,
  AgentArtifactIdentity,
  AgentArtifactView,
  AgentActor,
  AgentBoundedAdapterResult,
  AgentBoundedRequest,
  AgentBoundedResult,
  AgentCapabilitiesResult,
  AgentCapability,
  AgentChangeSetEnvelope,
  AgentCommitOptions,
  AgentCommitResult,
  AgentIssue,
  AgentOperation,
  AgentOperationInput,
  AgentPlanOptions,
  AgentRestoreRequest,
  AgentSessionLimits,
  AgentValidationResult,
  AgentVerificationResult,
  CreateAgentSessionOptions,
} from './types'
import { AGENT_CHANGESET_PROTOCOL, AGENT_CHANGESET_PROTOCOL_VERSION, AGENT_TOOLS_PROTOCOL, AGENT_TOOLS_PROTOCOL_VERSION } from './types'

export const DEFAULT_AGENT_SESSION_LIMITS: Readonly<AgentSessionLimits> = Object.freeze({
  maxReadItems: 1_000,
  maxReadBytes: 1_048_576,
  maxOperations: 100,
  maxOperationBytes: 1_048_576,
})

type StoredCommit = { signature: string; promise: Promise<AgentCommitResult> }

export class AgentChangeSet<TArtifact> {
  readonly #session: AgentSession<TArtifact>
  constructor(readonly envelope: Readonly<AgentChangeSetEnvelope>, session: AgentSession<TArtifact>) { this.#session = session }

  validate(signal?: AbortSignal): Promise<AgentValidationResult> { return this.#session.validate(this, signal) }
  preview(signal?: AbortSignal): Promise<AgentArtifactView> { return this.#session.preview(this, signal) }
  diff(signal?: AbortSignal): Promise<AgentArtifactView> { return this.#session.diff(this, signal) }
  verify(signal?: AbortSignal): Promise<AgentVerificationResult> { return this.#session.verify(this, signal) }
  commit(options: AgentCommitOptions): Promise<AgentCommitResult> { return this.#session.commit(this, options) }
  toJSON(): Readonly<AgentChangeSetEnvelope> { return this.envelope }
}

export class AgentSession<TArtifact> {
  #artifact: TArtifact
  #identity: Readonly<AgentArtifactIdentity>
  readonly #commits = new Map<string, StoredCommit>()
  #mutationTail: Promise<void> = Promise.resolve()
  readonly #confirm?: CreateAgentSessionOptions<TArtifact>['confirmDestructive']

  constructor(
    artifact: TArtifact,
    identity: AgentArtifactIdentity,
    readonly actor: Readonly<AgentActor>,
    readonly adapter: AgentArtifactAdapter<TArtifact>,
    readonly limits: Readonly<AgentSessionLimits>,
    confirm?: CreateAgentSessionOptions<TArtifact>['confirmDestructive'],
  ) {
    this.#artifact = artifact
    this.#identity = immutableJson(identity, 'artifact identity')
    this.#confirm = confirm
  }

  get artifact(): TArtifact { return this.#artifact }
  get identity(): Readonly<AgentArtifactIdentity> { return this.#identity }

  async capabilities(signal?: AbortSignal): Promise<AgentCapabilitiesResult> {
    const identity = await this.#refreshIdentity(signal)
    let raw: readonly AgentCapability[]
    try { raw = await this.adapter.capabilities({ ...this.#context(identity), signal }) }
    catch (error) { throw asAgentToolsError(error) }
    const names = new Set<string>()
    const capabilities = raw.map((entry, index) => {
      const capability = immutableJson(entry, `capability ${index}`)
      if (!validName(capability.name) || !capability.description.trim()) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `Capability ${index} has an invalid name or description.`)
      if (names.has(capability.name)) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `Capability ${capability.name} is duplicated.`)
      names.add(capability.name)
      if (capability.inputSchema.type !== 'object') throw new AgentToolsError('INVALID_ADAPTER_RESULT', `Capability ${capability.name} must advertise an object inputSchema.`)
      return capability
    }).sort((left, right) => left.name.localeCompare(right.name))
    return immutableJson({ protocol: AGENT_TOOLS_PROTOCOL, protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION, identity, capabilities }, 'capabilities result')
  }

  inspect(request: AgentBoundedRequest = {}): Promise<AgentBoundedResult> { return this.#bounded('inspect', request) }
  read(request: AgentBoundedRequest = {}): Promise<AgentBoundedResult> { return this.#bounded('read', request) }

  async plan(operations: readonly AgentOperationInput[], options: AgentPlanOptions = {}): Promise<AgentChangeSet<TArtifact>> {
    abortIfNeeded(options.signal)
    if (!Array.isArray(operations) || operations.length === 0) throw new AgentToolsError('INVALID_ARGUMENT', 'A change set requires at least one operation.')
    if (operations.length > this.limits.maxOperations) throw new AgentToolsError('LIMIT_EXCEEDED', `A change set may contain at most ${this.limits.maxOperations} operations.`)
    const identity = await this.#refreshIdentity(options.signal)
    assertExpected(identity, options.expectedRevision, options.expectedFingerprint)
    const ids = new Set<string>()
    const planned: AgentOperation[] = operations.map((raw, index) => {
      const operation = cloneJson(raw, `operation ${index}`)
      if (!validName(operation.name)) throw new AgentToolsError('INVALID_ARGUMENT', `Operation ${index} has an invalid name.`)
      const operationId = operation.operationId ?? `op-${String(index + 1).padStart(4, '0')}`
      if (!validId(operationId)) throw new AgentToolsError('INVALID_ARGUMENT', `Operation ${index} has an invalid operationId.`)
      if (ids.has(operationId)) throw new AgentToolsError('INVALID_ARGUMENT', `Operation id ${operationId} is duplicated.`)
      ids.add(operationId)
      return { operationId, name: operation.name, input: operation.input }
    })
    if (jsonBytes(planned) > this.limits.maxOperationBytes) throw new AgentToolsError('LIMIT_EXCEEDED', `Change set operations exceed ${this.limits.maxOperationBytes} JSON bytes.`)
    const content = {
      artifactId: identity.artifactId,
      format: identity.format,
      baseRevision: identity.revision,
      baseFingerprint: identity.fingerprint,
      actor: this.actor,
      operations: planned,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    }
    const envelope: AgentChangeSetEnvelope = {
      protocol: AGENT_CHANGESET_PROTOCOL,
      protocolVersion: AGENT_CHANGESET_PROTOCOL_VERSION,
      changeSetId: `changeset-${stableId(content)}`,
      ...content,
    }
    return new AgentChangeSet(immutableJson(envelope, 'change set'), this)
  }

  loadChangeSet(envelope: AgentChangeSetEnvelope): AgentChangeSet<TArtifact> {
    const cloned = immutableJson(envelope, 'change set')
    if (cloned.protocol !== AGENT_CHANGESET_PROTOCOL || cloned.protocolVersion !== AGENT_CHANGESET_PROTOCOL_VERSION) throw new AgentToolsError('INVALID_ARGUMENT', 'Unsupported change set protocol or version.')
    const { changeSetId: _ignored, protocol: _protocol, protocolVersion: _protocolVersion, ...content } = cloned
    if (cloned.changeSetId !== `changeset-${stableId(content)}`) throw new AgentToolsError('INVALID_ARGUMENT', 'Change set id does not match its canonical contents.')
    if (cloned.artifactId !== this.identity.artifactId || cloned.format !== this.identity.format) throw new AgentToolsError('INVALID_ARGUMENT', 'Change set belongs to another artifact or format.')
    if (cloned.actor.id !== this.actor.id) throw new AgentToolsError('INVALID_ARGUMENT', 'Change set belongs to another actor.')
    return new AgentChangeSet(cloned, this)
  }

  async validate(changeSet: AgentChangeSet<TArtifact>, signal?: AbortSignal): Promise<AgentValidationResult> {
    const envelope = this.#owned(changeSet)
    const advertised = await this.capabilities(signal)
    const identity = advertised.identity
    const issues: AgentIssue[] = []
    if (!sameIdentity(identity, baseIdentity(envelope))) issues.push(staleIssue(envelope, identity))
    const available = new Set(advertised.capabilities.map(({ name }) => name))
    for (const operation of envelope.operations) if (!available.has(operation.name)) issues.push({ severity: 'refusal', code: 'UNSUPPORTED_OPERATION', message: `Adapter does not advertise ${operation.name}.`, operationId: operation.operationId })
    try { issues.push(...await this.adapter.validate({ ...this.#context(identity), changeSet: envelope, signal })) }
    catch (error) { throw asAgentToolsError(error) }
    const normalized = normalizeIssues(issues)
    return immutableJson({
      protocol: AGENT_TOOLS_PROTOCOL,
      protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION,
      changeSetId: envelope.changeSetId,
      valid: !normalized.some(({ severity }) => severity === 'error' || severity === 'refusal'),
      issues: normalized,
    }, 'validation result')
  }

  preview(changeSet: AgentChangeSet<TArtifact>, signal?: AbortSignal): Promise<AgentArtifactView> { return this.#view('preview', changeSet, signal) }
  diff(changeSet: AgentChangeSet<TArtifact>, signal?: AbortSignal): Promise<AgentArtifactView> { return this.#view('diff', changeSet, signal) }

  async verify(changeSet: AgentChangeSet<TArtifact>, signal?: AbortSignal): Promise<AgentVerificationResult> {
    const envelope = this.#owned(changeSet)
    const identity = await this.#requireCurrent(envelope, signal)
    let raw
    try { raw = await this.adapter.verify({ ...this.#context(identity), changeSet: envelope, stage: 'planned', signal }) }
    catch (error) { throw asAgentToolsError(error) }
    return verification(envelope.changeSetId, raw)
  }

  commit(changeSet: AgentChangeSet<TArtifact>, options: AgentCommitOptions): Promise<AgentCommitResult> {
    const envelope = this.#owned(changeSet)
    validIdempotencyKey(options.idempotencyKey)
    const signature = `commit:${envelope.changeSetId}`
    const stored = this.#commits.get(options.idempotencyKey)
    if (stored) {
      if (stored.signature !== signature) throw new AgentToolsError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another mutation.')
      return stored.promise
    }
    const promise = this.#serialize(() => this.#commit(envelope, options))
    this.#commits.set(options.idempotencyKey, { signature, promise })
    void promise.catch(() => { if (this.#commits.get(options.idempotencyKey)?.promise === promise) this.#commits.delete(options.idempotencyKey) })
    return promise
  }

  restore(request: AgentRestoreRequest): Promise<AgentCommitResult> {
    if (!this.adapter.restore) throw new AgentToolsError('RESTORE_UNSUPPORTED', `Adapter ${this.adapter.id} does not support restore.`)
    validIdempotencyKey(request.idempotencyKey)
    if (!request.versionId.trim()) throw new AgentToolsError('INVALID_ARGUMENT', 'versionId is required.')
    const signature = `restore:${request.versionId}:${request.expectedRevision}:${request.expectedFingerprint ?? ''}`
    const stored = this.#commits.get(request.idempotencyKey)
    if (stored) {
      if (stored.signature !== signature) throw new AgentToolsError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another mutation.')
      return stored.promise
    }
    const promise = this.#serialize(() => this.#restore(request))
    this.#commits.set(request.idempotencyKey, { signature, promise })
    void promise.catch(() => { if (this.#commits.get(request.idempotencyKey)?.promise === promise) this.#commits.delete(request.idempotencyKey) })
    return promise
  }

  async #bounded(kind: 'inspect' | 'read', request: AgentBoundedRequest): Promise<AgentBoundedResult> {
    abortIfNeeded(request.signal)
    const maxItems = boundedInteger(request.maxItems, this.limits.maxReadItems, `${kind}.maxItems`)
    const maxBytes = boundedInteger(request.maxBytes, this.limits.maxReadBytes, `${kind}.maxBytes`)
    const identity = await this.#refreshIdentity(request.signal)
    let raw: AgentBoundedAdapterResult
    try { raw = await this.adapter[kind]({ ...this.#context(identity), ...request, maxItems, maxBytes }) }
    catch (error) { throw asAgentToolsError(error) }
    const value = immutableJson(raw, `${kind} result`)
    if (!Number.isSafeInteger(value.itemCount) || value.itemCount < 0 || value.itemCount > maxItems) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `${kind} result violates its item bound.`)
    if (jsonBytes(value.data) > maxBytes) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `${kind} result violates its byte bound.`)
    if (value.nextCursor !== undefined && !value.truncated) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `${kind} result has a cursor but is not truncated.`)
    return immutableJson({ protocol: AGENT_TOOLS_PROTOCOL, protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION, identity, appliedLimits: { maxItems, maxBytes }, ...value }, `${kind} result`)
  }

  async #view(kind: 'preview' | 'diff', changeSet: AgentChangeSet<TArtifact>, signal?: AbortSignal): Promise<AgentArtifactView> {
    const envelope = this.#owned(changeSet)
    const identity = await this.#requireCurrent(envelope, signal)
    let raw
    try { raw = await this.adapter[kind]({ ...this.#context(identity), changeSet: envelope, signal }) }
    catch (error) { throw asAgentToolsError(error) }
    return immutableJson({ protocol: AGENT_TOOLS_PROTOCOL, protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION, changeSetId: envelope.changeSetId, identity, ...raw }, `${kind} result`)
  }

  async #commit(envelope: Readonly<AgentChangeSetEnvelope>, options: AgentCommitOptions): Promise<AgentCommitResult> {
    abortIfNeeded(options.signal)
    const changeSet = new AgentChangeSet(envelope, this)
    const report = await this.validate(changeSet, options.signal)
    if (!report.valid) throw new AgentToolsError('VALIDATION_FAILED', 'Change set validation failed.', false, report.issues)
    const capabilities = await this.capabilities(options.signal)
    const byName = new Map(capabilities.capabilities.map((entry) => [entry.name, entry]))
    const destructive = envelope.operations.filter((operation) => {
      const capability = byName.get(operation.name)
      return capability?.destructive || capability?.requiresConfirmation
    })
    // This is the final optimistic guard. The adapter must repeat it atomically.
    const identity = await this.#requireCurrent(envelope, options.signal)
    if (destructive.length) await this.#confirmMutation('commit', identity, destructive, options.confirmation, envelope)
    let committed: AgentAdapterCommitResult<TArtifact>
    try {
      committed = await this.adapter.commit({ ...this.#context(identity), changeSet: envelope, idempotencyKey: options.idempotencyKey, expectedRevision: identity.revision, expectedFingerprint: identity.fingerprint, signal: options.signal })
    } catch (error) { throw asAgentToolsError(error) }
    const checked = await this.#checkReplacement(committed, identity, options.signal)
    // The mutation already succeeded. Adopt only after the adapter's receipt was
    // read back from the exact replacement artifact, before optional proof work.
    this.#artifact = checked.artifact
    this.#identity = checked.identity
    let verifiedRaw
    try {
      verifiedRaw = await this.adapter.verify({ ...this.#contextFor(checked.artifact, checked.identity), changeSet: envelope, stage: 'committed', commit: checked, signal: options.signal })
    } catch (error) { throw asAgentToolsError(error) }
    const verified = verification(envelope.changeSetId, verifiedRaw)
    return immutableJson({
      protocol: AGENT_TOOLS_PROTOCOL,
      protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION,
      changeSetId: envelope.changeSetId,
      idempotencyKey: options.idempotencyKey,
      identity: checked.identity,
      ...(checked.data !== undefined ? { data: checked.data } : {}),
      ...(checked.evidence ? { evidence: checked.evidence } : {}),
      ...(checked.deduplicated !== undefined ? { deduplicated: checked.deduplicated } : {}),
      verification: verified,
    }, 'commit result')
  }

  async #restore(request: AgentRestoreRequest): Promise<AgentCommitResult> {
    abortIfNeeded(request.signal)
    const identity = await this.#refreshIdentity(request.signal)
    assertExpected(identity, request.expectedRevision, request.expectedFingerprint)
    await this.#confirmMutation('restore', identity, [], request.confirmation)
    let restored: AgentAdapterCommitResult<TArtifact>
    try {
      restored = await this.adapter.restore!({ ...this.#context(identity), versionId: request.versionId, idempotencyKey: request.idempotencyKey, expectedRevision: identity.revision, expectedFingerprint: request.expectedFingerprint, signal: request.signal })
    } catch (error) { throw asAgentToolsError(error) }
    const checked = await this.#checkReplacement(restored, identity, request.signal)
    this.#artifact = checked.artifact
    this.#identity = checked.identity
    const noChangeSet = `restore-${stableId({ artifactId: identity.artifactId, versionId: request.versionId })}`
    const verified: AgentVerificationResult = immutableJson({ protocol: AGENT_TOOLS_PROTOCOL, protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION, changeSetId: noChangeSet, verified: true, checks: [{ name: 'adapter-identity', passed: true }], issues: [] }, 'restore verification')
    return immutableJson({ protocol: AGENT_TOOLS_PROTOCOL, protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION, changeSetId: noChangeSet, idempotencyKey: request.idempotencyKey, identity: checked.identity, ...(checked.data !== undefined ? { data: checked.data } : {}), ...(checked.evidence ? { evidence: checked.evidence } : {}), ...(checked.deduplicated !== undefined ? { deduplicated: checked.deduplicated } : {}), verification: verified }, 'restore result')
  }

  async #checkReplacement(result: AgentAdapterCommitResult<TArtifact>, prior: AgentArtifactIdentity, signal?: AbortSignal): Promise<Readonly<AgentAdapterCommitResult<TArtifact>>> {
    const checked = immutableJson({ identity: result.identity, ...(result.data !== undefined ? { data: result.data } : {}), ...(result.evidence ? { evidence: result.evidence } : {}), ...(result.deduplicated !== undefined ? { deduplicated: result.deduplicated } : {}) }, 'adapter commit result')
    if (checked.identity.artifactId !== prior.artifactId || checked.identity.format !== prior.format) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Committed artifact identity changed artifactId or format.')
    let observed: AgentArtifactIdentity
    try { observed = await this.adapter.identity({ artifact: result.artifact, actor: this.actor, signal }) }
    catch (error) { throw asAgentToolsError(error) }
    const frozenObserved = immutableJson(observed, 'committed artifact identity')
    if (!sameIdentity(frozenObserved, checked.identity)) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Adapter commit identity does not match the replacement artifact.')
    if (frozenObserved.revision === prior.revision) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'A successful mutation must advance the artifact revision.')
    return Object.freeze({ artifact: result.artifact, ...checked })
  }

  async #confirmMutation(action: 'commit' | 'restore', identity: AgentArtifactIdentity, destructiveOperations: readonly AgentOperation[], confirmation?: import('./types').JsonValue, changeSet?: Readonly<AgentChangeSetEnvelope>): Promise<void> {
    if (!this.#confirm) throw new AgentToolsError('CONFIRMATION_REQUIRED', `${action} requires a host confirmation hook.`)
    let allowed: boolean
    try { allowed = await this.#confirm({ action, actor: this.actor, identity, changeSet, destructiveOperations, confirmation }) }
    catch (error) { throw asAgentToolsError(error) }
    if (!allowed) throw new AgentToolsError('CONFIRMATION_DENIED', `${action} was denied by the host.`)
  }

  async #requireCurrent(envelope: Readonly<AgentChangeSetEnvelope>, signal?: AbortSignal): Promise<Readonly<AgentArtifactIdentity>> {
    const identity = await this.#refreshIdentity(signal)
    assertExpected(identity, envelope.baseRevision, envelope.baseFingerprint)
    return identity
  }

  async #refreshIdentity(signal?: AbortSignal): Promise<Readonly<AgentArtifactIdentity>> {
    abortIfNeeded(signal)
    let identity
    try { identity = await this.adapter.identity({ artifact: this.#artifact, actor: this.actor, signal }) }
    catch (error) { throw asAgentToolsError(error) }
    const checked = immutableJson(identity, 'artifact identity')
    if (!checked.artifactId?.trim() || !checked.format?.trim() || !checked.revision?.trim() || !checked.fingerprint?.trim()) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Adapter returned an incomplete artifact identity.')
    if (checked.artifactId !== this.#identity.artifactId || checked.format !== this.#identity.format) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Adapter changed artifactId or format without a committed replacement.')
    this.#identity = checked
    return checked
  }

  #context(sourceIdentity: Readonly<AgentArtifactIdentity>) { return this.#contextFor(this.#artifact, sourceIdentity) }
  #contextFor(artifact: TArtifact, sourceIdentity: Readonly<AgentArtifactIdentity>) { return { artifact, actor: this.actor, sourceIdentity, limits: this.limits } }

  #owned(changeSet: AgentChangeSet<TArtifact>): Readonly<AgentChangeSetEnvelope> {
    if (!(changeSet instanceof AgentChangeSet) || changeSet.envelope.artifactId !== this.identity.artifactId || changeSet.envelope.actor.id !== this.actor.id) throw new AgentToolsError('INVALID_ARGUMENT', 'Change set does not belong to this session.')
    const { changeSetId: _ignored, protocol: _protocol, protocolVersion: _protocolVersion, ...content } = changeSet.envelope
    if (changeSet.envelope.protocol !== AGENT_CHANGESET_PROTOCOL || changeSet.envelope.protocolVersion !== AGENT_CHANGESET_PROTOCOL_VERSION || changeSet.envelope.changeSetId !== `changeset-${stableId(content)}`) throw new AgentToolsError('INVALID_ARGUMENT', 'Change set envelope is malformed or has been modified.')
    if (changeSet.envelope.operations.length < 1 || changeSet.envelope.operations.length > this.limits.maxOperations || jsonBytes(changeSet.envelope.operations) > this.limits.maxOperationBytes) throw new AgentToolsError('LIMIT_EXCEEDED', 'Change set exceeds this session limits.')
    return changeSet.envelope
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

export async function createAgentSession<TArtifact>(options: CreateAgentSessionOptions<TArtifact>): Promise<AgentSession<TArtifact>> {
  const actor = immutableJson(options.actor, 'actor')
  if (!validId(actor.id) || actor.kind !== 'agent') throw new AgentToolsError('INVALID_ARGUMENT', 'Agent actor requires a valid stable id and kind `agent`.')
  const limits = immutableJson({ ...DEFAULT_AGENT_SESSION_LIMITS, ...options.limits }, 'session limits')
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new AgentToolsError('INVALID_ARGUMENT', `${name} must be a positive safe integer.`)
  const adapter = options.adapter ?? options.registry?.resolve(options.artifact, options.format)
  if (!adapter) throw new AgentToolsError('INVALID_ARGUMENT', 'An adapter or registry is required.')
  if (!adapter.supports(options.artifact)) throw new AgentToolsError('INVALID_ARGUMENT', `Adapter ${adapter.id} does not support the artifact.`)
  let identity
  try { identity = await adapter.identity({ artifact: options.artifact, actor, signal: options.signal }) }
  catch (error) { throw asAgentToolsError(error) }
  const checked = immutableJson(identity, 'artifact identity')
  if (checked.format !== adapter.format) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `Adapter format ${adapter.format} does not match artifact format ${checked.format}.`)
  if (!checked.artifactId?.trim() || !checked.revision?.trim() || !checked.fingerprint?.trim()) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Adapter returned an incomplete artifact identity.')
  return new AgentSession(options.artifact, checked, actor, adapter, limits, options.confirmDestructive)
}

function verification(changeSetId: string, raw: Omit<AgentVerificationResult, 'protocol' | 'protocolVersion' | 'changeSetId'>): AgentVerificationResult {
  const value = immutableJson(raw, 'verification result')
  const issues = normalizeIssues(value.issues)
  if (!Array.isArray(value.checks) || value.checks.some(({ name, passed }) => !name?.trim() || typeof passed !== 'boolean')) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Verification contains a malformed check.')
  if (value.verified !== value.checks.every(({ passed }) => passed) || value.verified && issues.some(({ severity }) => severity === 'error' || severity === 'refusal')) throw new AgentToolsError('INVALID_ADAPTER_RESULT', 'Verification summary is inconsistent with its checks or issues.')
  return immutableJson({ protocol: AGENT_TOOLS_PROTOCOL, protocolVersion: AGENT_TOOLS_PROTOCOL_VERSION, changeSetId, ...value, issues }, 'verification result')
}

function normalizeIssues(issues: readonly AgentIssue[]): readonly AgentIssue[] {
  return issues.map((issue, index) => {
    const value = cloneJson(issue, `issue ${index}`)
    if (!['error', 'warning', 'refusal'].includes(value.severity) || !value.code?.trim() || !value.message?.trim()) throw new AgentToolsError('INVALID_ADAPTER_RESULT', `Issue ${index} is malformed.`)
    return value
  }).sort((a, b) => canonicalJson([a.operationId ?? '', a.path ?? '', a.severity, a.code, a.message]).localeCompare(canonicalJson([b.operationId ?? '', b.path ?? '', b.severity, b.code, b.message])))
}

function baseIdentity(envelope: AgentChangeSetEnvelope): AgentArtifactIdentity { return { artifactId: envelope.artifactId, format: envelope.format, revision: envelope.baseRevision, fingerprint: envelope.baseFingerprint } }
function sameIdentity(left: AgentArtifactIdentity, right: AgentArtifactIdentity): boolean { return left.artifactId === right.artifactId && left.format === right.format && left.revision === right.revision && left.fingerprint === right.fingerprint }
function staleIssue(envelope: AgentChangeSetEnvelope, current: AgentArtifactIdentity): AgentIssue { return { severity: 'error', code: 'STALE_REVISION', message: `Change set is based on revision ${envelope.baseRevision}, but the artifact is at ${current.revision}.`, retryable: true, details: { expectedRevision: envelope.baseRevision, actualRevision: current.revision, expectedFingerprint: envelope.baseFingerprint, actualFingerprint: current.fingerprint } } }
function assertExpected(identity: AgentArtifactIdentity, revision?: string, fingerprint?: string): void { if (revision !== undefined && identity.revision !== revision || fingerprint !== undefined && identity.fingerprint !== fingerprint) throw new AgentToolsError('STALE_REVISION', 'Artifact identity no longer matches the expected revision and fingerprint.', true, undefined, { expectedRevision: revision ?? '', actualRevision: identity.revision, expectedFingerprint: fingerprint ?? '', actualFingerprint: identity.fingerprint }) }
function validName(value: string): boolean { return typeof value === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value) && value.length <= 128 }
function validId(value: string): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value) }
function validIdempotencyKey(value: string): void { if (!validId(value)) throw new AgentToolsError('INVALID_ARGUMENT', 'idempotencyKey must be 1-192 safe identifier characters.') }
function boundedInteger(requested: number | undefined, maximum: number, name: string): number { const value = requested ?? maximum; if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new AgentToolsError('LIMIT_EXCEEDED', `${name} must be between 1 and ${maximum}.`); return value }
function abortIfNeeded(signal?: AbortSignal): void { if (signal?.aborted) throw new AgentToolsError('ABORTED', 'Agent operation was aborted.', true) }
