<#
  龙虎斗联机服务器一键启动脚本。
  流程：环境与依赖检查 -> 构建前端页面 -> 启动联机服务器（静态托管 + WebSocket 单端口）。
  启动后窗口会打印本机与局域网访问地址，把局域网地址告诉对手即可开战。
#>
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "==============================" -ForegroundColor DarkYellow
Write-Host "   龙虎斗 · 联机服务器启动" -ForegroundColor Yellow
Write-Host "==============================" -ForegroundColor DarkYellow

# 复用一键启动脚本的环境与依赖检查
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1') -CheckOnly
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`n>>> 构建前端页面（代码更新后首次运行需要几十秒）" -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "    [X] 前端构建失败，请查看上方报错信息。" -ForegroundColor Red
  exit 1
}
Write-Host "    [OK] 构建完成" -ForegroundColor Green

Write-Host "`n>>> 启动联机服务器" -ForegroundColor Cyan
Write-Host "    双方玩家用浏览器访问下方打印的地址即可对战。"
Write-Host "    若对方无法访问，请在 Windows 防火墙中放行 Node.js 或端口 8787。"
Write-Host "    停止服务器：在本窗口按 Ctrl + C。`n"
& npm run server
