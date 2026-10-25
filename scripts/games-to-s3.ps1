<#
.SYNOPSIS
  Puts the games into your S3 bucket, and makes the games/ folder (and nothing else in the bucket) readable by everyone.

.DESCRIPTION
  1. checks you are logged in to AWS and the bucket exists
  2. lets the bucket have a public-read policy, and adds one for the games/ folder only (asks first)
  3. uploads the games with the right file types and a one-day browser cache
  4. prints the address to use as the GAMES_BASE repository variable

  Safe to run again: only new or changed files are uploaded.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\games-to-s3.ps1 -Bucket my-pyrite-games -Region us-east-1 -Games "C:\Users\you\Downloads\pyrite\pyrite\games" -DryRun

  Add -DryRun first to see what would be uploaded without changing anything. Run it again without -DryRun to do it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Bucket,
  [Parameter(Mandatory)] [string] $Region,
  [Parameter(Mandatory)] [string] $Games,
  [string] $Prefix = "games",       # the folder inside the bucket
  [int] $CacheSeconds = 86400,      # how long browsers keep a game file before asking again (one day)
  [switch] $DryRun,                 # show what would happen, change nothing
  [switch] $SkipPublic,             # don't touch who can read the bucket; just upload
  [switch] $ReplacePolicy,          # allow replacing a bucket policy that already exists
  [switch] $Yes                     # don't ask before making games/ public
)

$ErrorActionPreference = "Stop"

# --- the AWS command line -------------------------------------------------------------------------

$AwsCli = (Get-Command aws -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $AwsCli) { throw "The AWS command line isn't installed. Get it from https://aws.amazon.com/cli/ and run this again." }

# Runs `aws ...` and hands back its exit code and output. Stops with a clear message on failure, unless -AllowFailure.
function Invoke-Aws {
  param([string[]] $Arguments, [switch] $AllowFailure)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue" # Windows PowerShell treats any text a program writes to stderr as an error otherwise
  try { $output = & $AwsCli @Arguments 2>&1 } finally { $ErrorActionPreference = $previous }
  $code = $LASTEXITCODE
  $text = ($output | ForEach-Object { "$_" }) -join "`n"
  if ($code -ne 0 -and -not $AllowFailure) { throw "aws $($Arguments -join ' ') failed:`n$text" }
  [pscustomobject]@{ Code = $code; Output = $text }
}

# --- check what we were given ---------------------------------------------------------------------

if ($Bucket -notmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$') { throw "'$Bucket' doesn't look like an S3 bucket name (lowercase letters, numbers, dots and hyphens)." }
if ($Region -notmatch '^[a-z]{2}(-[a-z]+)+-\d$') { throw "'$Region' doesn't look like an AWS region (for example us-east-1 or eu-west-2)." }
if ($Prefix -notmatch '^[A-Za-z0-9._-]+$') { throw "-Prefix may only hold letters, numbers, dots, hyphens and underscores." }
if (-not (Test-Path -LiteralPath $Games -PathType Container)) { throw "The games folder '$Games' doesn't exist." }
$Games = (Resolve-Path -LiteralPath $Games).Path.TrimEnd('\')
$collections = @(Get-ChildItem -LiteralPath $Games -Directory | Select-Object -ExpandProperty Name)
if ($collections.Count -eq 0) { throw "'$Games' has no folders in it. Point -Games at the folder that holds the game collections (such as gn-math and html)." }

$destination = "s3://$Bucket/$Prefix/"
$cache = "public, max-age=$CacheSeconds"

Write-Host ""
Write-Host "Games folder : $Games"
Write-Host "Collections  : $($collections -join ', ')"
Write-Host "Going to     : $destination  ($Region)"
if ($DryRun) { Write-Host "DRY RUN      : nothing will be changed" }
Write-Host ""

# --- logged in? bucket there? ---------------------------------------------------------------------

$who = Invoke-Aws -Arguments @("sts", "get-caller-identity", "--output", "json") -AllowFailure
if ($who.Code -ne 0) { throw "You're not logged in to AWS (or your login has expired). Run:  aws login`nthen run this again.`n$($who.Output)" }
Write-Host "Logged in to AWS."

$head = Invoke-Aws -Arguments @("s3api", "head-bucket", "--bucket", $Bucket, "--region", $Region) -AllowFailure
if ($head.Code -ne 0) { throw "Can't reach the bucket '$Bucket' in $Region. Check the name and the region (S3 > your bucket shows both).`n$($head.Output)" }
Write-Host "Found the bucket."

# --- who may read the games -----------------------------------------------------------------------

if ($SkipPublic) {
  Write-Host "Skipping the public-access step (-SkipPublic)."
} else {
  $policy = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGames",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$Bucket/$Prefix/*"
  }]
}
"@
  Write-Host ""
  Write-Host "To let visitors' browsers load the games, the bucket needs a policy that lets anyone READ files under $Prefix/ (and nothing else):"
  Write-Host $policy
  Write-Host "It does not let anyone list, change or delete anything, and files outside $Prefix/ stay private."

  $existing = Invoke-Aws -Arguments @("s3api", "get-bucket-policy", "--bucket", $Bucket, "--region", $Region) -AllowFailure
  $hasPolicy = $existing.Code -eq 0
  if (-not $hasPolicy -and $existing.Output -notmatch "NoSuchBucketPolicy") {
    throw "Couldn't check the bucket's current policy:`n$($existing.Output)"
  }
  if ($hasPolicy -and -not $ReplacePolicy) {
    Write-Host ""
    Write-Host "This bucket already has a policy, so I'm leaving it alone. If it doesn't already let anyone read $Prefix/*, add the statement above to it in the S3 console,"
    Write-Host "or run this again with -ReplacePolicy to replace the whole policy with just that statement."
  } elseif ($DryRun) {
    Write-Host "(dry run) would relax the two 'public policy' blocks and set that policy."
  } else {
    $go = $Yes
    if (-not $go) { $go = (Read-Host "Make $Prefix/ readable by everyone? (y/N)") -match '^[yY]' }
    if (-not $go) { throw "Stopped: not making anything public. Run again with -SkipPublic to upload only." }

    # Only the two blocks that stop a public *policy* are relaxed; the ones about ACLs stay on.
    Invoke-Aws -Arguments @("s3api", "put-public-access-block", "--bucket", $Bucket, "--region", $Region,
      "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false") | Out-Null
    $file = [System.IO.Path]::GetTempFileName()
    try {
      [System.IO.File]::WriteAllText($file, $policy, (New-Object System.Text.UTF8Encoding $false))
      Invoke-Aws -Arguments @("s3api", "put-bucket-policy", "--bucket", $Bucket, "--region", $Region, "--policy", "file://$file") | Out-Null
    } finally {
      Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    }
    Write-Host "Done: $Prefix/ is now readable by everyone."
  }
}

