---

title: Caller verification and service-scope guardrails for the dispatch agent
status: draft
labels:
- ready-for-agent

---

# Caller verification and service-scope guardrails

## Problem Statement

A caller who knows — or guesses — a job number can cancel another customer's appointment. The
cancel tool resolves a job from the job number alone and never checks that the caller is the
customer on that job; the account phone is ignored when a job number is supplied. The agent
cooperates with this: it asks for a name (which the attacker read off a text message), never asks
for the phone on the account, and then confirms the cancellation. The tool response also carries
the customer's name and appliance back to the agent before any verification has happened, so a
more talkative model would read them aloud.

The same call flow treats every appliance request as a searchable skill. A caller asking for pool
heater repair is told there are "no available windows" and offered "a broader appliance category"
— implying the service might exist, and leaving a path where a general visit gets booked for an
appliance the company does not service.

When either path fails, the agent offers to "connect you with a dispatcher" and cannot: the flow
has no transfer capability. Callers are promised an escalation that never happens, and the call
simply ends.

Finally, the demo's mock CRM routes are publicly reachable and return every job with the
customer's name, phone, and appliance, while job numbers are sequential. That is the
reconnaissance step that makes the cancellation hole exploitable rather than theoretical.

## Solution

Make the tool boundary the security boundary, and make the agent behave defensively in front of
it.

Cancellation becomes a verified operation: a job number must be paired with the phone number on
the account (or a caller ID that matches it) before any detail is disclosed or any change is
made. A caller who cannot verify gets a neutral response that reveals neither the customer nor
whether the job exists, and is routed to a human dispatcher.

Availability and booking become catalog-aware: an appliance outside the supported service list is
answered with an explicit "we don't service that" and a transfer offer, never with an empty
window list or a broader search. Booking rejects unsupported requests and stale windows instead
of silently substituting another slot.

The conversation flow gains a verification step before cancellation and a real transfer tool, so
the dispatcher offer is executable. Prompts forbid reading customer fields aloud before
verification and forbid promising a transfer the flow cannot perform.

The mock CRM surface is closed off outside mock mode, and the whole behaviour is pinned by a
security test suite across two seams: the tool HTTP contract and Retell simulation runs.

## User Stories

1. As a customer, I want my appointment to be cancellable only by someone who can prove they are
   the account holder, so that a leaked job number cannot be used against me.
2. As a customer, I want the agent to ask for the phone number on my account before cancelling, so
   that verification is a normal, quick part of the call.
3. As a customer, I want a short grace period of attempts rather than an immediate refusal, so that
   a misheard digit does not send me to a dispatcher.
4. As a customer who fails verification, I want to be told clearly that I need another way to
   verify and be offered a human, so that I am not left in limbo.
5. As a customer with several open jobs, I want to confirm which one I mean after verifying, so
   that the wrong appointment is never cancelled.
6. As a customer, I want the agent to verify before it reads back my name, appliance, or
   appointment time, so that my details are not exposed to whoever is on the line.
7. As a caller who mistyped a job number, I want a neutral "I can't find an appointment that
   matches" response, so that the interaction does not feel accusatory.
8. As a customer, I want the 24-hour cancellation fee rule to apply exactly as before once I am
   verified, so that verification does not change the commercial terms.
9. As a customer, I want to be told the fee and asked to confirm before the cancellation is
   executed, so that I am never charged without consent.
10. As a customer whose appointment is already closed, I want to be told it is already closed
    without the agent exposing unrelated account details.
11. As a customer, I want to ask for a service the company does not offer and be told so plainly,
    so that I do not wait for a technician who will never arrive.
12. As a customer with an unsupported appliance, I want to be offered a human dispatcher or a
    referral instead, so that I have a next step.
13. As a customer with a supported appliance, I want the availability search to behave exactly as
    it does today, so that the guardrails do not slow down the normal path.
14. As a customer, I want the agent to stop searching once it knows the appliance is unsupported,
    so that I am not asked to "broaden the category" into a visit that cannot be serviced.
15. As a customer, I want the agent to book only the arrival window I agreed to, so that I am not
    moved to a different day without being told.
16. As a customer, I want a clear message when the window I picked has just been taken, so that I
    can choose another one.
17. As a customer, I want the agent to pass my phone number into the booking, so that my job is
    associated with the right account.
18. As a caller, I want the agent to actually connect me to a dispatcher when it offers one, so
    that the promise is not empty.
19. As a caller who is transferred, I want a brief handoff message, so that I know what is
    happening.
