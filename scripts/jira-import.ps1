#Requires -Version 5.1
<#
.SYNOPSIS
  Creates the QA plan in a Jira Cloud Scrum project: epics, stories in their
  sprints with acceptance criteria and story points, and QA sub-tasks.

.DESCRIPTION
  Reads scripts/test-plan.json and creates everything through the Jira REST API:

    - one epic per entry in "epics";
    - one story per entry in "stories", under its epic, with the user story,
      its acceptance criteria and its traceability in the description, its
      story points, and moved into its sprint;
    - one sub-task per QA task, under its story (sub-tasks follow the story's
      sprint on their own).

  Sprints are matched by name ("Sprint 1", "Sprint 2"...) among the board's
  active and future sprints, falling back to their start-date order. Existing
  sprints are used as they are: nothing about their dates is changed.

  Re-running skips whatever already carries the plan's label (matched by
  summary), so it is safe to run again after adding stories to the plan.
  Assignees are left empty on purpose.

  Needs an API token: id.atlassian.com/manage-profile/security/api-tokens.
  Pass it with -ApiToken or set $env:JIRA_API_TOKEN.

.EXAMPLE
  .\scripts\jira-import.ps1 -DryRun

.EXAMPLE
  .\scripts\jira-import.ps1 -Site https://miequipo.atlassian.net -Email yo@correo.com -Project QA

.EXAMPLE
  .\scripts\jira-import.ps1 -Csv .\plan-qa.csv
