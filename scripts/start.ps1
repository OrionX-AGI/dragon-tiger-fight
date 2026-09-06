<#
  龙虎斗一键启动脚本。
  流程：检查 Node 环境 -> 检查/安装依赖 -> 启动开发服务器并打开浏览器。
  参数 -CheckOnly 只做环境与依赖检查，不启动服务器（用于排查问题）。
#>
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Write-Step($text) { Write-Host "`n>>> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    [OK] $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "    [!] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "    [X] $text" -ForegroundColor Red }

Write-Host "==============================" -ForegroundColor DarkYellow
Write-Host "   龙虎斗 · 一键启动" -ForegroundColor Yellow
Write-Host "==============================" -ForegroundColor DarkYellow
Write-Host "项目目录：$projectRoot"

# --- 1. 检查 Node.js 与 npm ---
Write-Step "检查 Node.js 环境"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Err "未检测到 Node.js。请先从 https://nodejs.org/ 安装 LTS 版本（建议 20 或更高），安装后重新运行本脚本。"
  exit 1
}
$nodeVersion = (& node --version).Trim()
$majorVersion = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($majorVersion -lt 18) {
  Write-Err "Node.js 版本过低（当前 $nodeVersion），本项目需要 18 或更高版本。"
  exit 1
}
Write-Ok "Node.js $nodeVersion"

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
  Write-Err "未检测到 npm，请重新安装 Node.js（npm 随 Node.js 一起安装）。"
  exit 1
}
Write-Ok "npm $((& npm --version).Trim())"

# --- 2. 检查依赖 ---
Write-Step "检查项目依赖"
$modulesDir = Join-Path $projectRoot 'node_modules'
$installStamp = Join-Path $modulesDir '.package-lock.json'
$packageJson = Join-Path $projectRoot 'package.json'

# 依赖清单以 package-lock.json 为准：它只在依赖真正变动时更新，
# 而 package.json 改动脚本命令也会更新时间戳，用它比较会误判。
$lockFile = Join-Path $projectRoot 'package-lock.json'
$manifest = if (Test-Path $lockFile) { $lockFile } else { $packageJson }

$needInstall = $false
$reason = ''
if (-not (Test-Path $modulesDir)) {
  $needInstall = $true
  $reason = 'node_modules 目录不存在（首次运行）'
} elseif (-not (Test-Path $installStamp)) {
  $needInstall = $true
  $reason = '依赖安装记录缺失，可能上次安装未完成'
} elseif ((Get-Item $manifest).LastWriteTime -gt (Get-Item $installStamp).LastWriteTime) {
  $needInstall = $true
  $reason = "$(Split-Path -Leaf $manifest) 比已安装依赖更新，依赖清单可能有变化"
} else {
  # 抽查关键依赖是否真实存在，防止 node_modules 被误删部分内容
  foreach ($pkg in @('react', 'vite', 'vitest', 'typescript')) {
    if (-not (Test-Path (Join-Path $modulesDir $pkg))) {
      $needInstall = $true
      $reason = "关键依赖 $pkg 缺失"
      break
    }
  }
}

if ($needInstall) {
  Write-Warn2 "需要安装依赖：$reason"
  Write-Host "    正在执行 npm install，首次安装约需 1-3 分钟，请耐心等待……"
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Err "依赖安装失败。常见原因与处理方式："
    Write-Host "      1) 网络问题：可切换镜像后重试  npm config set registry https://registry.npmmirror.com"
    Write-Host "      2) 缓存权限报错 EPERM：本项目已在 .npmrc 中指定独立缓存目录，若仍报错请以管理员身份重新运行"
    Write-Host "      3) 杀毒软件占用文件：暂时关闭实时防护后重试"
    exit 1
  }
  Write-Ok "依赖安装完成"
} else {
  Write-Ok "依赖已安装，跳过安装步骤"
}

if ($CheckOnly) {
  Write-Step "检查完成（-CheckOnly 模式，不启动服务器）"
  exit 0
}

# --- 3. 启动开发服务器 ---
Write-Step "启动游戏"
Write-Host "    浏览器将自动打开，若未打开请手动访问下方显示的地址。"
Write-Host "    停止游戏：在本窗口按 Ctrl + C。`n"
& npm run dev -- --open
