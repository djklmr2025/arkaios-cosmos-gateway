# arkaios-cosmos-gateway

Gateway ligero para ARKAIOS que expone `POST /aida/gateway` y enruta acciones por `agent_id/action` hacia un upstream OpenAI-compatible (normalmente `arkaios-service-proxy`).

## Endpoints
- `GET /` info del servicio
- `GET /healthz` health check
- `POST /aida/gateway` endpoint principal

## Variables de entorno
Ver `.env.example`.

Variables clave:
- `AIDA_AUTH_TOKEN`: Bearer requerido para `/aida/gateway`
- `UPSTREAM_BASE_URL`: base del proxy/back-end de IA
- `UPSTREAM_PATH`: por defecto `/v1/chat/completions`
- `UPSTREAM_API_KEY`: API key del upstream
- `AGENT_MODEL_MAP`: mapa `agent_id -> model`

## Request ejemplo
```json
{
  "agent_id": "puter",
  "action": "plan",
  "params": {
    "objective": "mapear BuilderOS"
  }
}
```

## cURL
```bash
curl -X POST "http://localhost:8787/aida/gateway" \
  -H "Authorization: Bearer REPLACE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"puter","action":"plan","params":{"objective":"mapear BuilderOS"}}'
```

## Ejecutar local
```bash
cp .env.example .env
npm start
```

## Nota
Si tu upstream ya tiene lógica avanzada por `action`, puedes reemplazar `forwardToUpstream` por un switch interno sin cambiar el contrato externo de `/aida/gateway`.
