#!/bin/bash
# Changelog Generator
#
# Generates a categorized changelog from git history:
# - Detects unreleased commits when run on a branch (alpha build)
# - Lists each tag from the last month with categorized commits
# - Categories: Breaking, Features, Fixes, Changes, Documentation, Other
#
# Usage: ./generate-changelog.sh [output_file]
#   output_file: Path to output changelog file (default: CHANGELOG.md)
#
# Environment variables:
#   GITHUB_REF:        Tag refs (refs/tags/X.Y.Z) trigger release mode; anything else is alpha
#   PROJECT_NAME:      Heading text (default: "Changelog")
#   GH_ISSUES_URL:     Optional issues link in footer (auto-derived from GITHUB_REPOSITORY)

set -eE

OUTPUT_FILE="${1:-CHANGELOG.md}"
MONTH_AGO_SECONDS=$((30 * 24 * 60 * 60))
PROJECT_NAME="${PROJECT_NAME:-Changelog}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"  >&2; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"   >&2; }

trap 'log_error "FAILED at ${BASH_SOURCE[0]}:${LINENO} command: ${BASH_COMMAND} (exit $?)"' ERR

if [ -z "$GH_ISSUES_URL" ] && [ -n "$GITHUB_REPOSITORY" ]; then
    GH_ISSUES_URL="https://github.com/${GITHUB_REPOSITORY}/issues"
fi

# === Categorization ===

categorize_commit() {
    local msg="$1"
    local msg_lower
    msg_lower=$(echo "$msg" | tr '[:upper:]' '[:lower:]')

    # Conventional / explicit prefixes first
    if [[ "$msg" =~ ^(feat|feature|enhancement|new)[:\ ] ]] || [[ "$msg" =~ ^NEW: ]]; then
        echo "feature"; return
    elif [[ "$msg" =~ ^(fix|fixes|bug|bugfix)[:\ ] ]]; then
        echo "fix"; return
    elif [[ "$msg" =~ ^(chore|refactor|style|perf|improved)[:\ ] ]]; then
        echo "change"; return
    elif [[ "$msg" =~ ^(docs|documentation)[:\ ] ]]; then
        echo "docs"; return
    elif [[ "$msg" =~ ^(breaking|BREAKING)[:\ ] ]]; then
        echo "breaking"; return
    fi

    # Natural language fallbacks
    if [[ "$msg_lower" =~ ^fix(es|ed|ing)?[[:space:]:\-] ]]; then echo "fix"; return; fi
    if [[ "$msg_lower" =~ ^(add(s|ed|ing)?|new|implement(s|ed|ing)?|integrate(s|d)?|register(s|ed)?)[[:space:]:\-] ]]; then echo "feature"; return; fi
    if [[ "$msg_lower" =~ ^(improve(s|d|ing)?|enhance(s|d|ing)?|update(s|d|ing)?|refactor(s|ed|ing)?|cleanup|clean[[:space:]]up|reorganize(s|d)?|simplif(y|ies|ied)|migrate(s|d)?|move(s|d)?|remove(s|d)?|delete(s|d)?|switch|replace(s|d)?|bundle(s|d)?)[[:space:]:\-] ]]; then echo "change"; return; fi
    if [[ "$msg_lower" =~ ^(silence|suppress|protect(s)?|ensure(s)?|guard(s)?|attempt)[[:space:]:\-] ]]; then echo "fix"; return; fi

    echo "other"
}

clean_commit_message() {
    local msg="$1"
    msg=$(echo "$msg" | sed -E 's/^(feat|feature|fix|fixes|bug|bugfix|chore|refactor|style|perf|docs|documentation|breaking|BREAKING|NEW|new|enhancement|improved):[ ]+//i')

    # Strip natural-language verb prefixes (longer forms first)
    msg=$(echo "$msg" | sed -E 's/^(Fixes|Fixed|Fixing)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Fix[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Adds|Added|Adding)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Add[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Implements|Implemented|Implementing)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Implement[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Improves|Improved|Improving)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Improve[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Enhances|Enhanced|Enhancing)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Enhance[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Updates|Updated|Updating)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Update[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Refactors|Refactored|Refactoring)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^Refactor[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Removes|Removed|Remove)[[:space:]:\-]+//i')
    msg=$(echo "$msg" | sed -E 's/^(Migrates|Migrated|Migrate)[[:space:]:\-]+//i')

    # Capitalize first letter
    msg=$(echo "$msg" | sed -E 's/^(.)/\U\1/')
    echo "$msg"
}

get_commits_subjects() {
    local range="$1" output_file="$2"
    if [ -n "$range" ]; then
        git log "$range" --pretty=format:"%s" --no-merges > "$output_file" 2>/dev/null
    fi
}

