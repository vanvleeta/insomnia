##############################################################################
################################## IMPORTS ###################################
##############################################################################
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

##############################################################################
############################## GLOBAL VARIABLES ##############################
##############################################################################
CONFIG_FILE = os.path.join("local", "config.json")
DATA_DIR = "data"

# Only synced sources are pulled. A live source is fetched by the browser
# directly, so a copy in data/ would be one nothing reads -- harmless, but
# confusing to anyone looking at what the site actually displays.
LOAD_SYNCED = "synced"
DEFAULT_LOAD = "live"

# Types whose index.json this deployment reads. validation and emulation
# sources may be configured before Insomnia consumes them, so they are pulled
# too -- having the data present is what lets a view be added without also
# changing the transport.
PULLED_TYPES = ("library", "coverage", "validation", "emulation")


##############################################################################
############################## HELPER FUNCTIONS ##############################
##############################################################################
def slugify(name):
    """Directory name for a source, derived from its configured Name."""
    slug = re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-')
    return slug or "source"


def parse_repo(repo_url):
    """Split a repository URL into host, owner and repo."""
    match = re.match(
        r'^https?://([^/]+)/([^/]+)/([^/]+?)(?:\.git)?/?$', str(repo_url)
    )
    if not match:
        return None
    return {"host": match.group(1), "owner": match.group(2),
            "repo": match.group(3)}


def private_url(parsed, branch, path="index.json"):
    """Contents API URL, which accepts a token on a private repository."""
    if parsed["host"] == "github.com":
        api = "https://api.github.com"
    else:
        api = f"https://{parsed['host']}/api/v3"
    return (
        f"{api}/repos/{parsed['owner']}/{parsed['repo']}/contents/{path}"
        f"?ref={branch}"
    )


def public_url(parsed, branch, path="index.json"):
    """Raw URL for a public repository -- no token, no API rate limit."""
    if parsed["host"] == "github.com":
        host = "raw.githubusercontent.com"
    else:
        host = f"{parsed['host']}/raw"
    return f"https://{host}/{parsed['owner']}/{parsed['repo']}/{branch}/{path}"


def fetch_url(url, token=None):
    """Fetch one URL, sending the token only when one is given."""
    request = urllib.request.Request(url)
    if token:
        request.add_header("Accept", "application/vnd.github.raw+json")
        request.add_header("X-GitHub-Api-Version", "2022-11-28")
        request.add_header("Authorization", f"Bearer {token}")

    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def fetch_index(parsed, branch, token):
    """Fetch a source's index.json, authenticating only if it has to.

    Tries the raw URL with no credentials first, and falls back to the
    Contents API with the token only if that fails. This is what removes the
    need for any per-source auth setting:

      * a public repository succeeds on the first request, without spending
        API quota and without the token ever being sent to it -- which
        matters, because GitHub answers 404 when an App token is sent to a
        repository outside the App's installation, even a public one
      * a private repository fails unauthenticated and succeeds on the retry

    Returns (content, how) where how is "public" or "token".
    """
    try:
        return fetch_url(public_url(parsed, branch)), "public"
    except urllib.error.HTTPError as first:
        if not token:
            raise
        try:
            return fetch_url(private_url(parsed, branch), token), "token"
        except urllib.error.HTTPError as second:
            # The authenticated attempt is the more informative failure.
            raise second from first


##############################################################################
#################################### MAIN ####################################
##############################################################################
if __name__ == "__main__":
    """Pull every configured source's index.json into data/<slug>/.

    Run from the root of the repository. Reads local/config.json, so the list
    of sources lives in exactly one place: adding a source means editing the
    config, not this script or the workflow.
    """
    if not os.path.exists(CONFIG_FILE):
        sys.exit(f"{CONFIG_FILE} not found. Run this from the repository root.")

    with open(CONFIG_FILE, "r") as f:
        config = json.load(f)

    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")

    sources = config.get("sources", [])
    if not token:
        print(
            "note: no GH_TOKEN set. Public sources will still sync; private "
            "ones will fail.",
            file=sys.stderr,
        )
    if not sources:
        print("No sources configured; nothing to pull.")
        sys.exit(0)

    failures = []
    pulled = 0

    for source in sources:
        name = source.get("Name", "(unnamed)")
        source_type = str(source.get("Type", "")).lower()

        if source_type not in PULLED_TYPES:
            print(f"[=] {name}: type '{source_type}' is not pulled; skipping.")
            continue

        # A LocalPath source is already in the repository -- typically the
        # bundled examples -- and has nothing to fetch.
        if source.get("LocalPath"):
            print(f"[=] {name}: LocalPath source; nothing to fetch.")
            continue

        load = str(source.get("Load", DEFAULT_LOAD)).lower()
        if load != LOAD_SYNCED:
            print(f"[=] {name}: Load \"{load}\"; the browser fetches it "
                  f"directly, nothing to sync.")
            continue

        parsed = parse_repo(source.get("Repo", ""))
        if not parsed:
            failures.append(f"{name}: cannot parse Repo '{source.get('Repo')}'")
            print(f"[-] {name}: cannot parse Repo URL.")
            continue

        branch = source.get("Branch", "main")

        try:
            content, how = fetch_index(parsed, branch, token)
        except urllib.error.HTTPError as e:
            detail = f"HTTP {e.code}"
            if e.code in (401, 403, 404) and token:
                detail += (" -- index.json was not reachable publicly or with "
                           "the App token. Check the App is installed on this "
                           "repository with Contents: read, and that "
                           "index.json exists")
            elif e.code in (401, 403, 404):
                detail += (" -- not reachable publicly, and no GH_TOKEN is set "
                           "to try a private fetch")
            failures.append(f"{name}: {detail}")
            print(f"[-] {name}: {detail}")
            continue
        except Exception as e:
            failures.append(f"{name}: {e}")
            print(f"[-] {name}: {e}")
            continue

        # Parse before writing, so a truncated or error response never lands
        # in data/ where the site would try to render it.
        try:
            document = json.loads(content)
        except json.JSONDecodeError as e:
            failures.append(f"{name}: index.json is not valid JSON: {e}")
            print(f"[-] {name}: index.json is not valid JSON.")
            continue

        if isinstance(document, dict):
            count = len(document.get("records", []))
            schema = document.get("schema", "?")
        else:
            count = len(document)
            schema = 1

        target_dir = pathlib.Path(DATA_DIR) / slugify(name)
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "index.json").write_text(content, encoding="utf-8")

        pulled += 1
        via = "with token" if how == "token" else "public"
        print(f"[+] {name} ({via}): {count} record(s), "
              f"schema {schema} -> {target_dir}")

    print()
    print(f"{pulled} source(s) pulled, {len(failures)} failed")

    if failures:
        print("\nFailures:")
        for failure in failures:
            print(f"  {failure}")
        sys.exit(1)

    sys.exit(0)
