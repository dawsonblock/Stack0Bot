from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

ROOT = Path(__file__).resolve().parent
POLICY_DIR = ROOT / 'policies'


def _load_json(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8'))


MODEL_POLICY = _load_json(POLICY_DIR / 'model-allowlist.json', {
    'default_action': 'deny',
    'allowed_models': [],
    'fallbacks': {},
    'aliases': {},
    'max_tokens_by_model': {},
    'deny_reason': 'model not allowed',
})
TIMEOUT_POLICY = _load_json(POLICY_DIR / 'timeout-policy.json', {
    'connect_timeout_seconds': 10,
    'request_timeout_seconds': 120,
    'max_tokens_default': 2048,
    'max_tokens_absolute': 8192,
    'endpoint_caps': {'/v1/chat/completions': 8192, '/v1/messages': 8192},
})

OMLX_BASE = os.environ.get('OMLX_BASE_URL', 'http://127.0.0.1:8000').rstrip('/')
BEARER = os.environ.get('GSD_RUNTIME_GATEWAY_BEARER', '').strip()
CONNECT_TIMEOUT = float(TIMEOUT_POLICY.get('connect_timeout_seconds', 10))
REQUEST_TIMEOUT = float(TIMEOUT_POLICY.get('request_timeout_seconds', 120))
MAX_TOKENS_DEFAULT = int(TIMEOUT_POLICY.get('max_tokens_default', 2048))
MAX_TOKENS_ABSOLUTE = int(TIMEOUT_POLICY.get('max_tokens_absolute', 8192))
ENDPOINT_CAPS = TIMEOUT_POLICY.get('endpoint_caps') or {}
ALLOWED_MODELS = set(MODEL_POLICY.get('allowed_models') or [])
ALIASES = MODEL_POLICY.get('aliases') or {}
FALLBACKS = MODEL_POLICY.get('fallbacks') or {}
MAX_TOKENS_BY_MODEL = MODEL_POLICY.get('max_tokens_by_model') or {}
DEFAULT_ACTION = MODEL_POLICY.get('default_action', 'deny')
DENY_REASON = MODEL_POLICY.get('deny_reason', 'model not allowed')

app = FastAPI(title='Runtime Gateway', version='0.4.0')


def _check_auth(auth_header: Optional[str]) -> None:
    if not BEARER:
        return
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail={'code': 'missing_bearer', 'message': 'missing bearer token'})
    token = auth_header.split(' ', 1)[1].strip()
    if token != BEARER:
        raise HTTPException(status_code=401, detail={'code': 'invalid_bearer', 'message': 'invalid bearer token'})


def _request_id(request: Request) -> str:
    incoming = request.headers.get('x-request-id', '').strip()
    return incoming or str(uuid.uuid4())


def _normalize_model(model: Optional[str]) -> Optional[str]:
    if model is None:
        return None
    if model in ALIASES:
        return ALIASES[model]
    if model in FALLBACKS:
        return FALLBACKS[model]
    return model


def _enforce_model(model: Optional[str]) -> str:
    normalized = _normalize_model(model)
    if not normalized:
        raise HTTPException(status_code=400, detail={'code': 'missing_model', 'message': 'request missing model'})
    if ALLOWED_MODELS and normalized not in ALLOWED_MODELS and DEFAULT_ACTION == 'deny':
        raise HTTPException(status_code=403, detail={'code': 'model_not_allowed', 'message': DENY_REASON, 'model': normalized})
    return normalized


def _bounded_payload(payload: Dict[str, Any], upstream_path: str) -> Dict[str, Any]:
    bounded = dict(payload)
    model = _enforce_model(payload.get('model'))
    endpoint_cap = int(ENDPOINT_CAPS.get(upstream_path, MAX_TOKENS_ABSOLUTE))
    model_cap = int(MAX_TOKENS_BY_MODEL.get(model, MAX_TOKENS_ABSOLUTE))
    requested = payload.get('max_tokens', payload.get('max_output_tokens', MAX_TOKENS_DEFAULT))
    try:
        requested_int = int(requested)
    except Exception:
        requested_int = MAX_TOKENS_DEFAULT
    max_tokens = min(requested_int, endpoint_cap, model_cap, MAX_TOKENS_ABSOLUTE)
    bounded['model'] = model
    bounded['max_tokens'] = max_tokens
    if 'max_output_tokens' in bounded:
        bounded['max_output_tokens'] = max_tokens
    return bounded


