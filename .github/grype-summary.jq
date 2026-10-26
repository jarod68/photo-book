# Grype JSON report → Markdown for the GitHub Actions run summary.
# Usage: jq -r --arg image "<name>" -f .github/grype-summary.jq grype.json
# Gate column mirrors the CI gate: High/Critical with a fix available block.
def rank: {"Critical":0,"High":1,"Medium":2,"Low":3,"Negligible":4}[.] // 5;
def link: if (.url | startswith("http")) then "[\(.id)](\(.url))"
          elif (.id | startswith("CVE-")) then "[\(.id)](https://nvd.nist.gov/vuln/detail/\(.id))"
          elif (.id | startswith("GHSA-")) then "[\(.id)](https://github.com/advisories/\(.id))"
          else .id end;
def fixcell: if .fix != "" then .fix
             elif .state == "wont-fix" then "won't fix" else "—" end;
def row: "| \(.sev) | \(link) | `\(.pkg)` | \(.ver) | \(fixcell) | \(.type) | \(if .blocks then "🚫 bloque" else "" end) |";
def table: "| Gravité | Vulnérabilité | Paquet | Installé | Corrigé en | Type | Gate |\n|---|---|---|---|---|---|---|\n" + (map(row) | join("\n"));

[.matches[] | {
  sev: .vulnerability.severity, id: .vulnerability.id,
  url: (.vulnerability.dataSource // ""),
  pkg: .artifact.name, ver: .artifact.version, type: .artifact.type,
  fix: (.vulnerability.fix.versions | join(", ")),
  state: .vulnerability.fix.state
} | .blocks = ((.sev == "Critical" or .sev == "High") and .state == "fixed")]
| unique_by([.id, .pkg, .ver]) | sort_by([(.sev | rank), .pkg, .id]) as $all
| ($all | map(select(.sev | rank <= 1))) as $top
| ($all | map(select(.sev | rank > 1))) as $rest
| ($all | map(select(.blocks)) | length) as $blocking
| ([$all[].sev] | group_by(.) | map({key: .[0], value: length}) | from_entries) as $n
| "## Vulnérabilités (Grype) — \($image)\n\n"
  + "| Critical | High | Medium | Low | Negligible | Total |\n|---|---|---|---|---|---|\n"
  + "| \($n.Critical // 0) | \($n.High // 0) | \($n.Medium // 0) | \($n.Low // 0) | \($n.Negligible // 0) | \($all | length) |\n\n"
  + (if $blocking > 0
     then "**🚫 \($blocking) faille(s) High/Critical avec un correctif disponible : le build est bloqué.**\n\n"
     else "**✅ Aucune faille High/Critical corrigeable : le scan ne bloque pas.** Les autres sont de gravité Medium ou moins, ou n'ont pas encore de correctif (« won't fix » / « — » chez l'éditeur).\n\n" end)
  + (if ($top | length) > 0 then "### Critical et High\n\n" + ($top | table) + "\n\n" else "" end)
  + (if ($rest | length) > 0
     then "<details><summary>Medium, Low, Negligible (\($rest | length))</summary>\n\n" + ($rest | table) + "\n\n</details>\n"
     else "" end)
