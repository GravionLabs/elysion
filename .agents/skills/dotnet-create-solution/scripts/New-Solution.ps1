<#
.SYNOPSIS
    Scaffolds a new .NET solution with src/test layout, Central Package Management,
    shared build configuration, and optional CI workflow.

.DESCRIPTION
    Creates a complete .NET solution structure:
      <SolutionName>/
        <SolutionName>.slnx
        Directory.Build.props
        Directory.Packages.props
        .editorconfig
        src/
          Directory.Build.props
          <SolutionName>/
            <SolutionName>.csproj     ← minimal (no redundant properties)
        test/
          Directory.Build.props
          <SolutionName>.Tests/
            <SolutionName>.Tests.csproj ← minimal (no redundant properties)
        .github/
          workflows/
            ci.yml

    Generated .csproj files are cleaned of all properties already defined in
    Directory.Build.props and Directory.Packages.props, resulting in a minimal
    <Project Sdk="..."></Project> file.

.PARAMETER SolutionName
    Name of the solution and root project.

.PARAMETER ProjectType
    dotnet new template for the source project.
    Defaults to 'classlib'. Options: classlib, console, webapi, worker, grpc.

.PARAMETER OutputType
    'library' for NuGet package (multi-target, ci-library.yml) or
    'app' for executable/service (single-target, ci-app.yml).
    Defaults to 'library'.

.PARAMETER OutputDirectory
    Parent directory where the solution folder is created. Defaults to current directory.

.PARAMETER UpdatePackages
    After scaffolding, update NuGet package versions in Directory.Packages.props.
    Uses 'dotnet outdated --upgrade' if the dotnet-outdated-tool is installed;
    otherwise runs 'dotnet list package --outdated' to show available updates.

.EXAMPLE
    .\New-Solution.ps1 -SolutionName "Acme.Core" -ProjectType classlib -OutputType library

.EXAMPLE
    .\New-Solution.ps1 -SolutionName "Acme.Api" -ProjectType webapi -OutputType app -UpdatePackages
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $SolutionName,

    [ValidateSet('classlib', 'console', 'webapi', 'worker', 'grpc')]
    [string] $ProjectType = 'classlib',

    [ValidateSet('library', 'app')]
    [string] $OutputType = 'library',

    [string] $OutputDirectory = '.',

    [switch] $UpdatePackages
)

$ErrorActionPreference = 'Stop'

# Properties defined in root Directory.Build.props (redundant in any .csproj)
$RedundantProperties = @(
    'TargetFramework', 'TargetFrameworks', 'Nullable', 'ImplicitUsings',
    'LangVersion', 'Deterministic', 'GenerateDocumentationFile', 'DebugType',
    'RollForward', 'NoWarn', 'AutoGenerateBindingRedirects', 'GenerateAssemblyInfo',
    'GenerateBindingRedirectsOutputType', 'Configurations'
)

# Properties defined in test/Directory.Build.props (redundant in test .csproj)
$RedundantTestProperties = $RedundantProperties + @('IsPackable', 'OutputPath')

# Test PackageReference includes already in test/Directory.Build.props
$RedundantTestPackages = @(
    'coverlet.collector', 'Microsoft.NET.Test.Sdk', 'NUnit', 'NUnit.Analyzers',
    'NUnit3TestAdapter', 'NSubstitute', 'Shouldly'
)

function Clear-CsProjRedundancies {
    param(
        [string] $CsProjPath,
        [bool]   $IsTestProject
    )

    [xml] $xml = Get-Content $CsProjPath -Raw
    $changed = $false

    $propertiesToRemove = if ($IsTestProject) { $RedundantTestProperties } else { $RedundantProperties }

    # Remove redundant properties
    foreach ($propName in $propertiesToRemove) {
        $nodes = $xml.Project.PropertyGroup | ForEach-Object {
            if ($_ -is [System.Xml.XmlElement]) {
                $_.SelectNodes($propName)
            }
        } | Where-Object { $_ }
        foreach ($node in $nodes) {
            $node.ParentNode.RemoveChild($node) | Out-Null
            $changed = $true
        }
    }

    if ($IsTestProject) {
        # Remove redundant PackageReference items
        $itemGroups = $xml.Project.ItemGroup
        foreach ($ig in @($itemGroups)) {
            if ($ig -isnot [System.Xml.XmlElement]) { continue }
            $refs = @($ig.SelectNodes('PackageReference'))
            foreach ($ref in $refs) {
                if ($ref.GetAttribute('Include') -in $RedundantTestPackages) {
                    $ig.RemoveChild($ref) | Out-Null
                    $changed = $true
                }
            }
            # Remove <Using Include="NUnit.Framework"/>
            $usings = @($ig.SelectNodes('Using'))
            foreach ($u in $usings) {
                if ($u.GetAttribute('Include') -eq 'NUnit.Framework') {
                    $ig.RemoveChild($u) | Out-Null
                    $changed = $true
                }
            }
        }
    }

    # Remove empty PropertyGroup and ItemGroup blocks
    foreach ($groupType in @('PropertyGroup', 'ItemGroup')) {
        $groups = @($xml.Project.SelectNodes($groupType))
        foreach ($g in $groups) {
            if (-not $g.HasChildNodes -or ($g.ChildNodes | Where-Object { $_ -is [System.Xml.XmlElement] }).Count -eq 0) {
                $g.ParentNode.RemoveChild($g) | Out-Null
                $changed = $true
            }
        }
    }

    if ($changed) {
        # Save with consistent formatting
        $settings = [System.Xml.XmlWriterSettings]::new()
        $settings.Indent = $true
        $settings.IndentChars = '  '
        $settings.Encoding = [System.Text.UTF8Encoding]::new($false)  # no BOM
        $settings.OmitXmlDeclaration = $true
        $writer = [System.Xml.XmlWriter]::Create($CsProjPath, $settings)
        try { $xml.Save($writer) } finally { $writer.Close() }

        # Ensure single newline at end of file
        $content = [System.IO.File]::ReadAllText($CsProjPath).TrimEnd() + "`n"
        [System.IO.File]::WriteAllText($CsProjPath, $content, [System.Text.UTF8Encoding]::new($false))

        Write-Host "  Cleaned $([System.IO.Path]::GetFileName($CsProjPath))" -ForegroundColor Gray
    }
}