async def _json_proxy(method: str, path: str, body: Optional[dict], headers: Dict[str, str]) -> Response:
    client_timeout = httpx.Timeout(REQUEST_TIMEOUT, connect=CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            response = await client.request(method, f'{OMLX_BASE}{path}', json=body, headers=headers)
        content_type = response.headers.get('content-type', 'application/json')
        return Response(content=response.content, status_code=response.status_code, media_type=content_type)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={'code': 'upstream_timeout', 'message': 'oMLX request timed out'})
    except httpx.HTTPError as exc:
        return JSONResponse(status_code=503, content={'code': 'upstream_unavailable', 'message': str(exc)})


async def _stream_proxy(method: str, path: str, body: Optional[dict], headers: Dict[str, str]) -> StreamingResponse | JSONResponse:
    client_timeout = httpx.Timeout(REQUEST_TIMEOUT, connect=CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            request = client.build_request(method, f'{OMLX_BASE}{path}', json=body, headers=headers)
            response = await client.send(request, stream=True)

            async def iter_bytes() -> Iterable[bytes]:
                try:
                    async for chunk in response.aiter_bytes():
                        if chunk:
                            yield chunk
                finally:
                    await response.aclose()

            passthrough_headers = {}
            if response.headers.get('content-type'):
                passthrough_headers['content-type'] = response.headers['content-type']
            return StreamingResponse(iter_bytes(), status_code=response.status_code, headers=passthrough_headers)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={'code': 'upstream_timeout', 'message': 'oMLX streaming request timed out'})
    except httpx.HTTPError as exc:
        return JSONResponse(status_code=503, content={'code': 'upstream_unavailable', 'message': str(exc)})


@app.get('/healthz')
async def healthz(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    req_id = _request_id(request)
    client_timeout = httpx.Timeout(10.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            response = await client.get(f'{OMLX_BASE}/v1/models')
        return {'request_id': req_id, 'ok': response.status_code < 500, 'upstream_status': response.status_code, 'omlx_base_url': OMLX_BASE}
    except Exception as exc:
        return JSONResponse(status_code=503, content={'request_id': req_id, 'ok': False, 'code': 'upstream_unavailable', 'message': str(exc), 'omlx_base_url': OMLX_BASE})


@app.get('/v1/capabilities')
async def capabilities(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    return {
        'request_id': _request_id(request),
        'runtime': 'omlx',
        'gateway': 'runtime-gateway',
        'capabilities': {
            'chat': True,
            'messages_api': True,
            'models': True,
            'streaming': True,
            'policy_boundary': True,
        },
        'policy': {
            'default_action': DEFAULT_ACTION,
            'allowed_models': sorted(ALLOWED_MODELS),
            'fallbacks': FALLBACKS,
            'aliases': ALIASES,
            'max_tokens_default': MAX_TOKENS_DEFAULT,
            'max_tokens_absolute': MAX_TOKENS_ABSOLUTE,
        },
    }


@app.get('/v1/runtime/policy')
async def runtime_policy(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    return {
        'request_id': _request_id(request),
        'model_policy': MODEL_POLICY,
        'timeout_policy': TIMEOUT_POLICY,
    }


@app.get('/v1/models')
async def list_models(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    response = await _json_proxy('GET', '/v1/models', None, {'x-request-id': _request_id(request)})
    return response


@app.get('/v1/runtime/status')
async def runtime_status(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    req_id = _request_id(request)
    client_timeout = httpx.Timeout(10.0, connect=5.0)
    upstream_ok = False
    models: list[dict[str, Any]] = []
    error: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            response = await client.get(f'{OMLX_BASE}/v1/models')
        upstream_ok = response.status_code < 500
        payload = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
        if isinstance(payload, dict) and isinstance(payload.get('data'), list):
            models = payload['data']
    except Exception as exc:
        error = str(exc)

    return {
        'request_id': req_id,
        'gateway_ok': True,
        'upstream_ok': upstream_ok,
        'policy_loaded': True,
        'degraded': not upstream_ok,
        'omlx_base_url': OMLX_BASE,
        'models': models,
        'error': error,
    }


@app.post('/v1/chat/completions')
async def chat_completions(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    req_id = _request_id(request)
    payload = await request.json()
    bounded = _bounded_payload(payload, '/v1/chat/completions')
    headers = {'x-request-id': req_id}
    if payload.get('stream'):
        return await _stream_proxy('POST', '/v1/chat/completions', bounded, headers)
    return await _json_proxy('POST', '/v1/chat/completions', bounded, headers)


@app.post('/v1/messages')
async def messages(request: Request, authorization: Optional[str] = Header(default=None)):
    _check_auth(authorization)
    req_id = _request_id(request)
    payload = await request.json()
    bounded = _bounded_payload(payload, '/v1/messages')
    headers = {'x-request-id': req_id}
    if payload.get('stream'):
        return await _stream_proxy('POST', '/v1/messages', bounded, headers)
    return await _json_proxy('POST', '/v1/messages', bounded, headers)
