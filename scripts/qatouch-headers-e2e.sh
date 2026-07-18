#!/usr/bin/env bash
# E2E test case creation for Main Stage & Hangouts headers via QAtouch API
# Usage: SECTION_KEY=<key> MILESTONE_KEY=<key> bash qatouch-headers-e2e.sh
# Get these keys from: easybots.qatouch.com → PNPTV project → Sections / Milestones

set -e
API="https://api.qatouch.com/api/v1"
TOKEN="8645eb8b8e532f65025806f315ba604e244d9397e5d27280b94d6a6cc9b9772f"
PROJECT="PNPTV"
SECTION="${SECTION_KEY:?Set SECTION_KEY from QAtouch dashboard}"
MILESTONE="${MILESTONE_KEY:-}"  # optional

create_tc() {
  local title="$1" desc="$2"
  local body="{\"projectKey\":\"$PROJECT\",\"sectionKey\":\"$SECTION\",\"caseTitle\":\"$title\",\"description\":\"$desc\",\"status\":\"active\"}"
  [ -n "$MILESTONE" ] && body=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); d['milestoneKey']='$MILESTONE'; print(json.dumps(d))")
  result=$(curl -s -X POST "$API/testCase" \
    -H "api-token: $TOKEN" \
    -H "domain: easybots" \
    -H "Content-Type: application/json" \
    -d "$body")
  echo "$title → $result"
}

echo "=== Main Stage Header Tests ==="
create_tc "MS-H-001: Header renders with logo, mode chip, and close button" \
  "Navigate to /main-stage. Verify: PNPtv! logo visible, mode chip shows icon+title, close button present and tappable (44px target)."
create_tc "MS-H-002: Token balance shows count with low-balance pulse" \
  "As authenticated user with <500 tokens, verify red pulse dot appears on token badge. Badge must be max ~80px wide even with gifted balance."
create_tc "MS-H-003: Guest badge shows with 15-min countdown timer" \
  "Join via /main-stage?guest=1. Verify purple Guest badge with countdown MM:SS visible in header right cluster."
create_tc "MS-H-004: Topic strip visible and horizontally scrollable at 360px viewport" \
  "Set viewport to 360px width. Verify topic strip row is rendered (min-height 28px), Hangouts pill visible, topic pills scrollable."

echo "=== Hangouts Header Tests ==="
create_tc "HO-H-001: Hangouts list header renders gradient card with filter tabs" \
  "Navigate to /chat. Verify: glass-card header with gradient title, Joined and Discover filter tabs visible with correct active state."
create_tc "HO-H-002: Joined tab shows group count; Discover tab toggles section" \
  "On Hangouts list, click Discover tab. Verify discover section appears. Click Joined tab. Verify joined groups section appears."
create_tc "HO-H-003: New group button visible for PRIME users in header" \
  "As PRIME user, verify '+' New group button in header top-right. As non-PRIME, verify button is absent."
create_tc "HO-H-004: Chat header shows back button, avatar, name with title attr, and member count" \
  "Open any hangout group. Verify back chevron, avatar, group name truncated with title attr for tooltip, member count row."
create_tc "HO-H-005: Live call indicator appears in chat header when call is active" \
  "Trigger an active call in a group. Verify red pulsing 'Live' badge appears in header right area adjacent to the call button."
create_tc "HO-H-006: Main hangout shows Join Main Stage button instead of video call" \
  "Open group ID 26 (main community hangout). Verify header shows gradient 'Join Main Stage' button, not the standard VideoCallButton."

echo "=== Done. Review results at easybots.qatouch.com ==="