# --- upload ---------------------------------------------------------------------------------------

# Windows can guess a file's type wrongly (for example .js as plain text), and a browser then refuses to run it.
# So the common web types are set explicitly; everything else is left to the AWS command line's own guess.
$types = @(
  @{ Type = "text/html; charset=utf-8"; Globs = @("*.html", "*.htm") },
  @{ Type = "text/javascript"; Globs = @("*.js", "*.mjs") },
  @{ Type = "text/css"; Globs = @("*.css") },
  @{ Type = "application/json"; Globs = @("*.json") },
  @{ Type = "application/wasm"; Globs = @("*.wasm") },
  @{ Type = "image/svg+xml"; Globs = @("*.svg") },
  @{ Type = "image/png"; Globs = @("*.png") },
  @{ Type = "image/jpeg"; Globs = @("*.jpg", "*.jpeg") },
  @{ Type = "image/gif"; Globs = @("*.gif") },
  @{ Type = "image/webp"; Globs = @("*.webp") },
  @{ Type = "image/x-icon"; Globs = @("*.ico") },
  @{ Type = "audio/mpeg"; Globs = @("*.mp3") },
  @{ Type = "audio/ogg"; Globs = @("*.ogg") },
  @{ Type = "audio/wav"; Globs = @("*.wav") },
  @{ Type = "video/mp4"; Globs = @("*.mp4") },
  @{ Type = "video/webm"; Globs = @("*.webm") },
  @{ Type = "font/woff2"; Globs = @("*.woff2") },
  @{ Type = "font/woff"; Globs = @("*.woff") },
  @{ Type = "font/ttf"; Globs = @("*.ttf") },
  @{ Type = "font/otf"; Globs = @("*.otf") },
  @{ Type = "text/plain; charset=utf-8"; Globs = @("*.txt") },
  @{ Type = "application/xml"; Globs = @("*.xml") }
)

# Runs `aws s3 sync` straight to the screen, so its progress shows while 3.5 GB goes up.
function Sync-Games {
  param([string[]] $Filters, [string] $ContentType)
  $arguments = @("s3", "sync", $Games, $destination, "--region", $Region, "--cache-control", $cache) + $Filters
  if ($ContentType) { $arguments += @("--content-type", $ContentType) }
  if ($DryRun) { $arguments += "--dryrun" }
  & $AwsCli @arguments
  if ($LASTEXITCODE -ne 0) { throw "The upload stopped with an error (exit code $LASTEXITCODE). Run the script again to carry on where it left off." }
}

Write-Host ""
Write-Host "Uploading. A first upload of 3.5 GB can take a while; running the script again later only sends what changed."
foreach ($group in $types) {
  $filters = @("--exclude", "*")
  foreach ($glob in $group.Globs) { $filters += @("--include", $glob) }
  Write-Host ""
  Write-Host "== $($group.Globs -join ' ')  as  $($group.Type)"
  Sync-Games -Filters $filters -ContentType $group.Type
}
Write-Host ""
Write-Host "== everything else"
Sync-Games -Filters @("--exclude", ".DS_Store", "--exclude", "*/.DS_Store", "--exclude", "Thumbs.db", "--exclude", "*/Thumbs.db")

# --- done -----------------------------------------------------------------------------------------

# bucket names with dots in them can't use the https://BUCKET.s3... form (its certificate wouldn't match)
if ($Bucket.Contains(".")) { $base = "https://s3.$Region.amazonaws.com/$Bucket/$Prefix/" } else { $base = "https://$Bucket.s3.$Region.amazonaws.com/$Prefix/" }

Write-Host ""
if ($DryRun) { Write-Host "Dry run finished: nothing was changed." } else { Write-Host "Upload finished." }
Write-Host ""
Write-Host "The address of your games folder is:"
Write-Host "  $base"
Write-Host ""
Write-Host "Next: set the GAMES_BASE repository variable to that address, then check it works:"
Write-Host "  node scripts\check-games-host.mjs $base"