#>
param(
  [string]$Site,
  [string]$Email,
  [string]$ApiToken = $env:JIRA_API_TOKEN,
  # The space's key: the prefix of its tickets, e.g. QA in QA-12.
  [string]$Project,
  [string]$Plan = (Join-Path $PSScriptRoot 'test-plan.json'),
  # Prints the tree without contacting Jira.
  [switch]$DryRun,
  # Writes a CSV for Jira's own importer instead of calling the API.
  [string]$Csv,
  # Leaves every story in the backlog instead of moving it to its sprint.
  [switch]$NoSprints,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Wait-Close {
  if (-not $NoPause) { try { Read-Host "`nEnter para cerrar" | Out-Null } catch { } }
}

# ---------------------------------------------------------------- the plan

if (-not (Test-Path $Plan)) { throw "No se encontró el plan: $Plan" }
# -Encoding UTF8 so Windows PowerShell 5.1 keeps the accents.
$qa = Get-Content $Plan -Raw -Encoding UTF8 | ConvertFrom-Json

$epicsByKey = @{}
foreach ($epic in $qa.epics) { $epicsByKey[$epic.key] = $epic }

# Summaries identify issues on re-runs, so they have to be unique.
$seen = @{}
$allSummaries = @($qa.epics.summary) + @($qa.stories.summary) + @($qa.stories | ForEach-Object { $_.tasks.summary })
foreach ($summary in $allSummaries) {
  if ($seen.ContainsKey($summary)) { throw "Resumen repetido en el plan: «$summary». Cada título debe ser único." }
  $seen[$summary] = $true
}
foreach ($story in $qa.stories) {
  if (-not $epicsByKey.ContainsKey($story.epic)) { throw "La historia «$($story.summary)» apunta a una épica inexistente: $($story.epic)" }
  if ($story.sprint -lt 1 -or $story.sprint -gt $qa.sprints.Count) { throw "La historia «$($story.summary)» tiene un sprint fuera de rango: $($story.sprint)" }
}

function Format-StoryDescription {
  param($Story)
  $lines = @($Story.story, '', 'Criterios de aceptación:')
  foreach ($criterion in $Story.acceptance) { $lines += "- $criterion" }
  if ($Story.trace) { $lines += ''; $lines += "Trazabilidad: $($Story.trace)" }
  return ($lines -join "`n")
}

function Format-TaskDescription {
  param($Task)
  $lines = @()
  if ($Task.precondition) { $lines += "Precondición: $($Task.precondition)"; $lines += '' }
  $lines += 'Pasos:'
  $number = 1
  foreach ($step in $Task.steps) { $lines += "$number. $step"; $number++ }
  if ($Task.samples) {
    $lines += ''
    $lines += 'Muestras:'
    foreach ($sample in $Task.samples) { $lines += "- $sample" }
  }
  $lines += ''
  $lines += "Resultado esperado: $($Task.expected)"
  return ($lines -join "`n")
}

# ------------------------------------------------------------------ dry run

if ($DryRun) {
  $taskCount = 0
  foreach ($epic in $qa.epics) {
    Write-Host "`nÉPICA  $($epic.summary)" -ForegroundColor Cyan
    foreach ($story in ($qa.stories | Where-Object { $_.epic -eq $epic.key } | Sort-Object sprint)) {
      Write-Host ("  [{0} · {1} pts]  {2}" -f $qa.sprints[$story.sprint - 1], $story.points, $story.summary) -ForegroundColor Yellow
      foreach ($task in $story.tasks) {
        Write-Host "      - $($task.summary)"
        $taskCount++
      }
    }
  }
  Write-Host ''
  for ($n = 1; $n -le $qa.sprints.Count; $n++) {
    $inSprint = @($qa.stories | Where-Object { $_.sprint -eq $n })
    $points = ($inSprint | Measure-Object -Property points -Sum).Sum
    Write-Host ("{0}: {1} historias, {2} puntos" -f $qa.sprints[$n - 1], $inSprint.Count, $points)
  }
  Write-Host "`n$($qa.epics.Count) épicas, $($qa.stories.Count) historias, $taskCount tareas de QA. No se creó nada." -ForegroundColor Green
  Wait-Close
  return
}

# ---------------------------------------------------------------------- csv

if ($Csv) {
  $rows = @()
  foreach ($epic in $qa.epics) {
    $rows += [pscustomobject]@{
      'Issue Type' = 'Epic'; 'Summary' = $epic.summary; 'Description' = $epic.description
      'Parent' = ''; 'Sprint' = ''; 'Story Points' = ''; 'Labels' = $qa.label
    }
  }
  foreach ($story in $qa.stories) {
    $rows += [pscustomobject]@{
      'Issue Type' = 'Story'; 'Summary' = $story.summary; 'Description' = Format-StoryDescription $story
      'Parent' = $epicsByKey[$story.epic].summary; 'Sprint' = $qa.sprints[$story.sprint - 1]
      'Story Points' = $story.points; 'Labels' = $qa.label
    }
    foreach ($task in $story.tasks) {
      $rows += [pscustomobject]@{
        'Issue Type' = 'Sub-task'; 'Summary' = $task.summary; 'Description' = Format-TaskDescription $task
        'Parent' = $story.summary; 'Sprint' = ''; 'Story Points' = ''; 'Labels' = $qa.label
      }
    }
  }
  $rows | Export-Csv -Path $Csv -NoTypeInformation -Encoding UTF8
  Write-Host "CSV escrito en $Csv ($($rows.Count) filas)." -ForegroundColor Green
  Write-Host 'Impórtalo desde el menú del espacio: Importar incidencias > CSV, y relaciona Parent, Sprint y Story Points con sus campos.'
  Wait-Close
  return
}

# ---------------------------------------------------------------- jira api

foreach ($name in 'Site', 'Email', 'Project') {
  if (-not (Get-Variable $name -ValueOnly)) { throw "Falta -$name. Usa -DryRun para ver el plan sin conectarte." }
}
if (-not $ApiToken) { throw 'Falta el API token: pásalo con -ApiToken o ponlo en $env:JIRA_API_TOKEN.' }

$Site = $Site.TrimEnd('/')
$Project = $Project.ToUpper()
$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${Email}:${ApiToken}"))
$headers = @{ Authorization = "Basic $auth"; Accept = 'application/json' }

function Invoke-Jira {
  param([string]$Method, [string]$Path, $Body)
  $params = @{
    Method      = $Method
    Uri         = "$Site$Path"
    Headers     = $headers
    ContentType = 'application/json; charset=utf-8'
  }
  if ($null -ne $Body) { $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10)) }
  try {
    return Invoke-RestMethod @params
  }
  catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    throw "Jira respondió $status en $Method $Path`n$($_.ErrorDetails.Message)"
  }
}

$me = Invoke-Jira GET '/rest/api/2/myself'
Write-Host "Conectado como $($me.displayName) en $Site" -ForegroundColor Green

# Issue types by level rather than by name: names change with the language.
$projectInfo = Invoke-Jira GET "/rest/api/2/project/$Project"
$types = @($projectInfo.issueTypes)