format_categorized_commits() {
    local commit_file="$1"
    local -a features=() fixes=() changes=() docs=() breaking=() others=()

    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        local category clean_msg
        category=$(categorize_commit "$line")
        clean_msg=$(clean_commit_message "$line")
        case "$category" in
            feature)  features+=("$clean_msg") ;;
            fix)      fixes+=("$clean_msg") ;;
            change)   changes+=("$clean_msg") ;;
            docs)     docs+=("$clean_msg") ;;
            breaking) breaking+=("$clean_msg") ;;
            *)        others+=("$clean_msg") ;;
        esac
    done < "$commit_file"

    if [ ${#breaking[@]} -gt 0 ]; then
        echo "### ⚠️ Breaking Changes"
        for item in "${breaking[@]}"; do echo "- $item"; done
        echo ""
    fi
    if [ ${#features[@]} -gt 0 ]; then
        echo "### 🚀 Features"
        for item in "${features[@]}"; do echo "- $item"; done
        echo ""
    fi
    if [ ${#fixes[@]} -gt 0 ]; then
        echo "### 🐛 Fixes"
        for item in "${fixes[@]}"; do echo "- $item"; done
        echo ""
    fi
    if [ ${#changes[@]} -gt 0 ]; then
        echo "### 📝 Changes"
        for item in "${changes[@]}"; do echo "- $item"; done
        echo ""
    fi
    if [ ${#docs[@]} -gt 0 ]; then
        echo "### 📚 Documentation"
        for item in "${docs[@]}"; do echo "- $item"; done
        echo ""
    fi
    if [ ${#others[@]} -gt 0 ]; then
        echo "### 🔧 Other"
        for item in "${others[@]}"; do echo "- $item"; done
        echo ""
    fi
}

# === Main ===

log_info "Generating changelog for $PROJECT_NAME..."
log_info "Output file: $OUTPUT_FILE"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository"
    exit 1
fi

IS_TAG=false
CURRENT_TAG=""
if [[ "$GITHUB_REF" =~ ^refs/tags/ ]]; then
    IS_TAG=true
    CURRENT_TAG="${GITHUB_REF#refs/tags/}"
    log_info "Tag release: $CURRENT_TAG"
else
    log_info "Alpha build (branch push)"
fi

NOW=$(date +%s)
MONTH_AGO=$((NOW - MONTH_AGO_SECONDS))

echo "# $PROJECT_NAME" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

TEMP_ALPHA_COMMITS=$(mktemp)

# Alpha build (non-tag): list commits since last tag
if [ "$IS_TAG" = false ]; then
    LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

    if [ -n "$LATEST_TAG" ]; then
        log_info "Listing unreleased commits since $LATEST_TAG..."
        get_commits_subjects "$LATEST_TAG..HEAD" "$TEMP_ALPHA_COMMITS"
    else
        log_info "No tags yet, listing all commits as unreleased..."
        git log --pretty=format:"%s" --no-merges > "$TEMP_ALPHA_COMMITS" 2>/dev/null
    fi

    if [ -s "$TEMP_ALPHA_COMMITS" ]; then
        ALPHA_COUNT=$(grep -c "." "$TEMP_ALPHA_COMMITS" 2>/dev/null || echo "0")
        log_info "Found $ALPHA_COUNT unreleased commits"

        echo "## ⚡ Unreleased Changes" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "_These changes are not yet in a release. This is a development build._" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        format_categorized_commits "$TEMP_ALPHA_COMMITS" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
    fi
fi

# Recent tag history
log_info "Collecting tags from the last month..."
ALL_TAGS=$(git tag --sort=-version:refname)

ALL_TAGS_ARRAY=()
while IFS= read -r tag; do
    [ -n "$tag" ] && ALL_TAGS_ARRAY+=("$tag")
done <<< "$ALL_TAGS"

RECENT_TAGS=()
for tag in "${ALL_TAGS_ARRAY[@]}"; do
    TAG_DATE=$(git log -1 --format=%at "$tag" 2>/dev/null || echo "")
    if [ -n "$TAG_DATE" ] && [ "$TAG_DATE" -ge "$MONTH_AGO" ]; then
        RECENT_TAGS+=("$tag")
    fi
done

log_info "Found ${#RECENT_TAGS[@]} tags from the last month"

for TAG in "${RECENT_TAGS[@]}"; do
    TAG_DATE=$(git log -1 --format=%ai "$TAG" | cut -d' ' -f1)
    log_info "Processing $TAG ($TAG_DATE)..."

    PREV_TAG=""
    for j in "${!ALL_TAGS_ARRAY[@]}"; do
        if [ "${ALL_TAGS_ARRAY[$j]}" = "$TAG" ]; then
            NEXT_IDX=$((j + 1))
            if [ $NEXT_IDX -lt ${#ALL_TAGS_ARRAY[@]} ]; then
                PREV_TAG="${ALL_TAGS_ARRAY[$NEXT_IDX]}"
            fi
            break
        fi
    done

    TEMP_TAG_COMMITS=$(mktemp)
    if [ -n "$PREV_TAG" ]; then
        get_commits_subjects "$PREV_TAG..$TAG" "$TEMP_TAG_COMMITS"
    else
        log_warn "No previous tag for $TAG; skipping commit list to avoid full history"
        echo "" > "$TEMP_TAG_COMMITS"
    fi

    echo "## $TAG ($TAG_DATE)" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"

    if [ -s "$TEMP_TAG_COMMITS" ]; then
        format_categorized_commits "$TEMP_TAG_COMMITS" >> "$OUTPUT_FILE"
    else
        echo "- No changes recorded" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
    fi
    echo "" >> "$OUTPUT_FILE"

    rm -f "$TEMP_TAG_COMMITS"
done

rm -f "$TEMP_ALPHA_COMMITS"

# Footer
if [ -n "$GH_ISSUES_URL" ]; then
    echo "" >> "$OUTPUT_FILE"
    echo "---" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "## Links" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "- **Report Issues**: [$GH_ISSUES_URL]($GH_ISSUES_URL)" >> "$OUTPUT_FILE"
fi

log_info "Changelog generated: $OUTPUT_FILE"
log_info "Preview (first 50 lines):"
head -n 50 "$OUTPUT_FILE"

exit 0
