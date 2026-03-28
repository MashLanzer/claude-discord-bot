@echo off
set ANTHROPIC_BASE_URL=https://openrouter.ai/api
set ANTHROPIC_AUTH_TOKEN=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
set ANTHROPIC_API_KEY=
claude --model openrouter/free --dangerously-skip-permissions %*

REM Clave Api Groq: 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