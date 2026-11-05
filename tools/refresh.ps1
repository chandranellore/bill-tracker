# Daily refresh: rebuild the data from official sources and publish it.
# Needs CONGRESS_GOV_API_KEY in the environment or the .env file that tools/fetch.py names.
Set-Location (Split-Path $PSScriptRoot -Parent)
py -3.12 tools\load_bills.py
if ($LASTEXITCODE -ne 0) { exit 1 }
py -3.12 tools\build.py
if ($LASTEXITCODE -ne 0) { exit 1 }
git add docs
git commit -m "Data refresh $(Get-Date -Format yyyy-MM-dd)"
git push