function Find-Type {
  param([int]$Level, [string[]]$Names)
  $candidates = @($types | Where-Object {
      if ($null -ne $_.hierarchyLevel) { $_.hierarchyLevel -eq $Level }
      elseif ($Level -eq -1) { $_.subtask }
      else { -not $_.subtask }
    })
  foreach ($name in $Names) {
    $match = $candidates | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($match) { return $match }
  }
  if ($Level -eq 1) { return $null }  # no guessing for epics
  return $candidates | Select-Object -First 1
}

$epicType = Find-Type 1 @('Epic', 'Épica')
$storyType = Find-Type 0 @('Story', 'Historia')
$subtaskType = Find-Type -1 @('Subtask', 'Sub-task', 'Subtarea')
if (-not $epicType) { throw "El espacio $Project no tiene el tipo Épica." }
if (-not $storyType) { throw "El espacio $Project no tiene el tipo Historia." }
Write-Host "Tipos: $($epicType.name) / $($storyType.name) / $(if ($subtaskType) { $subtaskType.name } else { 'sin subtareas: las tareas serán historias' })" -ForegroundColor DarkGray

# Story points: "Story point estimate" in team-managed spaces, "Story Points" in
# company-managed ones. Skipped quietly if the space has neither.
# Piped through ForEach-Object: PowerShell 7 hands a JSON array back as one object.
$allFields = @(Invoke-Jira GET '/rest/api/2/field' | ForEach-Object { $_ })
$script:pointsField = $null
foreach ($pattern in '^Story point estimate$', '^Story Points$', 'puntos de historia') {
  $script:pointsField = $allFields | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if ($script:pointsField) { break }
}
if ($script:pointsField) { Write-Host "Puntos de historia: $($script:pointsField.name)" -ForegroundColor DarkGray }
else { Write-Host 'No se encontró el campo de puntos de historia; se crearán sin estimación.' -ForegroundColor Yellow }

# What already exists with our label, so a re-run never duplicates.
$existing = @{}
$jql = [uri]::EscapeDataString("project = $Project AND labels = $($qa.label)")
$nextPage = $null
do {
  $path = "/rest/api/3/search/jql?jql=$jql&fields=summary&maxResults=100"
  if ($nextPage) { $path += "&nextPageToken=$([uri]::EscapeDataString($nextPage))" }
  $page = Invoke-Jira GET $path
  foreach ($issue in $page.issues) { $existing[$issue.fields.summary] = $issue.key }
  $nextPage = $page.nextPageToken
} while ($nextPage)
if ($existing.Count) { Write-Host "Ya existen $($existing.Count) tickets con la etiqueta $($qa.label); se reutilizan." -ForegroundColor DarkGray }

# The board's sprints. Their dates are never touched.
$sprintByNumber = @{}
if (-not $NoSprints) {
  # Team-managed spaces report their Scrum board as type "simple", not "scrum".
  $boards = Invoke-Jira GET "/rest/agile/1.0/board?projectKeyOrId=$Project"
  $board = @($boards.values) | Where-Object { $_.type -in 'scrum', 'simple' } | Select-Object -First 1
  if (-not $board) {
    Write-Host 'No hay un tablero con sprints en el espacio; las historias quedarán en el Backlog.' -ForegroundColor Yellow
  }
  else {
    $sprints = @()
    $startAt = 0
    do {
      $page = Invoke-Jira GET "/rest/agile/1.0/board/$($board.id)/sprint?state=active,future&startAt=$startAt&maxResults=50"
      $sprints += @($page.values)
      $startAt += @($page.values).Count
    } while (-not $page.isLast -and @($page.values).Count -gt 0)

    $byDate = @($sprints | Sort-Object @{ Expression = { if ($_.startDate) { [datetime]$_.startDate } else { [datetime]::MaxValue } } }, id)
    for ($n = 1; $n -le $qa.sprints.Count; $n++) {
      $match = $sprints | Where-Object { $_.name -eq $qa.sprints[$n - 1] } | Select-Object -First 1
      if (-not $match -and $byDate.Count -ge $n) { $match = $byDate[$n - 1] }
      if ($match) {
        $sprintByNumber[$n] = $match
        Write-Host "Sprint $n -> $($match.name) ($($match.state))" -ForegroundColor DarkGray
      }
      else {
        Write-Host "No se encontró «$($qa.sprints[$n - 1])»; sus historias quedarán en el Backlog." -ForegroundColor Yellow
      }
    }
  }
}

