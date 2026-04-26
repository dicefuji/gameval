# Security Policy

Gameval executes model-generated JavaScript inside the local benchmark process and browser sandbox. Treat untrusted model output as code.

## Supported use

- Run evals in an isolated local/dev environment.
- Use provider API keys with the minimum permissions needed for model inference.
- Do not run untrusted eval artifacts on production machines or machines containing sensitive files.

## Secrets

Never commit:

- `.env` files
- provider API keys
- local eval artifacts that may contain proprietary model outputs or prompts
- screenshots/logs containing credentials

Use `.env.example` as the template for local configuration.

## Reporting a vulnerability

Open a private security advisory or contact the repository owner directly with:

- affected file/route/command
- reproduction steps
- expected impact
- suggested mitigation, if known

Please do not disclose exploitable details publicly until a fix is available.