function Invoke-PackageUpdate {
    $outdatedAvailable = $null -ne (Get-Command 'dotnet-outdated' -ErrorAction SilentlyContinue) -or
                         (dotnet tool list -g 2>$null | Select-String 'dotnet-outdated')

    if ($outdatedAvailable) {
        Write-Host "`nUpdating packages via dotnet-outdated..." -ForegroundColor Cyan
        dotnet outdated --upgrade
    } else {
        Write-Host "`nChecking for outdated packages..." -ForegroundColor Cyan
        dotnet list package --outdated
        Write-Host @"

To automatically update packages, install dotnet-outdated-tool:
  dotnet tool install -g dotnet-outdated-tool
  dotnet outdated --upgrade
"@ -ForegroundColor Yellow
    }
}

# ─── Main ────────────────────────────────────────────────────────────────────

$solutionRoot = Join-Path $OutputDirectory $SolutionName
$srcProject   = $SolutionName
$testProject  = "$SolutionName.Tests"

Write-Host "Creating solution '$SolutionName' ($OutputType / $ProjectType) in '$solutionRoot'" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $solutionRoot | Out-Null
Push-Location $solutionRoot

try {
    # Solution file — use .slnx (XML format, default in .NET 9+)
    dotnet new sln --format slnx -n $SolutionName --force

    # Source project
    New-Item -ItemType Directory -Force -Path "src/$srcProject" | Out-Null
    dotnet new $ProjectType -n $srcProject -o "src/$srcProject" --force

    # Test project
    New-Item -ItemType Directory -Force -Path "test/$testProject" | Out-Null
    dotnet new nunit -n $testProject -o "test/$testProject" --force

    # Add projects to solution
    dotnet sln add "src/$srcProject/$srcProject.csproj"
    dotnet sln add "test/$testProject/$testProject.csproj"

    # Add project reference from test to src
    Push-Location "test/$testProject"
    dotnet add reference "../../src/$srcProject/$srcProject.csproj"
    Pop-Location

    # Strip properties and packages already provided by Directory.Build.props
    Write-Host "`nCleaning generated .csproj files..." -ForegroundColor Cyan
    Clear-CsProjRedundancies -CsProjPath "src/$srcProject/$srcProject.csproj"   -IsTestProject $false
    Clear-CsProjRedundancies -CsProjPath "test/$testProject/$testProject.csproj" -IsTestProject $true

    # Copy template files from the skill's templates/ directory
    $templateDir = Join-Path $PSScriptRoot '../templates'

    if (Test-Path $templateDir) {
        Write-Host "`nCopying build configuration files..." -ForegroundColor Cyan

        $filesToCopy = @(
            'Directory.Build.props',
            'Directory.Packages.props',
            '.editorconfig',
            'src/Directory.Build.props',
            'test/Directory.Build.props'
        )

        foreach ($file in $filesToCopy) {
            $src  = Join-Path $templateDir $file
            $dest = Join-Path $solutionRoot $file
            if (Test-Path $src) {
                $destDir = Split-Path $dest
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null
                Copy-Item -Path $src -Destination $dest -Force
                Write-Host "  Copied $file" -ForegroundColor Gray
            }
        }

        # CI workflow
        $ciTemplate = if ($OutputType -eq 'library') { '.github/workflows/ci-library.yml' } else { '.github/workflows/ci-app.yml' }
        $ciSrc = Join-Path $templateDir $ciTemplate
        if (Test-Path $ciSrc) {
            New-Item -ItemType Directory -Force -Path '.github/workflows' | Out-Null
            $ciDest = '.github/workflows/ci.yml'
            Copy-Item -Path $ciSrc -Destination $ciDest -Force
            if ($OutputType -eq 'library') {
                (Get-Content $ciDest) -replace '<ProjectName>', $SolutionName | Set-Content $ciDest
            }
            Write-Host "  Copied CI workflow ($OutputType)" -ForegroundColor Gray
        }
    } else {
        Write-Warning "Template directory not found at '$templateDir'. Skipping file copy."
    }

    # Update packages if requested
    if ($UpdatePackages) {
        Invoke-PackageUpdate
    }

    # Verify build
    Write-Host "`nVerifying build..." -ForegroundColor Cyan
    dotnet build

    Write-Host "`nSolution '$SolutionName' created successfully at '$solutionRoot'" -ForegroundColor Green

    if ($OutputType -eq 'library') {
        Write-Host @"

Next steps for library:
  1. Edit Directory.Build.props — adjust target frameworks if needed
  2. Edit Directory.Packages.props — verify/update package versions
  3. Edit .github/workflows/ci.yml — update verify-package-files section
  4. Create GitVersion.yml for semantic versioning
  5. Add README.md and CHANGELOG.md
  Run with -UpdatePackages to automatically bump versions in Directory.Packages.props.
"@ -ForegroundColor Yellow
    } else {
        Write-Host @"

Next steps for application:
  1. Edit Directory.Build.props — set TargetFramework (single, not multi-target)
  2. Edit Directory.Packages.props — add application packages
  3. Edit .github/workflows/ci.yml — adjust as needed
  Run with -UpdatePackages to automatically bump versions in Directory.Packages.props.
"@ -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}