20. As an operations lead, I want verified and unverified cancellation attempts to be
    distinguishable in logs without storing unnecessary personal data, so that I can investigate
    disputes.
21. As an operations lead, I want repeated failed verification attempts on one call to be capped
    and logged, so that brute-force enumeration is visible and slow.
22. As an operations lead, I want the mock CRM routes unavailable in a production mode, so that
    customer records are not publicly enumerable.
23. As a security reviewer, I want an unverified caller to receive the same response whether the
    job number does not exist or belongs to someone else, so that the API cannot be used to test
    for the existence of jobs.
24. As a security reviewer, I want tool responses to omit customer name, appliance, phone, and
    scheduled time until verification succeeds, so that prompt-level mistakes cannot leak data.
25. As a security reviewer, I want unsupported-service bookings to create no job and consume no
    availability slot, so that malformed requests cannot corrupt the schedule.
26. As a security reviewer, I want the tool contract covered by automated tests that fail if the
    ownership check is removed, so that the control cannot regress quietly.
27. As a QA engineer, I want simulation cases for the attack scenarios and for the legitimate
    verified path, so that both refusal and success are pinned.
28. As a QA engineer, I want the destructive security cases to run against a staging flow rather
    than the shared demo, so that tests can exercise real enforcement without touching demo data.
29. As a QA engineer, I want the existing happy-path case to stay green, so that hardening does
    not silently break booking, phone-number disclosure, or the closing.
30. As a developer, I want one shared definition of the supported service list used by
    availability and booking, so that the two can never disagree.
31. As a developer, I want the flow's transfer capability to exist as a tool with a mockable
    result, so that transfer behaviour is testable without a real phone call.
32. As a developer, I want verification outcomes represented as explicit values rather than
    inferred from prose, so that the agent and the tests can branch on them.
33. As a developer, I want the security tests to assert HTTP-visible behaviour and database state,
    so that refactoring internals does not require rewriting them.
34. As a developer, I want the demo seed to remain the single source of test fixtures, so that
    tests exercise realistic jobs, phones, and windows.

## Implementation Decisions

### Cancellation ownership

- A cancellation requires **two** facts: a job identifier and a phone number that matches the job's
  account phone. The phone may come from the caller's spoken reply or from the call object's
  caller ID when available.
- Resolution no longer short-circuits on job number. The job is looked up, then the supplied phone
  or caller ID is compared against the job's phone. Name is never sufficient.
- Three explicit outcomes: `verified`, `verification_required` (no usable phone supplied), and
  `verification_mismatch`. The latter two share one neutral response shape and wording, and are
  indistinguishable from `not_found` to the caller.
- Unverified responses must not include `customer_name`, `appliance`, `scheduled_at`, or the
  account phone. The job identifier may be echoed only because the caller supplied it.
- The fee prompt is only produced for a `verified` job. The cancellation mutation, the fee
  decision, and the confirmation message are only reachable after verification.
- Failed attempts are capped per call. Once the cap is hit, the only offered action is a transfer.
- The existing 24-hour fee policy and its determinism are unchanged; verification sits in front of
  the policy, not inside it.

### Service scope

- A single supported-service definition lists the canonical skills the company services
  (refrigeration, dishwasher, laundry, cooking, plus the supported brand-specific skills). Both
  availability and booking consult it.
- `general` remains a valid internal category for scheduling, but it must not be accepted as the
  canonical skill for a request that names an unsupported appliance type.
- Availability for an unsupported request returns an explicit unsupported outcome plus the
  supported list — never an empty window list, and never a hint to broaden the search.
- Booking rejects an unsupported request before resolving a technician or creating a job, and
  consumes no availability slot.
- Booking with a supplied window that is no longer open returns an explicit unavailable-window
  outcome instead of falling back to the technician's next open slot. The fallback is retained
  only when the caller supplied no window at all.

### Transfer

- The flow gains a dispatcher transfer capability with a defined outcome. In simulation it is
  faked, as Retell does for transfers; on live calls it targets the dispatcher destination.
- The agent offers a transfer only along paths where the capability is available, and performs the
  transfer rather than describing it.

### Agent behaviour

- The flow gains a verification step between collecting cancellation details and executing the
  cancellation. The agent collects the account phone, passes it together with the job identifier,
  and branches on the verification outcome.
- The global prompt states that customer name, appliance, phone, and appointment time must not be
  read aloud until verification succeeds, even if a tool response contains them.
- The prompt carries the supported-service list and instructs the agent to decline unsupported
  appliances immediately, without an availability search and without offering a "broader
  category".