function New-Issue {
  param([string]$Summary, [string]$Description, $Type, [string]$ParentKey, $Points)
  if ($existing.ContainsKey($Summary)) {
    Write-Host "   = $($existing[$Summary])  $Summary" -ForegroundColor DarkGray
    return $existing[$Summary]
  }

  $fields = @{
    project     = @{ key = $Project }
    summary     = $Summary
    description = $Description
    issuetype   = @{ id = $Type.id }
    labels      = @($qa.label)
  }
  if ($ParentKey) { $fields.parent = @{ key = $ParentKey } }
  if ($Points -and $script:pointsField) { $fields[[string]$script:pointsField.id] = [double]$Points }

  try {
    $created = Invoke-Jira POST '/rest/api/2/issue' @{ fields = $fields }
  }
  catch {
    # A points field missing from the creation screen: carry on without it.
    if ($Points -and $script:pointsField -and "$_" -match [regex]::Escape($script:pointsField.id)) {
      Write-Host "   El campo $($script:pointsField.name) no está disponible al crear; se omite la estimación." -ForegroundColor Yellow
      $fields.Remove([string]$script:pointsField.id)
      $script:pointsField = $null
      $created = Invoke-Jira POST '/rest/api/2/issue' @{ fields = $fields }
    }
    else { throw }
  }

  Write-Host "   + $($created.key)  $Summary" -ForegroundColor Green
  $existing[$Summary] = $created.key
  return $created.key
}

# ------------------------------------------------------------------- create

$epicKeys = @{}
Write-Host "`nÉpicas" -ForegroundColor Cyan
foreach ($epic in $qa.epics) {
  $epicKeys[$epic.key] = New-Issue -Summary $epic.summary -Description $epic.description -Type $epicType
}

$toSprint = @{}
$taskCount = 0
foreach ($story in $qa.stories) {
  Write-Host "`n$($qa.sprints[$story.sprint - 1]) · $($story.summary)" -ForegroundColor Cyan
  $storyKey = New-Issue -Summary $story.summary -Description (Format-StoryDescription $story) `
    -Type $storyType -ParentKey $epicKeys[$story.epic] -Points $story.points
  # JSON numbers arrive as Int64 and $sprintByNumber is keyed by Int32: to a
  # hashtable those are different keys, so normalise before using it as one.
  $sprintNumber = [int]$story.sprint
  if (-not $toSprint.ContainsKey($sprintNumber)) { $toSprint[$sprintNumber] = @() }
  $toSprint[$sprintNumber] += $storyKey

  foreach ($task in $story.tasks) {
    if ($subtaskType) {
      New-Issue -Summary $task.summary -Description (Format-TaskDescription $task) -Type $subtaskType -ParentKey $storyKey | Out-Null
    }
    else {
      # Without sub-tasks, each task hangs from the epic and joins the sprint itself.
      $taskKey = New-Issue -Summary $task.summary -Description (Format-TaskDescription $task) -Type $storyType -ParentKey $epicKeys[$story.epic]
      $toSprint[$sprintNumber] += $taskKey
    }
    $taskCount++
  }
}

# Sub-tasks travel with their story, so only stories are moved.
foreach ($n in ($toSprint.Keys | Sort-Object)) {
  $sprint = $sprintByNumber[$n]
  if (-not $sprint) { continue }
  $keys = @($toSprint[$n])
  for ($i = 0; $i -lt $keys.Count; $i += 50) {
    $chunk = $keys[$i..([Math]::Min($i + 49, $keys.Count - 1))]
    Invoke-Jira POST "/rest/agile/1.0/sprint/$($sprint.id)/issue" @{ issues = @($chunk) } | Out-Null
  }
  Write-Host "$($keys.Count) historias en $($sprint.name)" -ForegroundColor Green
}

Write-Host "`nListo: $($qa.epics.Count) épicas, $($qa.stories.Count) historias y $taskCount tareas de QA." -ForegroundColor Green
Write-Host "$Site/jira/software/projects/$Project/boards"

$record = Join-Path $PSScriptRoot '.jira-created.json'
$existing | ConvertTo-Json -Depth 3 | Set-Content -Path $record -Encoding utf8
Write-Host "Claves guardadas en $record" -ForegroundColor DarkGray

Wait-Close
