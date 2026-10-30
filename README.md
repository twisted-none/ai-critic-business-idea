# AI-критик бизнес-идеи

Рабочий MVP: страница отправляет описание идеи на собственный backend, backend вызывает внешний LLM API и возвращает структурированный разбор. В production демо-ответы не используются.

## Бесплатный вариант

- Хостинг: Render Free Web Service.
- LLM: OpenRouter Free Models Router (`openrouter/free`).
- Нужны бесплатные аккаунты GitHub, Render и OpenRouter.

## Локальный запуск с реальным API

```powershell
$env:LLM_API_KEY='ваш_ключ_OpenRouter'
docker build -t ai-critic .
docker run --rm -p 3000:3000 -e LLM_API_KEY=$env:LLM_API_KEY ai-critic
```

Откройте `http://localhost:3000`. Демо-режим включается только явно через `-e DEMO_MODE=true`.

## Публикация на Render

1. Создайте репозиторий GitHub и загрузите в него содержимое этой папки.
2. В Render выберите `New +` -> `Blueprint` и подключите репозиторий. Render прочитает `render.yaml`.
3. В поле `LLM_API_KEY` вставьте ключ OpenRouter. Ключ хранится только как секрет на backend.
4. Завершите создание сервиса и дождитесь статуса `Live`.
5. Откройте выданный адрес вида `https://ai-critic-business-idea.onrender.com`.
6. Отправьте тестовую идею и сделайте скриншоты формы и результата.

Проверка настройки доступна по `/health`: в опубликованной версии должно быть `"apiConfigured": true` и `"demoMode": false`.

## Альтернатива: DeepSeek

В Render замените переменные:

```text
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

`LLM_API_KEY` в этом случае должен содержать ключ DeepSeek. Использование DeepSeek API оплачивается по его тарифу.
