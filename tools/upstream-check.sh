#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BASELINE_FILE="${BASELINE_FILE:-${REPO_ROOT}/.upstream-sha}"
UPSTREAM_REPO="${UPSTREAM_REPO:-jellyfin/jellyfin-webos}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-master}"
UPSTREAM_GIT_URL="https://github.com/${UPSTREAM_REPO}.git"

FORGEJO_API="${FORGEJO_API:-https://forgejo.timsas.nl/api/v1}"
FORGEJO_WEB="${FORGEJO_WEB:-https://forgejo.timsas.nl}"
REPO="${REPO:-tsas/jellyfin-webos}"
TOKEN="${TOKEN:-${FORGEJO_TOKEN:-${GITHUB_TOKEN:-}}}"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -f "${BASELINE_FILE}" ]]; then
  echo "Error: baseline file not found at ${BASELINE_FILE}" >&2
  exit 1
fi

BASE="$(tr -d '[:space:]' < "${BASELINE_FILE}")"
if [[ -z "${BASE}" ]]; then
  echo "Error: baseline SHA in ${BASELINE_FILE} is empty" >&2
  exit 1
fi

echo "Checking upstream ${UPSTREAM_REPO} (${UPSTREAM_BRANCH})..."
echo "Tracked baseline SHA: ${BASE}"

LATEST="$(git ls-remote "${UPSTREAM_GIT_URL}" "refs/heads/${UPSTREAM_BRANCH}" | awk '{print $1}')"
if [[ -z "${LATEST}" ]]; then
  echo "Error: failed to resolve upstream HEAD from ${UPSTREAM_GIT_URL}" >&2
  exit 1
fi

echo "Latest upstream SHA:  ${LATEST}"

RELEASE_JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest" 2>/dev/null || true)"
LATEST_RELEASE="$(RELEASE_JSON="${RELEASE_JSON}" node -e '
  const raw = process.env.RELEASE_JSON || "";
  if (!raw) { console.log("unknown"); process.exit(0); }
  try {
    const data = JSON.parse(raw);
    const tag = data.tag_name || data.name || "unknown";
    const url = data.html_url || "";
    console.log(url ? `${tag} (${url})` : tag);
  } catch {
    console.log("unknown");
  }
')"
echo "Latest upstream release: ${LATEST_RELEASE}"

if [[ "${LATEST}" == "${BASE}" ]]; then
  echo "up to date (baseline matches upstream ${UPSTREAM_BRANCH}: ${LATEST})"
  exit 0
fi

SHORT_BASE="${BASE:0:7}"
SHORT_LATEST="${LATEST:0:7}"
COMPARE_URL="https://github.com/${UPSTREAM_REPO}/compare/${BASE}...${LATEST}"

echo "Upstream changes detected: ${SHORT_BASE} -> ${SHORT_LATEST}"
echo "Compare URL: ${COMPARE_URL}"

