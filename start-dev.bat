@echo off
rem 一键启动前后端开发服务（需先在 server/ 与 web/ 分别执行 npm install）
start "yuna-video-server" cmd /k "cd /d %~dp0server && npm run dev"
start "yuna-video-web" cmd /k "cd /d %~dp0web && npm run dev"