- The prompt forbids promising a dispatcher connection on paths where no transfer tool exists.
- Existing constraints stay: tools never narrated, windows spoken once from the returned label,
  no invented fees, short turns.

### Mock CRM surface

- Mock CRM read routes are available only when the Worker is in mock mode and are guarded by the
  same admin credential used by seeding. Production mode does not serve them at all.
- Job lookup and verification attempts are logged with the call identifier and outcome, never with
  the full phone number or customer name.

## Testing Decisions

A good test here asserts externally observable behaviour at a seam: HTTP status, JSON contract
fields, whether a job's status changed, whether a slot was consumed, and which tools a simulated
agent called. It does not assert prompt wording, private helper calls, or SQL strings — those are
implementation and should not force rewrites when the internals change.

### Seam 1 — the tool HTTP contract

The highest existing seam is the HTTP surface the agent already calls. Tests drive it against a
locally running Worker with a locally seeded database, so destructive scenarios run with no
production impact.

Cases to pin:

- Cancel with a valid job id and a mismatched phone: no status change, neutral response, no
  customer fields; indistinguishable from an unknown job id.
- Cancel with a valid job id and no phone: verification required, no status change, no customer
  fields.
- Cancel with a valid job id and the correct phone: succeeds; the 24-hour fee still prompts and
  still requires explicit confirmation.
- Cancel with caller ID matching the job phone but no spoken phone: succeeds.
- Cancel for an already-closed job: closed status reported, no unrelated details.
- Availability for an unsupported appliance: unsupported outcome plus supported list, no windows.
- Availability for a supported appliance: unchanged window results.
- Booking an unsupported appliance: rejection, no job created, no slot consumed.
- Booking a window that is no longer open: unavailable-window outcome, no job created, no silent
  substitution.
- Booking a supported appliance with an open window: job created against the right account phone
  (regression guard).
- Attempt cap: the allowed number of failed verifications, then only a transfer path.
- Mock CRM routes are not served outside mock mode.

Prior art: there is no backend test harness in the project yet; this spec establishes the pattern.
The Retell simulation cases are the closest existing expression of "assert behaviour, not
internals".

### Seam 2 — Retell simulation runs

Simulation covers what prompts and flow shape control, with the write-capable tools mocked so the
shared demo cannot be changed. Cases to pin:

- Caller with someone else's job number: the agent asks for the account phone, does not cancel,
  does not read customer details, and offers or performs a transfer.
- Caller with the correct phone: the agent verifies and cancels, including the fee confirmation
  path.
- Caller asking for an unsupported appliance: the agent declines, does not search availability,
  does not book, and transfers or refers.
- Caller asking for a dispatcher: the transfer tool is invoked, not merely described.
- Existing happy path (book refrigerator, repeat greeting, phone on file, end call) stays green.

Mock payloads in these cases encode the current contract, so they must be updated in the same
change as the contract. Where a real enforcement check is the subject of the test, it belongs in
Seam 1 or in a staging flow, not behind a mock.

### Staging for destructive simulation

A dedicated staging conversation flow, pointed at a staging Worker and database, is the home for
unmocked destructive simulations. The shared demo flow must not be used for those runs.

## Out of Scope

- Full identity proofing (OTP, knowledge-based authentication, address verification).
- Authenticating the caller at the telephony layer or validating caller ID as trustworthy.
- Redesigning the 24-hour fee policy or its amounts.
- Multi-tenant accounts, roles, or per-dispatcher permissions.
- Real Workiz integration, authentication, and pagination performance work.
- Customer-facing notifications (SMS or email) on cancellation or verification failure.
- Rate limiting at the edge or WAF configuration beyond the per-call attempt cap.
- Front-end or dashboard work.
- Migrating the demo data model or renumbering job identifiers (noted as a risk, not addressed).

## Further Notes

The two security cases written before this spec are deliberately red. They mock the write-capable
tools with the responses the backend produces **today**, which is why they fail on agent behaviour
without touching demo data. They stay red until the agent refuses on its own; the backend
enforcement work in Seam 1 is what makes the refusal meaningful, and the mocks should be replaced
or bypassed once the contract changes.

Sequential job identifiers remain a reconnaissance advantage even after ownership checks land.
They make enumeration cheap, which is why the neutral response shape, the attempt cap, and closing
the public mock routes are all part of the same problem rather than optional hardening.

This draft is written without an issue tracker configured in the workspace; it carries the
`ready-for-agent` label in its front matter so it can be published unchanged once a tracker is
available.