COMPARE_JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${UPSTREAM_REPO}/compare/${BASE}...${LATEST}" 2>/dev/null || true)"

 parsed_compare="$(COMPARE_JSON="${COMPARE_JSON}" node -e '
  const raw = process.env.COMPARE_JSON || "";
  if (!raw) {
    console.log(JSON.stringify({ total_commits: "unknown", commits_md: "_Commit details unavailable (GitHub API call failed)._" }));
    process.exit(0);
  }
  try {
    const data = JSON.parse(raw);
    const total = typeof data.total_commits === "number" ? data.total_commits : (Array.isArray(data.commits) ? data.commits.length : "unknown");
    const commits = Array.isArray(data.commits) ? data.commits : [];
    const slice = commits.slice(0, 20);
    const lines = slice.map(c => {
      const sha = (c.sha || "").slice(0, 7);
      const msg = ((c.commit && c.commit.message) || "").split(/\r?\n/)[0];
      const author = (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || "unknown";
      return `- \`${sha}\` ${msg} (${author})`;
    });
    if (commits.length > 20) {
      lines.push(`- _...and ${commits.length - 20} more commit(s)_`);
    }
    const md = lines.length > 0 ? lines.join("\n") : "_No commits listed in compare response._";
    console.log(JSON.stringify({ total_commits: String(total), commits_md: md }));
  } catch {
    console.log(JSON.stringify({ total_commits: "unknown", commits_md: "_Failed to parse GitHub compare response._" }));
  }
')"

TOTAL_COMMITS="$(PARSED="${parsed_compare}" node -e 'console.log(JSON.parse(process.env.PARSED).total_commits)')"
COMMITS_MD="$(PARSED="${parsed_compare}" node -e 'console.log(JSON.parse(process.env.PARSED).commits_md)')"

MARKER="<!-- upstream-sha: ${LATEST} -->"
ISSUE_TITLE="Upstream changes available: ${UPSTREAM_REPO} (${SHORT_LATEST})"

read -r -d '' ISSUE_BODY <<EOF || true
Upstream [\`${UPSTREAM_REPO}\`](https://github.com/${UPSTREAM_REPO}) has new commits on \`${UPSTREAM_BRANCH}\`.

- **Tracked baseline:** \`${BASE}\` (\`${SHORT_BASE}\`)
- **Latest upstream:** \`${LATEST}\` (\`${SHORT_LATEST}\`)
- **Total commits ahead:** ${TOTAL_COMMITS}
- **Compare:** ${COMPARE_URL}
- **Latest upstream release:** ${LATEST_RELEASE}

### Commits (up to 20)
${COMMITS_MD}

### Merge Instructions
\`\`\`bash
git remote add upstream https://github.com/${UPSTREAM_REPO}.git 2>/dev/null || true
git fetch upstream
git checkout master
git merge upstream/${UPSTREAM_BRANCH}
# Resolve any conflicts, test build (npm run package), then update baseline:
echo "${LATEST}" > .upstream-sha
git add .upstream-sha
git commit -m "chore: update upstream baseline to ${SHORT_LATEST}"
git push
\`\`\`

${MARKER}
EOF

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "--- [DRY_RUN=1] Would create/update Forgejo issue in ${REPO} ---"
  echo "Title: ${ISSUE_TITLE}"
  echo "Body:"
  echo "${ISSUE_BODY}"
  echo "--- [DRY_RUN=1] End of preview ---"
  exit 0
fi

if [[ -z "${TOKEN}" ]]; then
  echo "Error: TOKEN (or FORGEJO_TOKEN / GITHUB_TOKEN) is required when DRY_RUN=0" >&2
  exit 1
fi

AUTH_HEADER="Authorization: token ${TOKEN}"
SEARCH_URL="${FORGEJO_API}/repos/${REPO}/issues?state=open&type=issues&q=Upstream%20changes%20available"
OPEN_ISSUES_JSON="$(curl -fsSL -H "${AUTH_HEADER}" -H "Accept: application/json" "${SEARCH_URL}")"

EXISTING_INFO="$(ISSUES_JSON="${OPEN_ISSUES_JSON}" MARKER="${MARKER}" node -e '
  const issues = JSON.parse(process.env.ISSUES_JSON || "[]");
  const marker = process.env.MARKER;
  const match = issues.find(i => typeof i.title === "string" && i.title.startsWith("Upstream changes available"));
  if (!match) {
    console.log(JSON.stringify({ found: false }));
  } else {
    const bodyHasMarker = typeof match.body === "string" && match.body.includes(marker);
    console.log(JSON.stringify({
      found: true,
      number: match.number,
      html_url: match.html_url || "",
      bodyHasMarker
    }));
  }
')"

FOUND="$(INFO="${EXISTING_INFO}" node -e 'console.log(JSON.parse(process.env.INFO).found ? "1" : "0")')"
ISSUE_URL=""

if [[ "${FOUND}" == "1" ]]; then
  ISSUE_NUMBER="$(INFO="${EXISTING_INFO}" node -e 'console.log(JSON.parse(process.env.INFO).number)')"
  ISSUE_URL="$(INFO="${EXISTING_INFO}" node -e 'console.log(JSON.parse(process.env.INFO).html_url)')"
  BODY_HAS_MARKER="$(INFO="${EXISTING_INFO}" node -e 'console.log(JSON.parse(process.env.INFO).bodyHasMarker ? "1" : "0")')"

  COMMENTS_HAVE_MARKER="0"
  if [[ "${BODY_HAS_MARKER}" == "0" ]]; then
    COMMENTS_JSON="$(curl -fsSL -H "${AUTH_HEADER}" -H "Accept: application/json" "${FORGEJO_API}/repos/${REPO}/issues/${ISSUE_NUMBER}/comments" || echo "[]")"
    COMMENTS_HAVE_MARKER="$(COMMENTS_JSON="${COMMENTS_JSON}" MARKER="${MARKER}" node -e '
      const comments = JSON.parse(process.env.COMMENTS_JSON || "[]");
      const marker = process.env.MARKER;
      const has = Array.isArray(comments) && comments.some(c => typeof c.body === "string" && c.body.includes(marker));
      console.log(has ? "1" : "0");
    ')"
  fi

  if [[ "${BODY_HAS_MARKER}" == "1" || "${COMMENTS_HAVE_MARKER}" == "1" ]]; then
    echo "Open issue #${ISSUE_NUMBER} already contains marker for ${LATEST}; skipping comment and Telegram notification."
    exit 0
  fi

  echo "Adding update comment to existing issue #${ISSUE_NUMBER}..."
  COMMENT_PAYLOAD="$(BODY="${ISSUE_BODY}" node -e 'console.log(JSON.stringify({ body: process.env.BODY }))')"
  curl -fsSL -X POST \
    -H "${AUTH_HEADER}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -d "${COMMENT_PAYLOAD}" \
    "${FORGEJO_API}/repos/${REPO}/issues/${ISSUE_NUMBER}/comments" >/dev/null

  if [[ -z "${ISSUE_URL}" ]]; then
    ISSUE_URL="${FORGEJO_WEB}/${REPO}/issues/${ISSUE_NUMBER}"
  fi
  echo "Updated issue: ${ISSUE_URL}"
else
  echo "Creating new Forgejo issue in ${REPO}..."
  CREATE_PAYLOAD="$(TITLE="${ISSUE_TITLE}" BODY="${ISSUE_BODY}" node -e '
    console.log(JSON.stringify({ title: process.env.TITLE, body: process.env.BODY }));
  ')"
  CREATED_JSON="$(curl -fsSL -X POST \
    -H "${AUTH_HEADER}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -d "${CREATE_PAYLOAD}" \
    "${FORGEJO_API}/repos/${REPO}/issues")"
  ISSUE_NUMBER="$(CREATED="${CREATED_JSON}" node -e 'console.log(JSON.parse(process.env.CREATED).number || "")')"
  ISSUE_URL="$(CREATED="${CREATED_JSON}" node -e 'console.log(JSON.parse(process.env.CREATED).html_url || "")')"
  if [[ -z "${ISSUE_URL}" && -n "${ISSUE_NUMBER}" ]]; then
    ISSUE_URL="${FORGEJO_WEB}/${REPO}/issues/${ISSUE_NUMBER}"
  fi
  echo "Created issue: ${ISSUE_URL}"
fi

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Sending Telegram notification..."
  TG_PAYLOAD="$(
    CHAT_ID="${TELEGRAM_CHAT_ID}" \
    UPSTREAM_REPO="${UPSTREAM_REPO}" \
    SHORT_BASE="${SHORT_BASE}" \
    SHORT_LATEST="${SHORT_LATEST}" \
    TOTAL_COMMITS="${TOTAL_COMMITS}" \
    LATEST_RELEASE="${LATEST_RELEASE}" \
    ISSUE_URL="${ISSUE_URL}" \
    COMPARE_URL="${COMPARE_URL}" \
    node -e '
      const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const lines = [
        `<b>Upstream update: ${esc(process.env.UPSTREAM_REPO)}</b>`,
        `Commits: <code>${esc(process.env.SHORT_BASE)}</code> → <code>${esc(process.env.SHORT_LATEST)}</code> (${esc(process.env.TOTAL_COMMITS)} ahead)`,
        `Latest release: ${esc(process.env.LATEST_RELEASE)}`,
        `Forgejo issue: <a href="${esc(process.env.ISSUE_URL)}">${esc(process.env.ISSUE_URL)}</a>`,
        `Compare: <a href="${esc(process.env.COMPARE_URL)}">${esc(process.env.COMPARE_URL)}</a>`
      ];
      console.log(JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text: lines.join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true
      }));
    '
  )"
  curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "${TG_PAYLOAD}" >/dev/null
  echo "Telegram notification sent."
else
  echo "Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; skipping Telegram notification."
fi
